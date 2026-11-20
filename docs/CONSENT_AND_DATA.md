# Consent and data

What Witness asks before it measures, what it reads, what it keeps, and what leaves the computer. Each claim names its evidence. Anything not measured yet is marked **pending** rather than guessed. The judge site's "Consent & data" page and the app's consent card use the same wording (`apps/desktop/src/renderer/strings/en.json`).

## 1. Consent, every session

- **The camera stays off until you agree.** Each check-in starts on the consent card, and nothing opens the camera before you press **Turn on camera and start**. The browser build's UI tests check that `getUserMedia` is never called on the consent screen or during a replay (`e2e/ui-replay.spec.ts`).
- **The card says, in plain words:**
  - Video stays on this computer and is never saved.
  - Presage's SDK contacts Presage to check the API key and count minutes used.
  - During a check-in, the SDK may also send pulse, breathing and HRV numbers (never video) to Presage's AI service. Witness can't switch this off and shows no AI text unless you ask for it.
  - Only the verified numbers you save are kept, encrypted on this computer, for the retention period you choose.
  - Minimizing or hiding the window stops the camera. Only one face can be in view.
  - General wellness only, not medical advice.
- **"Don't show the full text again"** only shortens the card to a one-line summary. You still press the button every session.
- **Camera check (after consent, before the SDK).** Witness opens the camera itself for about 3 seconds to measure frame rate and brightness. It may also try 640×480 and 640×360 if 1280×720 is slow. It reads frame timestamps and a 32×18 average of every 8th frame, then closes each frame. Nothing is stored. The SDK, which is what uses Presage minutes, starts only after this (`camera-check.ts`).
- **Corpus recordings** (for the bench, not the app) need a separate signed consent per person, and the manifest schema refuses any clip without `consent.attested: true` (`packages/schema`, `ManifestClipSchema`).

## 2. What is read, and what happens to it

| Data | Read by | Kept? | Evidence |
| --- | --- | --- | --- |
| Camera frames | the SmartSpectra SDK (on this computer); Witness's feature worker (4 small regions per frame); the camera check (timestamps + a tiny average) | **No.** Frames are closed straight after reading. Witness never writes frames to disk. | `feature-worker.ts`, `camera-check.ts` |
| Face landmarks, blinking, talking | `LandmarkFeatureTracker` | **No.** They're turned into 3 numbers in memory (motion, mouth, jaw). Coordinates are discarded, and the schemas reject coordinates. | `packages/sdk-adapter`, `packages/schema` (strict), tests |
| Facial expressions | not requested | **No.** Witness never requests the EXPRESSIONS metric. | `requestedMetrics` in `events.ts` |
| Pulse, breathing, HRV readings | the gate | Only the ones that pass the gate, and only if you save the check-in | `packages/gate`, `datastore.ts` |
| Your API key | the SDK | Yes, encrypted with the OS keychain (`safeStorage`), or kept in memory only if the OS has none | `keystore.ts` |

## 3. What is stored on this computer

- **Saved check-ins:** verified values, their evidence receipts and the derived check values. No video, images, landmarks or expressions.
- **Encryption:** AES-256-GCM with a random data key, and that data key is wrapped by the OS keychain. A corrupted or tampered file is moved aside, not loaded (`datastore.ts`, `apps/desktop/test/main-stores.test.ts`).
- **Retention:** 7, 30 or 90 days (default 30). Older check-ins are purged at launch and every hour.
- **Delete everything:** a 1.5-second hold in **Your data**. It removes history, the key and settings, then checks they're gone.
- **Export:** **Your data → Export** writes a JSON file. Anyone can check it with `npm run verify -- checkin <file>` or on the judge site's Verify page, which runs in the browser and uploads nothing.

## 4. What leaves the computer

| What | Leaves? | To whom, and why | Status of the evidence |
| --- | --- | --- | --- |
| Video and frames | No | Processed locally | SDK docs and our code. Egress audit **pending**. |
| API key + usage metering | Yes | Presage, to check the key and count minutes (the SDK requires it) | SDK docs. Seen in the SDK's own logs in a no-network test run (`auth_client`, "Usage verification"). |
| SDK telemetry | No by default | Off: `enableTelemetry: false`. A switch in **Your data** turns it on. | Config. Egress audit **pending**. |
| Pulse/HRV/breathing numbers to Presage's AI gateway | **Pending** | Reading the SDK 3.5.0 code shows it always registers an insight sink, with no setting to turn it off. Whether numbers are sent without a request has not been measured yet. | Static analysis done. Probe and egress runs **pending** (`docs/EGRESS.md`). |
| Model downloads | Yes (requests from the SDK) | With the network blocked, the native runtime logged attempts to pair the device and fetch models, including `expressions-inference` and `phasic-bp-inference`, which Witness doesn't request | Observed in the container test logs (`docs/BUILD_LOG.md`). Not investigated further. |
| On-demand AI summary | Only if you ask | Off by default; not shipped in this version | UI |
| The Witness judge site | No tracking | It loads nothing from third parties until you press play on a video (`youtube-nocookie.com`) | Site CSP in `apps/web/index.html` |

The Electron app cancels every network request from its own pages except `app://`, `blob:` and `data:` (`security.ts`). The SDK's native library makes its own connections, and those aren't covered by that filter. The egress audit (`tools/egress-audit`) exists to measure them; its results are **pending**.

## 5. Built not to be misused

- **No video-file analysis in the app**, so it can't be pointed at someone else's video.
- **No background measuring:** minimizing, hiding or closing the window stops the camera.
- **One face only:** a second face withholds the readings and pauses the session.
- **No stress, emotion or expression output.** Only pulse, breathing and HRV, worded neutrally.
- **General wellness only.** The disclaimer is on every screen.

## 6. Limits we know about

- **No live webcam reading yet.** The author's webcam gives about 16 fps, and the SDK needs 25 fps or more (see the README note to judges). Two consented phone clips of the author were processed through the real SDK instead. Their videos stay private (`publishVideo: false`), and only the traces and receipts are published. The held-out results are TBD.
- **Egress and auto-insight behaviour not measured.** Until the egress audit runs, section 4 states what the SDK's code and docs say, not what was observed on the wire.
- **Accuracy limits.** Camera vitals vary with skin tone, lighting and camera. Thresholds are calibrated on a small corpus and can't catch every failure.
