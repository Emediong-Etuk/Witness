---
title: "Witness: camera vitals that show their work"
published: false
tags: presagechallenge, devchallenge, electron, typescript
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage).*

## What I Built

SmartSpectra turns 12 seconds of video into a pulse, 30 seconds into a breathing rate and 60 seconds into HRV. Its own model cards warn that motion, chewing and flickering light can produce wrong values *with high confidence*, but of those three, only motion has a validation code (`EXCESSIVE_MOTION`). A 3-second disturbance (a cough, a bite of food, a TV flickering behind you) lands inside every reading whose window covers it, and the number hides it. An app that trusts the SDK's `stable` flag can show a contaminated reading as reliable.

**Witness** is a desktop app that shows a pulse, breathing rate or HRV value only when the **entire** window behind it passed every documented condition: still, quiet, steady light, one continuous face, enough frames, SDK confident. I call this the Clean-Window Gate. Every number it shows comes with an **evidence receipt**: the checks it passed, the window, and hashes that chain to the previous receipt, so anyone can recompute it. Every number it withholds gets a plain reason ("You spoke. Breathing can't be measured while you talk.") and a countdown to when its window will be clean again.

## Demo

{% youtube t9cM9Yxl6Xg %}

- **Technical walkthrough (3:29):** [youtu.be/8R1XOzlivdc](https://youtu.be/8R1XOzlivdc)
- **Try it with your own camera:** [download the app](https://github.com/Emediong-Etuk/Witness/releases/latest) for Windows, macOS (Apple Silicon) or Linux, and use a free SmartSpectra key.
- **Judge site (no install):** [witness-nine.vercel.app](https://witness-nine.vercel.app). It has a guided tour, a Replay Lab where you can watch the gate withhold contaminated readings, an in-browser verifier with a tamper playground, and a flicker tool for reproducing the light test.

## A note on testing

I couldn't complete a live check-in on my own computer. Its webcam gives about 16 fps at a low resolution, and the SmartSpectra SDK stops any session that stays below 25 fps (error 14, `kSustainedLowFrameRate`). The SDK (3.5.0) did start on my machine with my key, then stopped before the first 12-second pulse window filled.

Witness now runs a free **camera check** before the SDK starts, which also tries lower resolutions, so a camera like mine is caught before any Presage minutes are spent. Mine couldn't reach 25 fps at any of them.

So I recorded two consented 60-second clips of myself on my phone (30 fps) and fed them through the **real SmartSpectra SDK 3.5.0** with Witness's bench tool. Those traces and their receipts are in the repo, and the Replay Lab opens on them.
- **The still clip:** Witness verified one SDK pulse reading, 78 bpm (`corpus/receipts/B1.jsonl`).
- **The clip where I read aloud from 0:25 to 0:45:** Witness withheld every reading the SDK marked `stable` (`corpus/receipts/T1.jsonl`). Breathing was withheld with "You spoke" while speech was inside its window. After the talking, the SDK's pulse dropped by about 20 bpm while some readings stayed `stable`, and Witness withheld those because the window held motion and non-OK validation codes.

Two clips with no oximeter reference are not an accuracy result. The thresholds are still uncalibrated starting values, and on the still clip, where nothing was disturbing the reading, the steady-light rule still withheld readings. That's a sign its starting threshold is too strict for phone video. So the held-out results still say TBD.

A live check-in from a webcam is still untested by me. **Please try it on your own laptop or USB webcam.** Many give 25 fps or more in good light, and the camera check will tell you for free.

What else I could verify without a live webcam:
- the full app on labelled synthetic replays, in Electron and in the browser;
- the camera check and the hand-off to the real SDK, in Electron with Chromium's simulated camera: a 15 fps feed is held back, and a 30 fps feed starts the real SDK on that stream;
- the gate, the receipts, the hash chain and the verifier, through the unit, property and UI tests in CI.

## Code

**Repo:** [github.com/Emediong-Etuk/Witness](https://github.com/Emediong-Etuk/Witness) (MIT)

**Download:** [installers for Windows x64, macOS (Apple Silicon) and Linux x64](https://github.com/Emediong-Etuk/Witness/releases/latest), unsigned, with SHA-256 sums. Install it, paste your own [free SmartSpectra key](https://physiology.presagetech.com/auth/register), and press **Check in**. You need a camera that gives 25 fps or more; the app checks this for free before the SDK starts.

Or run it from source with Node 24:

```bash
git clone https://github.com/Emediong-Etuk/Witness
cd Witness && npm ci
cp .env.example .env     # Windows: copy .env.example .env, then paste your key
npm run dev -w @witness/desktop
```

Then **Quick → Check in → Turn on camera and start**, and sit facing a light.

To check the evidence without a key or credits:

```bash
npm run verify
```

This re-runs the gate on every published trace and must reproduce every receipt, chain head, result and number in the docs.

## How It Responds to Human Signals

**What it measures:** pulse (12-s window), breathing rate (30 s) and HRV (60 s), from SmartSpectra's `metrics` stream.

**What it uses as evidence** (this is where the SDK's other signals earn their keep):
- **Validation codes:** `validationStatus`, with the SDK's own framing and lighting hints.
- **Talking and blinking:** used for breathing ("you spoke") and for a live-face check.
- **Face landmarks:** turned into three numbers (motion, mouth opening, jaw movement), then the coordinates are discarded.
- **The SDK's `stable` flag and confidence.**
- **Frame-level light patches**, read by Witness, for flicker the SDK has no code for.

**How it responds in real time:**
- **A ring for each metric** fills as its window becomes clean.
- **When a condition breaks**, the ring rewinds, the reason appears in plain words, and a countdown shows when the window will be clean again.
- **The camera check** runs before the SDK starts and tells you, with a reason, if your camera can't sustain the SDK's 25 fps floor.

**The rules (R1–R11)** are mostly SmartSpectra's own signals. Witness adds maths only where the SDK has no warning: flicker (periodicity in background light near the reading's rate), chewing (sustained jaw periodicity), motion beyond the SDK's tolerance, and a live face (blinks and micro-motion).

Here's the integration, from Witness's adapter. Every SDK timestamp is mapped onto one session clock, so the gate can tell whether a disturbance fell inside a reading's window:

```ts
// packages/sdk-adapter/src/real.ts (simplified excerpt)
sdk.on('validationStatus', (code, ts, hint) => {
  this.sdkClock.add(this.clockUs(), ts);            // learn the SDK→session clock offset
  this.events.emit({ type: 'validation', t: this.toSession(ts), code, hint });
});
sdk.on('metrics', (buf, ts) => {
  const n = normalizeMetrics(this.o.decode(buf), ts); // protobuf deltas → rate/trace/face events
  for (const e of n.events) this.events.emit({ ...e, t: this.toSession(e.t) });
  for (const l of n.landmarks) {                      // landmarks → 3 numbers, coordinates dropped
    this.events.emit(this.tracker.push(this.toSession(l.t), l.points, l.reset));
  }
});
// The stream Witness's camera check already opened goes to the SDK, so the camera isn't reopened:
if (host) sdk.useMediaStream(host);
await sdk.start();
```

Requested metrics are minimal: cardio and face signals for Quick; plus breathing for Full. Never expressions.

## Prize Categories

**Best Thoughtful Real-World Use**
- **A real need:** people take camera vitals at home in the evening, with a TV on, while talking, while eating. Those are exactly the conditions the model cards warn about. Witness tells them when a number can't be trusted, and why.
- **Usability:** a couple of clicks from launch to a result. Every withheld value comes with a plain reason and a countdown, and a free camera check heads off sessions that can't work.
- **Consent and data:** the camera is off until you agree, every session. Video is processed on your computer and never saved by Witness, and only verified numbers you choose to save are kept, encrypted. Every number it shows has a receipt anyone can recompute.

## Consent and Data Handling

The full version, with the evidence for each line, is in [`docs/CONSENT_AND_DATA.md`](https://github.com/Emediong-Etuk/Witness/blob/main/docs/CONSENT_AND_DATA.md).

- **Camera consent:** the camera stays off until you press **Turn on camera and start**, every session. The consent card says what happens to video, what goes to Presage, and how to stop. Minimizing, hiding or closing the window stops the camera.
- **Processing:** video is processed on your computer by the SmartSpectra SDK. Witness reads 4 small light patches per frame and closes each frame straight away. Face landmarks become 3 numbers in memory, and the coordinates are discarded. Expressions are never requested.
- **Storage:** only the verified numbers you save are kept, with their receipts. They're encrypted on your computer with AES-256-GCM, and the OS keychain holds the key. No video, images, landmarks or expressions are ever stored. Your API key is encrypted with the OS keychain.
- **Retention:** 7, 30 or 90 days (default 30), purged automatically.
- **Deletion:** a 1.5-second hold in **Your data** deletes history, key and settings, then checks they're gone. You can also export everything as JSON and verify it on the judge site, which uploads nothing.
- **Sharing:** none by Witness. The SDK contacts Presage to check your key and count minutes; the SDK requires this.
- **SDK telemetry:** **disabled** (`enableTelemetry: false`). You can turn it on in **Your data**.
- **AI service use:** reading the SDK 3.5.0 code shows that it always registers an insight sink and has no setting to turn it off. So during a check-in the SDK *may* send pulse, breathing and HRV numbers (never video) to Presage's AI service. The consent card says this plainly. Witness shows no AI text unless you ask, and the on-demand AI summary is off by default and not shipped in this version. Measuring whether numbers are actually sent without a request is part of the egress audit, which is still pending. Until then I state what the code shows, not what I observed on the wire.
- **Misuse:** there's no video-file analysis (it can't measure someone in someone else's video), no background mode, and one face only. There's no stress, emotion or expression output. General wellness only, not medical advice.

---

*Built with the SmartSpectra Node SDK 3.5.0, Electron, React and TypeScript. General wellness information, not medical advice.*
