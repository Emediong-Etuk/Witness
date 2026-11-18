# Corpus

Real clips that Greg records of himself with the dev-only lab recorder, plus the SDK traces recorded from them.

- `manifest.json`: one entry per clip, validated by `ManifestSchema` (`packages/schema`). **Consent is part of the schema.** A clip without `consent.attested: true` can't be listed, and the bench only ever feeds clips that are listed.
- `clips/`: video files (gitignored). Published as GitHub Release assets only if `consent.publishVideo` is true.
- `traces/<id>.jsonl`: hash-chained SDK traces. These are small and committed. They contain no frames, images, landmark coordinates or expressions.

## Recording clips

```bash
npm run lab        # http://127.0.0.1:5199/ (localhost only)
```

The lab recorder (`tools/lab-recorder`, dev-only, never packaged) works like this:
- **Clips:** it lists the plan below and records one clip at a time.
- **Consent:** you tick a consent box per clip, plus a second-person box for X1. The server refuses uploads without it, and refuses clip IDs outside the plan.
- **Recording:**
  - shows the scripted cues with countdowns, the reading text for T clips and a breathing circle for R clips;
  - records at 25 Mbps (WebM) and tries to lock exposure and white balance;
  - writes `corpus/clips/<id>.webm`.
- **Afterwards:** you enter the oximeter readings ("seconds bpm" pairs read off the phone video), a skin-type self-report, the lighting and the publish choice. It writes the manifest entry with the clip's SHA-256.
- **Labels** are the cue times widened by ±1 s for reaction time (`REACTION_PAD_S`). That's conservative: more readings count as contaminated.
- **Flicker page:** `/flicker`, or download `/flicker-standalone.html` and open it on a phone. It has a photosensitivity gate, a 3 Hz cap and smooth sine brightness.

## Clip plan (BUILD_PROMPT §13.2)

The minimum viable set is marked ★. Each condition gets at least one clip in each split.

| ID | `condition` | Labelled `intervals` | Split |
| --- | --- | --- | --- |
| B1★ B2★ B3 B4 | baseline | none | B1, B3 calibration · B2, B4 held-out |
| T1★ T2 T3 | talking | talking 25–45 s | T1 cal · T2, T3 held-out |
| G1★ G2 G3 | chewing | chewing 20–45 s | G1 cal · G2, G3 held-out |
| M1★ M2 M3 | motion | motion 20–30 s, 45–55 s | M1 cal · M2, M3 held-out |
| F1★ F2 | flicker (`flickerHz: 1.2`) | flicker 20–60 s | F1 cal · F2 held-out |
| F3 | flicker (`flickerHz: 0.25`) | flicker 20–60 s | held-out |
| F4★ | tv_light (`wholeClip`) | | held-out |
| F5 | generator_light (`wholeClip`) | | held-out |
| P1★ P2 | photo (`wholeClip`) | | P1 cal · P2 held-out |
| X1 | second_person | second_person 30–40 s | held-out |
| R1★ R2 R3 | paced_breathing (`pacedBreathingBrpm` 6/10/15) | | R1 cal · R2, R3 held-out |
| E1 | exercise | | held-out |
| L1 | low_light | | held-out |
| D1 | dark_clothing (`wholeClip`) | | held-out |

`CONTAMINATES` in `tools/bench/src/manifest.ts` defines which metrics each condition is documented to invalidate. That is the report's definition of "contaminated", and it is fixed before the held-out run.

## Example entry

```json
{
  "id": "T1", "title": "Read aloud 25–45 s", "condition": "talking", "split": "calibration", "file": "T1.mp4",
  "intervals": [{ "condition": "talking", "fromS": 25, "toS": 45 }], "wholeClip": false,
  "groundTruth": { "device": "fingertip pulse oximeter (filmed by phone)", "pulse": [{ "tS": 5, "bpm": 71 }, { "tS": 15, "bpm": 72 }] },
  "consent": { "attested": true, "subject": "S1", "at": "2026-11-19T18:00:00.000Z", "publishVideo": false },
  "subject": { "fitzpatrick": 5 }, "camera": "built-in 720p", "lighting": "evening, LED desk lamp", "resolution": "1280x720",
  "sha256": { "clip": null, "trace": null }
}
```

`bench:record` fills in `sha256.clip` and `sha256.trace`.
