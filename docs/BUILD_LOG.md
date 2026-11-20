# Witness build log

One entry per work block. Times are WAT (UTC+1). Numbers here come from commands run in this repo; nothing is estimated.

---

## 2026-11-18, ~15:40–16:00 WAT · Block 1: reference reading, monorepo scaffold, gate v1 (uncalibrated)

**Where this ran:** a Claude Code cloud container (Ubuntu 24.04, x86_64, glibc 2.39, Node 22.23.5, ffmpeg present). It has **no camera**, and its network policy blocks `github.com` and `smartspectra.presagetech.com` (HTTP 403 from the proxy). npm is reachable. Greg's own machine isn't attached yet.

**Credits used:** 0. No API key is present, and no SDK session was started.

**SDK reference.** We couldn't clone the SmartSpectra repo, so the reference is the published npm package `@smartspectra/node-sdk@3.5.0` (latest; an `rc` tag also points to 3.5.0-rc.5). Only its `.d.ts` files, JS sources and README were read; no scripts from it were run. Native package `@smartspectra/node-sdk-linux-x64@3.5.0`: 94 MB, includes `libsmartspectra_capi.so`.

Facts confirmed from the package itself:
- Main-process API: `useCamera` / `useFile` / `useCustomInput` + `sendFrame` / `checkDeviceReadiness`, plus events (`processingStatus`, `validationStatus`, `metrics`, `accumulatedMetrics`, `insight`, `error`, `frameSentThrough`, `videoOutput`).
- Renderer API: `useMediaStream`, `start/stop/reset/destroy`, `requestInsight`, `streamAvailable`, `sendTimeoutMs`. The renderer has **no** `checkDeviceReadiness`.
- 16 ValidationCode values: OK, NO_FACE, MULTIPLE_FACES, FACE_NOT_CENTERED, FACE_SIZE_OUT_OF_RANGE (deprecated), TOO_DARK, TOO_BRIGHT, CHEST_NOT_VISIBLE, CAMERA_TUNING, FRAME_RATE_TOO_LOW, EXCESSIVE_MOTION, FACE_TOO_CLOSE/FAR/HIGH/LOW, FACE_NOT_FORWARD. That's 15 non-OK codes, 14 of them non-deprecated, so it matches "14 actionable". None covers chewing, flicker or talking.
- Metrics protobuf: `cardio.pulseRate[]` and `breathing.rate[]` are `MeasurementWithConfidence {value, stable, confidence, timestamp}`; `cardio.hrv[]` is `{rmssd, meanNn, sdnn, baevsky, timestamp, confidence, stable}`; `face.landmarks[] {value: Point2dFloat[], stable, reset, timestamp}`; `face.talking[]` / `face.blinking[]` are `DetectionStatus {detected, stable, timestamp}`. Timestamps can be protobuf `Long`.
- `MetricType` bundles: `cardioMetrics = [15,16,17]`, `faceMetrics = [11,12,13,14]` (14 = EXPRESSIONS, which we exclude), `breathingMetrics = [0,1,2]`.

