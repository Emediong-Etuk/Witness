# Video scripts

Both videos are generated from this repository, with no face footage:

- **Footage:** scripted screen recordings of the judge site and the app (Playwright). The replays are labelled synthetic. The camera check is shown with Chromium's simulated camera.
- **Cards:** rendered from HTML in the site's palette and fonts. The test counts, verify output and receipt on them come from real runs.
- **Narration:** synthesised with Piper TTS, using the LibriTTS high voice (dataset CC BY 4.0, OpenSLR 60).
- **Captions:** burned in.

No Presage credits were used: the replays need no SDK, and the camera-check scene stops before the SDK could reach Presage.

## Pitch / demo (≤ 3:00)

| # | On screen | Narration |
| --- | --- | --- |
| 1 | Title card | Witness. Camera vitals that show their work. |
| 2 | Judge site home: hero | SmartSpectra can read your pulse from twelve seconds of video, your breathing from thirty, and your heart rate variability from sixty. But its own model cards warn that motion, chewing and flickering light can produce wrong values, with high confidence. Only motion has a warning code. |
| 3 | Judge site: the window explainer (drag the disturbance, switch its kind) | Every reading summarises a window. A three second disturbance, like a cough, a bite of food, or a TV flickering behind you, lands inside every reading whose window covers it. The number hides it, and the stable flag can stay on. |
| 4 | Judge site: the rules table, opening R7 and R10 | Witness shows a number only when its entire window passed every documented condition. Still, quiet, steady light, one face, enough frames, and the SDK confident. Eleven rules, and most of them are SmartSpectra's own signals. |
| 5 | Electron app: the consent card | In the app, the camera stays off until you agree. Every session. |
| 6 | Electron app: the camera check with Chromium's simulated 15 fps camera | Next comes a free camera check. SmartSpectra stops any session below twenty five frames per second, so Witness checks first, before any minutes are spent. Here a simulated fifteen frames per second camera is held back, with a reason. |
| 7 | App (browser build): Quick, synthetic clean replay, verified pulse | To show the gate without a camera, these are labelled synthetic replays, running the real gate. In a clean session the pulse ring fills, and the value is verified. |
| 8 | App (browser build): Full, synthetic talking replay, breathing withheld with reason and countdown | Now someone talks. Breathing is withheld, with a plain reason and a countdown, until its thirty second window is clean again. |
| 9 | App (browser build): Quick, synthetic 72/min flicker replay, pulse withheld | Here the room light pulses seventy two times a minute, the same rhythm as a pulse. The SDK has no code for this. Witness checks the light, and withholds the reading. |
| 10 | App: the evidence receipt dialog | Every number it does show has a receipt. The checks it passed, its window, and hashes chained to the receipt before it. |
| 11 | Judge site Verify: tamper playground, loosen the motion threshold | And you don't have to trust me. The verifier re-runs the gate in your browser. Change one threshold, and it names the check that fails. |
| 12 | Judge site: Consent & data | Video never leaves the computer. SDK telemetry is off. Only verified numbers you choose to save are kept, encrypted on your machine. |
| 13 | Closing card with the testing note | One honest note. My own webcam is too slow for SmartSpectra, so this submission has no real camera reading yet. Please try Witness on your own camera. The check is free. No reading without a clean window. Witness. |

## Technical walkthrough

| # | On screen | Narration |
| --- | --- | --- |
| 1 | Title card | Witness, the technical walkthrough. How the gate works, how it uses the SmartSpectra SDK, and how every claim can be checked. |
| 2 | Architecture card | Witness is a TypeScript monorepo. An Electron app hosts the SmartSpectra renderer SDK. Its events are normalised by an adapter, mapped into gate events, and evaluated by the Clean-Window Gate, which emits hash-chained receipts to the UI. The same path runs from replays, so the tests and the judge site exercise the real gate. |
| 3 | SDK integration card (code from sources.ts) | The integration uses the renderer SDK with bind SmartSpectra IPC in the main process. Witness requests only what it needs: cardio and face signals for a quick check, plus breathing for a full one, and never expressions. Telemetry is off. Reading the SDK's code showed it always registers an insight sink, with no switch to turn it off, so the consent card says so. |
| 4 | Events and time card (code from real.ts) | Every SDK timestamp is mapped onto one session clock, using a running median offset learned from validation callbacks. Metrics deltas become rate, trace and face events. Face landmarks become three numbers, motion, mouth and jaw, and the coordinates are dropped. |
| 5 | Judge site: opening rules R1–R11 | The gate has eleven rules. Each one names its source: the SDK's validation codes, its stable flag and confidence, talking and blinking, and landmarks. Witness adds its own maths only where the SDK has no warning. Flicker, from background light near the reading's rate. Chewing, from sustained jaw periodicity. Motion, and a live face check. |
| 6 | A real receipt from a synthetic replay | Each evaluation produces a receipt. It records the verdict, the window, every check with its observed value, the hash of the inputs, the hash of the gate config, and the previous receipt's hash. Change anything, and the chain breaks. |
| 7 | Camera check card | Before the SDK starts, a free camera check measures real frame rate and brightness from frame timestamps, and tries lower resolutions if the default is slow. The checked stream is handed to the SDK, and exposure is locked only when the check passed. |
| 8 | Security card | The Electron app is locked down. Context isolation and sandbox, a strict content security policy, video-only camera permission for its own origin, every other network request cancelled, and zod-validated IPC on every channel. The API key and history are encrypted with the operating system keychain. |
| 9 | Tests card (output from real runs) | The tests run in CI on every push. Unit and property tests prove the gate is monotone in contamination and independent of event order. UI tests drive the real renderer with synthetic replays, including a check that the camera is never requested before consent. |
| 10 | Judge site: run the verifier, then tamper with a README number | The verifier recomputes every receipt, chain head, result and number in the docs, in the terminal or in your browser. The tamper playground shows which check catches each kind of edit. |
| 11 | Limits card | The limits, plainly. My webcam gives about sixteen frames per second, below the SDK's floor, so there is no real camera reading yet, and the held-out results say TBD. The egress audit is still pending. Please run Witness on your own camera, and check our work. No reading without a clean window. |
