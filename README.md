# Witness: camera vitals that show their work

> Work in progress for the Presage SmartSpectra SDK Challenge (`#presagechallenge`). See `docs/BUILD_LOG.md`.

**Judge site:** [witness-nine.vercel.app](https://witness-nine.vercel.app). It has a guided tour, the Replay Lab, an in-browser verifier and the flicker tool.

> **A note to the judges: please test the live camera on your own device.**
> I couldn't complete a live check-in on my own computer. Its webcam gives about 16 fps at a low resolution, and the SmartSpectra SDK stops any session that stays below 25 fps (error 14, `kSustainedLowFrameRate`). The SDK itself (3.5.0) ran on my machine with my key. It stopped for frame rate before the first 12-second pulse window could fill. Witness's camera check now catches this before the SDK starts, and it tried lower resolutions, but this webcam couldn't reach 25 fps at any of them.
>
> So this submission has **no reading from a real camera yet**, and the held-out numbers below say TBD rather than show numbers I don't have. Most laptop and USB webcams give 25 fps or more in normal light; the app's camera check tells you for free, before any Presage minutes are used. To run it, see [Run it on your device](#run-it-on-your-device).
>
> Verified without a live camera:
> - the full app on labelled synthetic replays, in real Electron and in the browser build (UI tests in CI);
> - the camera check and the hand-off to the SDK, in real Electron with Chromium's simulated camera (a 15 fps feed is held back; a 30 fps feed starts the real SDK on that stream);
> - the gate, receipts, hash chain and verifier (unit and property tests in CI, and the in-browser verifier on the judge site).

Witness shows a pulse, breathing rate or HRV value only when the **entire** analysis window behind it passed every documented condition: still, quiet, steady light, one continuous face, enough frames, SDK confident. Each shown number comes with an evidence receipt that anyone can recompute.

General wellness information, not medical advice.

## The problem

**SmartSpectra turns 12 s of video into a pulse, 30 s into a breathing rate and 60 s into HRV, and its own model cards warn that motion, chewing and flickering light can produce wrong values *with high confidence*. Only motion has one of its 14 warning codes, so an app that trusts `stable` can show a contaminated reading as reliable.**

On our <!-- bench:clips.length|int -->TBD (run npm run bench:report)<!-- /bench -->-clip held-out corpus, <!-- bench:overall.sdkFalseTrust|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> of readings the SDK marked `stable` had a documented-invalid condition inside their window (<!-- bench:accuracy.pulse.sdkStableContaminated.mae|ci-num1 -->TBD (run npm run bench:report)<!-- /bench --> bpm mean error vs a fingertip oximeter). Witness withheld <!-- bench:overall.witnessWithheldContaminated|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> of those and kept <!-- bench:overall.cleanVerified|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> of the clean ones.

<sub>Every number above is rendered from `bench/out/results.json` by `npm run bench:report`. `npm run verify` recomputes them from the published traces and fails if any differs. Brackets are 95% clip-level bootstrap intervals.</sub>

## Status

- `packages/features`: pure DSP and landmark/ROI features ✅
- `packages/gate`: the Clean-Window Gate (R1–R11), receipts and hash chain ✅ (thresholds **uncalibrated**)
- `packages/schema`: zod schemas for events, receipts, session logs and the manifest ✅
- `packages/sdk-adapter`, `packages/session`, `packages/ui`: source adapter, replay, controller, design system ✅
- `apps/desktop`: Electron shell + renderer + free camera check ✅ (the real SDK runs; no live reading yet, see the note to judges above)
- `tools/egress-audit`: socket sampler + logging proxy + headless SDK probe ✅ (no real runs yet)
- `tools/bench`: record / replay / calibrate / report ✅ (no real clips yet; held-out report locked until thresholds are frozen)
- `tools/verify` (`npm run verify`, `npx witness-verify corpus/`): recomputes every chain, receipt, result and embedded number ✅
- `tools/lab-recorder` (`npm run lab`): consented corpus recording with scripted cues, flicker page ✅
- `apps/web`: judge site with an animated guided tour, Replay Lab, in-browser Verify + tamper playground, results, flicker tool ✅ (deploy: `docs/DEPLOY.md`)
- Packaging: not started

Requires Node 24 (npm ≥ 11).

```bash
npm ci
npm test                 # unit + property tests
npm run typecheck
npm run build:web        # renderer in the browser, replay only
npx playwright test      # UI tests on synthetic replays (no camera, no key)
npm run verify           # recompute every receipt, chain head, result and embedded number (no key, no credits)
```

### Run it on your device

Desktop app from source. Installers aren't published yet. You need Node 24, a free SmartSpectra key ([register](https://physiology.presagetech.com/auth/register)) and a camera that gives 25 fps or more.

```bash
git clone https://github.com/Emediong-Etuk/Witness
cd Witness && npm ci
cp .env.example .env     # Windows: copy .env.example .env. Paste your own key; never commit it
npm run dev -w @witness/desktop
```

Then **Quick → Check in → Turn on camera and start**, and sit facing a light. The camera check runs first, uses no credits, and says whether your camera can sustain the SDK's 25 fps floor. On Windows, run these from a normal terminal, not from inside VS Code.

**Replays are synthetic.** The scenarios under "Try a replay" are generated by Witness to drive the UI without a camera or credits. They are not SmartSpectra output, and no result in this repo is computed from them.

License: MIT (Witness code). The SmartSpectra SDK is proprietary and installed from npm; it isn't redistributed here.
