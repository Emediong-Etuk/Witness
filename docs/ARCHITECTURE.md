# Architecture

> Status: in progress. The sections below describe what's built and tested now. Anything still pending is marked as such.

## Packages

| Package | Role | Runtime deps |
| --- | --- | --- |
| `packages/features` | Pure DSP (detrend, FFT, Welch, autocorrelation), flicker analysis, chewing detector, landmark motion/mouth/jaw, BT.601 ROI luma, clock-offset estimator | none |
| `packages/gate` | The Clean-Window Gate: rules R1–R11, verdicts, receipts, canonical JSON, hash chain, `GateSession` | `@noble/hashes`, `features` |
| `packages/schema` | zod schemas: gate events, receipts, session-log lines, corpus manifest (strict: no coordinates) | `zod` |
| `packages/sdk-adapter` | `VitalsSource` over the real renderer SDK (`RealSmartSpectra`) or a trace (`TraceReplaySdk`); `normalizeMetrics`; `GateEventMapper`; synthetic scenarios | `features`, `gate` |
| `packages/session` | `SessionController` (consent-gated source start, gate evaluation, UI view model) + XState flow machine + user-facing rule copy | `gate`, `sdk-adapter`, `xstate` |
| `packages/ui` | Design tokens, clean-window rings, receipt card, sparkline, waveform canvas | React, Motion (peer) |
| `apps/desktop` | Electron app: hardened main, bundled preload, React renderer, feature worker | `@smartspectra/node-sdk`, `zod` |

## Data flow (live camera)

```
SDK (renderer) ── validationStatus / metrics / error / streamAvailable
      │                                            │
      ▼                                            ▼
RealSmartSpectra ── normalizeMetrics ──┐     track.clone() → MediaStreamTrackProcessor
  (SDK clock → session clock)          │            → feature worker (ROI luma, frame closed at once)
      │ landmarks → LandmarkFeatureTracker          │
      │   (3 scalars; coordinates discarded)        │ frame events (session clock)
      ▼                                            ▼
                 SourceEvent stream (no frames, no coordinates)
                                  │
                       GateEventMapper (piecewise states on change; stream_ready)
                                  │
                       GateSession.push → evaluate() on every SDK rate sample
                                  │
                       Receipt (hash-chained) → SessionController view → React
```

Replay uses the same path from `SourceEvent` downward, which is why the UI tests and the judge-site demo exercise the real gate and controller.

## Time alignment (§7.4)

- **What the SDK does (read from `js/renderer/timestamp.js` in 3.5.0):** the renderer SDK stamps each frame with `VideoFrame.timestamp + (Date.now()·1000 − firstFrameTimestamp)`. That's epoch-anchored µs, kept strictly increasing. Validation and metrics callbacks carry timestamps in that same domain.
- **What Witness does:** every source keeps a running median of `arrival − sourceTs` (`OffsetEstimator`, 301 samples).
  - The SDK offset is learned from validation callbacks. They arrive about once per processed frame with low latency, and metrics timestamps reuse that offset. This keeps metric processing latency out of the alignment.
  - Frame-feature timestamps (`VideoFrame.timestamp` of our cloned track) get their own estimator, using arrival times stamped inside the worker.
- The gate tolerates ±150 ms of offset between sources (property test).
- **Pending empirical check on a real camera:** whether the cloned track's `VideoFrame.timestamp` matches the SDK's raw timestamps, and whether `sendFrame` timestamps come back unchanged in measurement timestamps (bench path).

## Gate decisions worth knowing

- **Window start = end of start-up camera tuning.** The mapper emits `stream_ready` at the first validation code that isn't `CAMERA_TUNING`. R1 counts the window from there, and evidence during warm-up is judged over `[streamStart, t]`. This keeps the SDK's normal start-up tuning from showing as "withheld: framing" on the 30 s and 60 s windows. `CAMERA_TUNING` later in a session still counts as non-OK (R4).
- **WARMING_UP refinement.** While R1 fails, R2 (confidence), R3 (range) and R11 (no blink yet) count as evidence that builds up over time, not as contamination. Any contamination rule failing gives WITHHELD, so monotonicity holds (property-tested).
- **Fail closed.** Missing evidence (no face features, no frames, no validation events, no talking state) fails the rule that needs it.
- **Order independence.** Events are sorted by (time, kind, canonical bytes) before evaluation, so the result never depends on arrival order (property-tested).
- **Countdown.** Each failing check records `lastViolationUs`. The UI shows `W − (now − lastViolation)`.

## Electron security (§10.1) — implemented in `apps/desktop/src/main`

| Control | Where |
| --- | --- |
| `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`, no webview, DevTools off when packaged | `index.ts` `createWindow` |
| UI served from privileged `app://witness` with CSP and `nosniff` response headers. The CSP is also in a meta tag. | `index.ts` `registerAppProtocol`, `security.ts` `CSP` |
| Permissions: `media` only, video-only, only from our origin. Everything else is denied, including device permissions. | `security.ts` `installPermissionHandlers` |
| Network: requests other than `app://`, `blob:`, `data:` (and the dev server in unpackaged dev) are cancelled | `security.ts` `onBeforeRequest` |
| Navigation, redirects, new windows and webviews denied. External links only by allowlisted id. | `security.ts` |
| `SMARTSPECTRA_CAPI_PATH` set unconditionally to the bundled library in packaged builds | `index.ts` top |
| Test-only fake-camera switches only when `!app.isPackaged && WITNESS_E2E=1` | `index.ts` top |
| Single-instance lock | `index.ts` |
| Preload: SDK bridge bundled (sandbox allows only `require('electron')`) + one frozen `window.witness` API | `preload/index.ts` |
| IPC: every channel checks sender origin, size limit (2 MB) and zod schema. There is no generic invoke. | `ipc.ts`, `shared/ipc-schema.ts` |
| API key encrypted with `safeStorage`; memory-only if the OS has no keychain | `keystore.ts` |
| History: AES-256-GCM, data key wrapped by `safeStorage`, retention purge on launch and hourly, corrupted file quarantined | `datastore.ts` |

**Pending:** Electron Fuses at package time, electron-builder config, electronegativity, the packaged-build tests. Also pending is a check of how `bindSmartSpectraIpc` behaves on the `app://` origin on a real machine.

## Feature worker (§7.3)

- Each `VideoFrame` from the cloned track is drawn into a 320×180 `OffscreenCanvas` and closed straight away. Mean BT.601 luma is then read from the following ROIs:
  - two top-corner background patches (15% × 20%), switching to side bands if the face box overlaps them;
  - a chest patch below the face box;
  - a forehead patch.
- We use the canvas path because it's robust across pixel formats. The `copyTo(rect)` route the prompt prefers is a possible optimisation.
- The worker reports its own per-frame cost (`workMs`) for the §4.2 performance budget. It hasn't been measured yet because it needs a real camera.