**§7.6 insights: static finding (empirical tests still to do on Greg's machine):**
- The native config struct `smartspectra_config_t` has `api_key, requested_metrics, enable_accumulated_output, log_level, struct_size, disable_telemetry, reserved0`. There is **no field to disable insights**. Telemetry has an opt-out; insights don't.
- `SmartSpectraSDK._ensureSession()` (js/smartspectra.js) always passes an `onInsight` function to the native session, whether or not the app registered an `'insight'` listener. Separately, `bindSmartSpectraIpc` (js/main/index.js) always registers `sdk.on('insight', …)`. So on the Electron path the native `on_insight` slot is **never null**, and leaving out a listener can't stop dispatch from the JS side.
- `strings` on `libsmartspectra_capi.so` shows `SetOnInsight`, `RequestInsight` and `forward_insight`, but no gateway hostnames. The endpoint therefore lives in `libsmartspectra.so` or is assembled at runtime. The egress audit (§13.7) has to find it.
- Recorded in docs/EGRESS.md as "static analysis: cannot be prevented from JS; empirical result pending".

**Decisions:**
- **Monorepo:** npm workspaces with one root `tsc --noEmit` typecheck. Project references were dropped because they added build steps and gave nothing in return here. Packages export TS source directly (`main: ./src/index.ts`), which works for Vitest and Vite.
- **Gate depends on `@witness/features`** (pure, zero-dep DSP) as well as `@noble/hashes`. R9 has to run the spectral test against the reported value, so the gate can't take pre-digested features.
- **Verdict refinement (documented in `decide()`):** while R1 (warm-up) fails, R2 (SDK confidence), R3 (range) and R11 (no blink yet) don't make the verdict WITHHELD. They're evidence that builds up over time, not contamination. Any contamination rule failing still gives WITHHELD, so monotonicity holds (property-tested).
- **During warm-up, evidence is judged over `[sessionStart, t]`**, not `[t−W, t]`, so the pre-session part of the window doesn't count as "missing evidence".
- **Missing evidence fails closed.** No face features means R6, R10 and R11 fail. No frames means R8 and R9 fail. No validation events means R4 fails. No talking state means R7 fails.
- **The chewing detector needs sustained periodicity** (3 consecutive 3-s windows, hop 1 s, scored by the weakest of the three). With a single-window peak, band-passed white noise crossed 0.5.
- **zod upgraded 3 → 4.6.7**, because `npm audit --omit=dev` flagged GHSA-mrhx-c7xc-m3w5 (high). After the upgrade, audit reports 0 vulnerabilities.

**Measured (this block):**
- `npx vitest run`: 75 tests pass (features 29, gate 37 + 5 property, schema 4).
- Coverage, gate + features: lines 99.79%, branches 94.63% (`npx vitest run --coverage`).
- Synthetic false-reject check with the **uncalibrated placeholder** thresholds: 25 of 900 clean synthetic evaluations withheld (seeds 1–300 × 3 metrics). 18 were R10 chewing on noise and 7 were R9 coincident SNR on noise. This is synthetic white noise, not real data. It shows why calibration is needed and doesn't predict real-world FRR. The property tests therefore use a copy of the config labelled "synthetic-calibrated" (R10 maxPeak 0.8, R9 SNR 25).
- Gate cost: about 3.5–5 ms per evaluation on this container (450 evaluations of a 150-s synthetic session in 2.1 s). Rate samples arrive at ~1 Hz per metric, so this runs off the per-frame path.

**Open / blocked on Greg:** machine OS/hardware, the API key in `.env`, the Presage MCP login, ground-truth device, clip publishing, second-person consent, final name. See the questions at the end of this block's chat message.

---

## 2026-11-18, ~16:00–17:40 WAT · Block 2: Electron shell, replay mode, session controller, UI tests

**Credits used:** 0 (no key, no SDK session; everything ran on synthetic replay).

**Built:**
- `packages/sdk-adapter`: `SourceEvent` vocabulary (no frames, no coordinates), `normalizeMetrics` (protobuf deltas → events; `Long` timestamps), `LandmarkFeatureTracker`, `GateEventMapper`, `TraceReplaySdk` (JSONL, original timing, injectable clock), `RealSmartSpectra` (injected renderer SDK; clock alignment from validation callbacks), and 7 **synthetic** scenarios. Synthetic traces are labelled `synthetic:*` with `sdkVersion: "synthetic"`, are marked in the UI, and must never be reported as results.
- `packages/session`: `SessionController` + XState flow. A source can only be created by `accept()` from the consent state. Covers progressive results, auto-complete, pause on MULTIPLE_FACES, stop on hide/cap/user, and no auto-restart on errors. The check-in record includes the SDK-stable-but-withheld "ghost" readings.
- `packages/ui`: tokens (dark + light), rings (spring rewind, coral break tick, glow pulsing at the verified BPM), thermal receipt card, sparkline, DPR-aware waveform. Fonts are self-hosted (OFL).
- `apps/desktop`:
  - main process: app:// protocol + CSP header, permissions, navigation lock, encrypted key store, AES-GCM history store, settings, zod-validated IPC;
  - bundled preload;
  - React renderer: home, key setup, consent, measuring, results rail, receipts, history with ghost overlay, data sheet with 1.5-s hold delete;
  - feature worker.
- The browser build of the same renderer (`npm run build:web`) uses an in-memory bridge and is replay-only.

**Decisions:**
- **`stream_ready` gate event.** The first screenshots showed breathing and HRV as "Withheld · framing" during warm-up, because the SDK's start-up CAMERA_TUNING (0–2 s) fell inside their windows. Windows now count from the end of start-up tuning. Mid-session tuning still counts as non-OK. Three new gate tests cover this.
- **Receipt threshold keys now match the observed keys** (e.g. `nonOkShare` / `nonOkShare`), so the receipt can print "observed / limit" per line.
- **One event stream** (`on(listener)`) instead of the prompt's `on('metrics'|'validation'|…)`. It's simpler, and real and replay are indistinguishable to the UI apart from `kind`, which drives the Replay badge.
- **Tooling:**
  - npm 10 (Node 22 here) crashes in arborist (`edgesOut`) resolving vitest 5's peers, so the repo needs **npm ≥ 11**, which ships with Node 24. `engines` is set to match.
  - Upgraded to vitest 5.1.0 + vite 8.3.5, because one vite version is needed across electron-vite, plugin-react and vitest.
  - All new versions were published before 2026-11-04 (≥ 2 weeks old).
- **Electron can't run in this container.** Its binary download comes from GitHub, which the proxy blocks (`ELECTRON_SKIP_BINARY_DOWNLOAD=1`). `electron-vite build` succeeds, the preload bundle requires only `electron`, and main externalizes only `@smartspectra/node-sdk` and `zod`. **The first real Electron launch has to happen on Greg's machine.**

**Measured (this block):**
- `npx vitest run`: 107 tests pass.
- `npx playwright test` (renderer in Chromium 1.63, synthetic replay, in-memory bridge): 10 pass. They cover:
  - no `getUserMedia` before consent;
  - progressive results + receipt;
  - talking → breathing withheld with reason + countdown;
  - flicker → pulse withheld;
  - multiple faces → pause/resume;
  - hide → stop within 1 s;
  - history ghost overlay;
  - hold-to-delete;
  - axe-core with 0 serious/critical violations in dark and light.
- axe initially flagged light-theme contrast. Fixed by darkening `--verified` (#0a7042) and `--warming` (#8a5900) in light mode, and by changing the replay label inside the primary button.
- `npm audit --omit=dev`: 0 vulnerabilities. Dev-only: `picomatch` ReDoS advisory (GHSA-fc5q-39xc-vjpf, all versions, no fix available), pulled in by build tooling. Documented exception.

**Not done yet / next:** first Electron launch + `m1-sdk-hello` on Greg's machine; egress audit; bench record/replay/calibrate; verify CLI; packaging, fuses, release; judge site.

---

## 2026-11-18, ~17:40–18:40 WAT · Block 3: egress audit + bench pipeline

**Credits used:** 0. Nothing has run against the real SDK. Every pipeline was exercised with a stub SDK, ffmpeg-generated test clips, local sockets and labelled synthetic traces.

**Built:**
- **`tools/egress-audit`**:
  - socket-table sampler over the whole process tree (`ss` → `lsof` → `Get-NetTCPConnection`);
  - logging CONNECT proxy (host:port only, never headers, so the key can't leak into a log);
  - `runAudit` (spawn or attach);
  - headless SDK `probe` (refuses without `--i-am-the-subject`; reads the key from env or `.env`; stores insight counts, ids and byte sizes, never text);
  - `matrix` (the five §7.6/§13.7 configurations, fixed up front);
  - `report`, which writes `docs/EGRESS.md` between markers.
- **`tools/bench`**:
  - `record`: consent-gated by the manifest, feeds frames at or below real time with the clip's own timestamps, records the timestamp passthrough check, uses the same `roiLayout` as the worker (now shared in `packages/features`), writes hash-chained traces;
  - `replay`;
  - `calibrate`: calibration split only, p99 × 1.5 method fixed in code, FAR/FRR curves;
  - `report`: held-out only, with the definitions fixed in `DEFINITIONS`, clip-level cluster-bootstrap CIs, accuracy vs ground truth, per-rule attribution, time to first verified value, coverage and the flicker hero metric. It refuses to run unless `m4-thresholds-frozen` exists, is an ancestor of HEAD, and the config is unchanged since the tag.
- **Manifest schema:** condition labels, intervals, flicker rate, paced breathing rate, consent with a `publishVideo` flag, and the clip file. `corpus/README.md` holds the clip plan.

**Decisions:**
- **Contamination definition fixed now** (`CONTAMINATES` in `tools/bench/src/manifest.ts`), from the model-card "does not work when" lists:
  - talking → breathing;
  - chewing → pulse and HRV;
  - motion → all metrics;
  - flicker, TV light, generator light → pulse and HRV;
  - dark clothing → breathing.
  - Photo and second person contaminate everything. They aren't model-card conditions, but the reading can't be the user's.
- **CIs resample whole clips, not readings.** Readings taken 1 s apart share most of their window.
- **The egress probe uses the main-process SDK.** `bindSmartSpectraIpc` always registers an insight sink, so §7.6 test (b) ("no listener") is only meaningful in the headless path. The app itself is audited separately with `attach`.

**Measured (this block):**
- `npx vitest run`: 128 tests pass (bench 10, egress 11 new).
- On the stub-SDK record test (4 s, 120-frame ffmpeg clip):
  - 120/120 frames were sent with strictly increasing timestamps;
  - passthrough check = 1 (by construction of the stub);
  - the trace holds 120 frame, 120 validation and 120 face_feature events;
  - no coordinates appear in the trace text.
- The real `lsof` sampler saw a child process's held-open TCP connection, sampled every 200 ms.

**Credit estimates for the real runs** (from the clip plan; actual minutes will come from `bench:estimate` on Greg's clips):
- ★ set of 9 clips × ~75 s ≈ 11 min of video;
- full plan of 26 clips ≈ 33 min;
- egress matrix ≈ 15 min;
- SDK reproducibility (2 clips × 3 runs) ≈ 7.5 min;
- total for everything ≈ 55–65 min.
- **ASK GREG:** check remaining credits (portal or MCP `usage.get_plan`) before any of these runs. Anything over 25% of what's left needs his OK.

---

## 2026-11-18, ~18:40–19:40 WAT · Block 4: verify command

**Credits used:** 0.

**Built:**
- **`packages/bench-core`:** the pure, browser-safe parts of the bench, moved out of `tools/`:
  - trace and receipt codecs (via `@noble/hashes`);
  - contamination labels;
  - replay and stats;
  - the report;
  - doc markers (`<!-- bench:<path>|<format> -->…<!-- /bench -->`);
  - egress table rendering.
- **`packages/schema`:** strict `TraceLineSchema`.
- **`packages/verify`:** `verifyAll()` and `verifyCheckins()`. The checks are listed in ARCHITECTURE.md.
- **`tools/verify`:** the `npm run verify` CLI, the `npx witness-verify [corpus/]` bin and `verify checkin <file>`. It reads git to check the freeze order.
- **`bench:replay --write`** stores receipts; `bench:report` fills the doc markers; `bench:docs` refills them.
- **README:** the §3 headline's measured line is now made of markers showing TBD. `docs/TEST_REPORT.md` has a skeleton with 12 markers.
- CI runs `npm run verify`.

**Finding (determinism):** verify's first run on the test fixture failed `receipts.*`, and it was right to. Traces are stored as canonical JSON (floats rounded to 6 decimals), so receipts computed from in-memory lines differ in the 6th decimal of R9 observations from receipts computed from the published file. The real pipeline already computes receipts from the file. This is now a stated rule in `tools/bench/README.md`, and the fixture mirrors it.

**Measured (this block):**
- `npx vitest run`: all tests pass (count in the commit message).
- `npm run verify` on this repo: OK. It reports 0 traces (none recorded yet) and 17 embedded numbers, all of them TBD placeholders.
- The verify core bundles with Vite for the browser with no Node shims, and in Chromium it recomputed 15/15 receipts of a test trace and matched them.
- Tamper tests: each tampered case fails its named check. Cases covered:
  - a trace line;
  - the manifest pin;
  - a stored receipt;
  - a threshold;
  - a result number;
  - a doc number;
  - a typed number where TBD is required;
  - an unknown marker path;
  - unfrozen results;
  - a freeze after the held-out run;
  - an unlisted trace;
  - a missing trace or receipts file;
  - a hand-edited egress table;
  - export value/hash/config forgery.

---

## 2026-11-18, ~19:40–20:40 WAT · Block 5: lab recorder

**Credits used:** 0.

**Built:** `tools/lab-recorder`, run with `npm run lab`. It's dev-only and never packaged.
- **Clip plan** (`plan.ts`): 27 templates covering all 13 conditions from §13.2, 11 of them ★. Each template has scripted cues, a split and setup text. Labels are cue times ±1 s (`REACTION_PAD_S`).
- **Server** (`server.ts`):
  - bound to 127.0.0.1, with a random token in the page that API calls must echo;
  - a Host-header check against DNS rebinding;
  - uploads only for plan IDs and only with `X-Consent: attested`, no silent overwrite, and a 2 GB cap;
  - manifest entries validated against `ManifestClipSchema`, including the clip hash check.
- **Page:**
  - camera preview, with an attempt to lock exposure, white balance and focus (the result is recorded in the notes);
  - consent checkboxes;
  - 3-2-1 countdown, then MediaRecorder at 25 Mbps;
  - cue display with a next-cue countdown, reading text and a paced-breathing circle;
  - an oximeter-pairs form.
- **Flicker page:** photosensitivity gate, 3 Hz cap, smooth sine brightness, wake lock, and a standalone download for phones.

**Decision:** a localhost web app instead of an Electron window. It runs in any browser on Greg's machine, and it's fully testable here with Chromium's fake camera.

**Measured (this block):** 5 lab tests pass. The end-to-end test does the following:
1. Real Chromium with a fake camera drives the actual recorder page through the 4-s test clip Z1: consent, cues, upload, form, save.
2. The manifest entry validates, with padded intervals and ground truth.
3. The bench's `probe()` reads the WebM frame by frame with per-frame timestamps.
4. `recordClip` with the stub SDK sends every frame and writes a valid trace (timestamp passthrough = 1).

So recorder output feeds straight into the bench.

**Not done:** running the live SDK + gate during recording (§13.2, "if CPU allows"). It's optional, and it can't be tested here.

---

## 2026-11-18, ~20:40–22:30 WAT · Block 6: judge site + compliance lint

**Credits used:** 0.

**Built: `apps/web`**, a static judge site hosted on Vercel, as Greg chose. It uses the same design system as the app (Instrument Serif / Geist, mint/amber/coral/violet, dark and light themes).

**Pages:**
- **Overview:**
  - hero with an animated clean-window illustration (labelled as an illustration);
  - the headline numbers, rendered from `results.json` as TBD chips until then;
  - click-to-load video cards;
  - an interactive window explainer: drag a disturbance and watch which 12/30/60-s readings it contaminates, using the bench's own `CONTAMINATES` map;
  - an expandable rules table with live thresholds from `gate.v1.json`;
  - a receipt card;
  - a bench-progress tracker.
- **Replay Lab:** the real gate on labelled synthetic scenarios (and corpus traces once published), with a timeline of SDK-stable readings against Witness verdicts, condition bands, a receipt drawer, and a scrubber with play driving live rings and the coaching text. No aggregate counts are shown for synthetic data.
- **Verify:**
  - `verifyAll` in a Web Worker over the published corpus;
  - a tamper playground with 6 ways to cheat, run on a labelled demo corpus;
  - a check-in drop zone, plus a sample export.
- **Results:** the protocol stepper and the fixed definitions. The tables render only from `results.json`.
- **Run it:** four paths, with copy buttons.
- **Consent & data:** the egress truth table (the AI auto-insight row is marked pending), the app's consent card text imported from the app's own strings file, the misuse-prevention design and the limitations.
- **Flicker tool:** photosensitivity gate, 3 Hz cap, full-screen, wake lock.

**Guided tour** (`src/tour`): 19 steps across all 7 pages.
- A spotlight cut-out springs from target to target, with a pulsing ring and smooth scroll.
- Click-blockers sit *around* the hole, so the highlighted control stays usable (a test drags and clicks during the tour).
- Card placement goes below, then above, then beside the target, then docks at the bottom; mobile gets a bottom sheet.
- Progress bar, Back/Next/Skip, ←/→/Enter/Esc, focus management.
- A first-visit prompt (suppressed under automation), with the choice remembered.
- Reduced motion turns the springs off.

**Vercel:** `vercel.json` with a workspace-scoped install, SPA rewrites and strict security headers (`docs/DEPLOY.md`).
- A plain `npm ci` would download the SDK's native packages for all platforms. The scoped install skips them, finishing in 6.5 s with no `@smartspectra` packages, and building cleanly from a fresh copy.
- Deployment itself needs Greg: this container can't reach vercel.com.

**Compliance lint** (`tools/compliance`, `npm run lint:compliance`, in CI): the §10.5 banned patterns with word boundaries, an allowlist for our fixed disclaimers, and scope limited to everything users and judges read. Current result: 0 hits.

**Findings fixed during this block, from the tests:**
- **Fonts under the CSP.** Vite inlined small font files as `data:` URIs, which `font-src 'self'` blocked, so fonts silently fell back. The site's CSP test caught it, and the desktop renderer had the same latent bug. `assetsInlineLimit: 0` is now set in all three Vite configs.
- **Tour clicks.** The tour overlay's root layer swallowed clicks inside the spotlight.
- **Mobile overflow.** `/verify` overflowed by 102 px on a 375-px screen, because grid items had `min-width: auto` around long commands and hashes.
- **axe issues:**
  - labels that didn't match the accessible names (tour button, video buttons);
  - focusable dots nested inside `role="img"`;
  - scrollable code blocks that weren't focusable;
  - a fade that failed contrast mid-animation.

**Measured (this block):**
- `npx playwright test`: 23 pass, 13 site + 10 app. The site tests cover:
  - all routes by deep link under the CSP, with 0 console errors and 0 third-party requests;
  - TBD chips in the headline;
  - the full 19-step tour across all 7 routes;
  - Back/Esc and interaction during the tour;
  - explainer keyboard;
  - the Replay receipt drawer;
  - verify honest (OK) and tampered (the failing `docs.README.md` check listed first);
  - the sample check-in;
  - the flicker gate;
  - no horizontal scroll at 375 px;
  - axe with 0 serious/critical in dark and light.
- Compliance lint: 2 tests pass, with 0 hits in scope.
- The tamper playground takes about 6 s in the browser to build and verify the demo corpus.

### First launch on Greg's machine (Windows): "Electron uninstall"
- `npm run dev -w @witness/desktop` failed with `Error: Electron uninstall` from electron-vite's `getElectronPath`.
- Cause: Electron 45 has no postinstall; its binary is fetched lazily by `install-electron` (or on first `require('electron')`), and electron-vite 6 only checks for `path.txt`, so it throws before anything downloads.
- Fix: `"predev": "install-electron"` in `apps/desktop/package.json`, so `npm run dev` fetches the binary first (it exits at once if it's already there). Checked in the container: the download wrote `node_modules/electron/path.txt` and `dist/`.
- With the binary now downloadable here, the real Electron app runs in the container (xvfb + Playwright `_electron`). Two fixes came out of that:
  - **`app://` pages failed to load outside dev** (`ERR_BLOCKED_BY_CLIENT` → `ERR_UNEXPECTED`). The protocol handler loaded files with `net.fetch(file://…)`, and our own request filter, which allows only `app://`, blocked `file:`. This would have broken the packaged build. The handler now reads files from disk with a fixed MIME allowlist, and the filter stays strict. Checked: the home screen loads from `app://witness/index.html`, and a Quick clean replay completes, verifies, chains 14 receipts and saves.
  - **`safeStorage` deprecation warnings** (seen on Greg's first launch). KeyStore and DataStore now use `isAsyncEncryptionAvailable` / `encryptStringAsync` / `decryptStringAsync` (re-encrypting when `shouldReEncrypt` says so), and DataStore runs its operations one at a time so awaits can't interleave writes. No warnings in the container run; 157 unit tests pass.
- Greg's log also showed `Network service crashed or was terminated, restarting service` once. Chromium restarts that service by itself. It didn't recur in the container; watching for it.
- **Unstyled window in dev mode** (Greg's second screenshot). The renderer's meta CSP has `style-src 'self'`, and in dev Vite injects CSS as inline `<style>` tags, so all styles were blocked (Chromium: "Applying inline style violates … 'style-src 'self''"). My headless check had used the built app, which ships real `.css` files and was fine. Fix: `config/vite-dev-csp.ts`, a serve-only Vite plugin that adds `'unsafe-inline'` to `style-src` while the dev server runs, used by the desktop, web-renderer and site configs. Checked: under `electron-vite dev` the h1 renders in Instrument Serif, and the built `index.html` still has `style-src 'self'`.

### First camera check-in: "Your camera dropped below 25 fps"
- Greg's first real Quick check-ins kept ending at about 13 s with SDK error 14 (`kSustainedLowFrameRate`). The SDK stops a session whose frame rate stays below 25 fps, and the minutes used up to that point still count.
- Why it repeats: the SDK opens the camera at 1280×720 / 30 fps (`ideal`) and locks exposure, white balance and focus once Running. In a dim room a webcam lengthens exposure and drops to ~15 fps, and the lock keeps it there. Windows "low-light compensation" and IR / face sign-in cameras give the same symptom. Witness had no way to see this before the SDK started, and no camera picker.
- Fix: a **camera check** between consent and the SDK start, which uses no credits.
  - Witness opens the camera itself with the SDK's default request (plus an optional chosen device) and reads ~3 s of frames through `MediaStreamTrackProcessor`. It computes fps from capture timestamps and mean brightness from a 32×18 downscale of every 8th frame. Nothing is kept.
  - `assessCamera` (pure, unit-tested): ≥ 27 fps passes and starts at once; 25–27 is allowed with a warning; < 25 is held back with the reason (dim → "face a window or a lamp"; bright → low-light compensation / another camera). A near-black picture is called out separately (shutter, IR camera), and so is a camera that sends no frames.
  - A camera picker appears when there's more than one camera. The choice is remembered per device (localStorage). "Start anyway" stays available, with the warning that minutes may still count.
  - The checked stream goes to the SDK through `useMediaStream`, so the camera isn't reopened. Because the SDK doesn't lock host streams, Witness locks exposure/WB/focus itself once status is Running, and only if the check passed. Witness stops the tracks on stop/destroy.
- Checked in real Electron with Chromium's fake camera fed from y4m files:
  - 15 fps → held back with "15 fps; SmartSpectra needs 25";
  - black → "almost black image";
  - 30 fps → starts at once, the SDK runs on our stream, and it ends here with "Can't reach Presage" (code 5), because the container blocks Presage. No credits were used.
- Also found and fixed while testing: **closing the window mid-measurement crashed the process** (`FATAL ERROR: Error::ThrowAsJavaScriptException napi_throw` in the SDK's native runtime). This reproduced on `main` too, so it wasn't introduced here. The window's `close` is now deferred 1.2 s: it hides at once, the renderer gets the same stop signal as on minimize, then the window closes. 0 crashes in 3 runs.
- Side observation for the egress / insights notes: with the network blocked, the native runtime logs fetch attempts for `expressions-inference` and `phasic-bp-inference` models, though Witness requests neither expressions nor BP. Recorded, not yet investigated.
- **Resolution fallback in the camera check.** Greg's camera reports a steady 16 fps that more light doesn't change. The floor is the SDK's (error 14), and Witness won't fake it by duplicating frames or rewriting timestamps: that would make the pulse wrong. A fixed low rate is often a capture-mode limit, though: many webcams reach 30 fps at 1280×720 only in MJPEG and fall to 10–16 fps otherwise, while 640×480 runs at full rate.
  - When 1280×720 (the SDK default) is slow, the check now tries 640×480 and then 640×360, each with `frameRate: { min: 25 }`, and samples each mode that opens for 2.5 s.
  - `pickProfile` (pure, unit-tested) takes the first good mode, else a borderline one, else reports the fastest mode, still held back.
  - The note says which resolution is in use and what 1280×720 gave. When no mode reaches 25 fps it says so ("this is the light or the camera itself").
  - Checked with the 15 fps fake camera: the lower modes are refused at the 25 fps minimum and the note shows. Checked with the 30 fps one: it starts at once at 1280×720. The fake device can't model a mode-dependent frame rate, so the fallback path is covered by unit tests, not by a real camera.

### Note to judges: no live reading on the author's machine
- Greg's webcam gives about 16 fps at a low resolution. The resolution fallback didn't get it to 25 fps, and he has no other camera to use. He asked for this to be reported plainly, with a request that judges test on their own devices.
- What is true and now stated (README, judge-site home page + tour step, Run page):
  - SDK 3.5.0 started on his machine with his key, then stopped with error 14 before the first 12-s pulse window filled. There is **no real-camera reading** in the submission, and the held-out numbers stay TBD.
  - The note also lists what was verified without a live camera: synthetic replays in real Electron and in the browser build; the camera check and SDK hand-off with Chromium's simulated camera; the gate, receipts and verifier in CI.
- Also corrected on the Run page: option B pointed to GitHub Releases, but packaging was never done, so there are no installers. `SITE.releasesUrl` is now `null`, and the card says installers aren't published and points to option C. The README's run section now has the full from-source steps, the 25 fps requirement and the Windows notes.
- The "Start with the videos" tour step no longer promises "live SmartSpectra signals" in the demo.

### Pre-submission judging and fixes (2026-11-20)
- Ran a strict hackathon-judge pass. It scored **66/100**, "not ready". The blockers:
  - **No live SDK signal anywhere.** All readings on screen come from synthetic replays, and `corpus/traces/` is empty.
  - **Placeholder video IDs** in the DEV post and on the site.
  - **Contradicted claims:** the Releases link on the live site, the walkthrough length, and the "14 warning codes" count.
- **Fixed now:**
  - **README first screen rewritten:**
    - what it is and the one rule, plus the judge site link;
    - "Judges, start here" do/see steps, which need no key;
    - the testing note, now with evidence (`docs/evidence/2026-11-19-first-check-in-error-14.png`);
    - a real-vs-simulated table;
    - an AI-assistance statement and a docs index.
  - **"14 warning codes" reworded.** The SDK's `.d.ts` lists 15 non-OK validation codes, including CAMERA_TUNING, so the count depends on definitions. Every place now says "of those three conditions, only motion has a validation code (EXCESSIVE_MOTION)".
  - **"Most webcams give 25 fps" → "many … in good light".** It wasn't measured.
  - **Video lengths now match the files:** pitch 2:22, walkthrough 3:20 (the site config, the DEV post, the CTA and the tour).
  - **`TODO(verify)` on the landmark indices** replaced with a stated, unverified assumption.
- **New: `npm run bench:add-clip`.** It registers a clip recorded elsewhere (e.g. a phone) in the manifest. It's offline: it probes the file, refuses anything below 25 fps, without `--i-consent`, duplicate IDs, or labels past the end of the clip, then hashes the file and writes a schema-valid entry. 5 tests, including real ffmpeg-made 30 fps and 15 fps clips. This is the route to a real SDK trace when no webcam reaches 25 fps.
- **First real `bench:record` (Greg's PC, phone clips B1/T1, 1920×1080):** it failed with "SmartSpectra is not in a valid state for this operation", preceded by `Usage verification failed. Status code: 0`.
  - **Reproduced here** with the real SDK 3.5.0 and a dummy key, Presage unreachable: the usage check fails with status 0, then the SDK raises error 5 (`kNetworkError`) and goes to the error state.
  - **Why the message was misleading:** `bench:record` stored SDK errors silently and kept calling `sendFrame`, which then threw the generic "not in a valid state" message.
  - **Fixed:**
    - every SDK error and status change is now logged as it happens, with its name;
    - feeding stops at the first terminal error with a summary ("stopped after N of M frames. First SDK error: 5 (networkError): …. No trace was written.");
    - clips wider than 1280 px are scaled to 1280-wide before feeding (the SDK's pipeline is tuned for 720p);
    - `WITNESS_SDK_VERBOSE=1` raises the SDK log level to info.
  - Two new stub tests, plus the real-SDK reproduction above. On Greg's side, the open question is why the SDK couldn't reach Presage from `node` on his PC (network, VPN, or antivirus HTTPS scanning).
- **Second real run (Greg's PC): the SDK processed both clips**, the first real SmartSpectra traces in the project. B1 has 3,664 trace lines and T1 has 3,628, both chained, pinned and schema-clean. Two problems showed up:
  - **0 receipts.** The gate produced no readings. Likely cause, reproduced here: phone videos are stored sideways with a rotation flag. `ffprobe` reported the stored 1920×1080 while `ffmpeg` decoded upright 1080×1920 frames: the same byte count, so nothing failed, but every frame was read with the wrong width. That means scrambled pixels, no face, and no readings.
    - **Fix:** `probe` now applies the rotation (side-data `rotation` or the `rotate` tag) and reports the decoded size, and `feedSize` caps the long side at 1280.
    - **Test:** a clip flagged with a 90° rotation must reach the SDK stub as 360×640.
    - **New `bench:summary`:** an offline inspection tool that counts readings and validation codes in a trace, to confirm this on Greg's traces before spending credits on a re-run.
  - **`docs.EGRESS.md` ✗ on Windows:** the CRLF checkout didn't match the LF-generated table. The verifier now normalises line endings. `.gitattributes` forces LF and marks traces and receipts `-text`, so their bytes (and hashes) never change on checkout.
- **Third real run: the first real readings.** Re-recorded B1/T1 after the rotation fix. Each clip is 720×1280 upright, with 0 SDK errors and about 96% `ok` validation frames. `npm run verify`: 2 traces, all 45 receipts recomputed and matched. From `corpus/receipts/`, with no ground truth and uncalibrated thresholds:
  - **B1 (still and quiet):** 16 readings, 2 pulse and 14 breathing. **One pulse VERIFIED (77.7 bpm at 53.5 s).** The other SDK-stable pulse, at 50.4 s, was withheld by R9 alone.
  - **T1 (talking 25–45 s):** 29 readings, 10 marked `stable` by the SDK, and Witness withheld all 10.
    - Breathing was withheld with R7 ("You spoke") from 23 s onwards.
    - After the talking, the SDK's pulse fell from 72–80 to 49–58 bpm. The readings at 56.9 s (53.9 bpm) and 59.2 s (57.7 bpm) were still `stable`, and Witness withheld them for R4 (non-OK validation codes) and R6 (motion).
  - **R9 (steady light) fires on the clean clip too.** Its placeholder threshold is too strict for phone video (auto-exposure). This is a calibration problem, and two clips aren't enough to calibrate (`minCleanReadings` is 30).
  - **Site and docs updated:** the Replay Lab opens on the real traces, labelled "real SDK output". The README, `TestingNote`, the tour, the DEV post and `CONSENT_AND_DATA` now say real SDK output exists from phone clips, while a live webcam check-in and held-out results don't.
- **Videos published** on YouTube: demo https://youtu.be/t9cM9Yxl6Xg (2:48), walkthrough https://youtu.be/8R1XOzlivdc (3:29). The IDs are in `site.config.ts` (the site embeds them from youtube-nocookie.com, and only after the user presses play; e2e checks both), in the DEV post (`{% youtube %}` embed + link) and in the README links row. The last placeholders are gone.

### Installers (2026-11-20)
- Goal: judges test with their own camera without installing Node.
- **`tools/package/stage.mjs`** builds a self-contained app folder outside the npm workspace:
  - the built app (`apps/desktop/out`);
  - the runtime dependency closure (`@smartspectra/node-sdk`, `zod` and their dependencies), pinned to the exact root-lockfile versions through `overrides`;
  - the electron-builder config.
- **What electron-builder 26.18.1 packages:**
  - the asar archive gets only the SDK's JS; `koffi` is unpacked (native `.node`);
  - **only this platform's** SmartSpectra runtime is copied to `resources/smartspectra/`. The packaged main process already points `SMARTSPECTRA_CAPI_PATH` there.
  - Other platforms' runtimes (65–100 MB each) are excluded.
- **Checked here** (Linux AppImage, 181 MB): the packaged `linux-unpacked/witness` was launched under xvfb with Chromium's fake 30 fps camera.
  - It loads `app://witness` with `isPackaged: true` and `SMARTSPECTRA_CAPI_PATH` pointing at the bundled `libsmartspectra_capi.so`.
  - Key screen → consent → camera check passes → **the SDK starts from the bundled runtime**. It then ends with "Can't reach Presage" (code 5), because the container blocks Presage.
- **`.github/workflows/release.yml`:** a matrix job, Windows x64 (NSIS), macOS arm64 (dmg, ad-hoc signed) and Linux x64 (AppImage).
  - Each build asserts that the bundled runtime exists.
  - On a `v*` tag it publishes a GitHub Release with SHA256SUMS and install notes for unsigned builds. On PRs touching packaging it only builds artifacts.
  - All builds are unsigned (no certificates); the notes explain SmartScreen and Gatekeeper.
- **Released v0.1.0** (https://github.com/Emediong-Etuk/Witness/releases/tag/v0.1.0). The `release` workflow built it from tag `v0.1.0` at `f4aef73`:
  - `Witness-Setup-0.1.0-win-x64.exe` (163 MB);
  - `Witness-0.1.0-mac-arm64.dmg` (166 MB);
  - `Witness-0.1.0-linux-x86_64.AppImage` (181 MB);
  - `SHA256SUMS`.
  - The first tag had been pushed on the PR #9 merge, before the macOS runner fix. That run was cancelled and published nothing, so the tag was moved to the PR #10 merge.
  - The site's Run page, the README, the judges' note and the DEV post now point to the latest release.
- **DEV post published:** https://dev.to/emediongrgb/witness-camera-vitals-that-show-their-work-1b73. It's linked from the site footer, the Run page and the README links row.
- **Windows installer checked on a real PC** (Greg's, 2026-11-20). The flow worked end to end:
  - `Witness-Setup-0.1.0-win-x64.exe` from the v0.1.0 release ran after SmartScreen → More info → Run anyway, as expected for an unsigned build;
  - the packaged app opened styled;
  - it took the key and showed the consent card;
  - it turned on the camera with a live preview, and the camera check tried all three resolutions;
  - it stopped before the SDK with "This camera is giving 14 fps; SmartSpectra needs 25 or more", plus the lower-resolutions note. No Presage minutes were used.
  - The screenshot shows the author's face, so it's kept out of the repo.
