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
