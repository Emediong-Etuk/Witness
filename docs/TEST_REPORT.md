# Test report

> Generated sections are filled by scripts. Numbers between `<!-- bench:… -->` markers come from `bench/out/results.json`, and `npm run verify` fails if any differs. Prose is limited to describing what was run.

## Summary

| Suite | Status |
| --- | --- |
| Unit + property (`npx vitest run`) | TBD (CI) |
| UI E2E on synthetic replay (`npx playwright test`) | TBD (CI) |
| Verify (`npm run verify`) | TBD (CI) |
| E2E with real SDK + fake camera | not run yet (credits) |
| Security (electronegativity, fuses, CSP/navigation, IPC fuzz) | not run yet |
| Performance | not run yet (needs a camera) |

## Held-out bench

- Held-out clips: <!-- bench:clips.length|int -->TBD (run npm run bench:report)<!-- /bench -->
- Gate config: <!-- bench:gate.configHash|text -->TBD (run npm run bench:report)<!-- /bench --> (<!-- bench:gate.calibration|text -->TBD (run npm run bench:report)<!-- /bench -->)
- Freeze commit: <!-- bench:freeze.tagCommit|text -->TBD (run npm run bench:report)<!-- /bench -->

| Measure | All metrics |
| --- | --- |
| Stable SDK readings | <!-- bench:overall.readings|int -->TBD (run npm run bench:report)<!-- /bench --> |
| SDK false-trust rate | <!-- bench:overall.sdkFalseTrust|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> |
| Witness FAR (contaminated readings verified) | <!-- bench:overall.witnessFAR|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> |
| Witness withheld, contaminated | <!-- bench:overall.witnessWithheldContaminated|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> |
| Witness FRR (clean readings withheld) | <!-- bench:overall.witnessFRR|ci-pct -->TBD (run npm run bench:report)<!-- /bench --> |
| Pulse MAE, Witness-verified (bpm) | <!-- bench:accuracy.pulse.witnessVerified.mae|ci-num1 -->TBD (run npm run bench:report)<!-- /bench --> |
| Pulse MAE, SDK-stable in contaminated windows (bpm) | <!-- bench:accuracy.pulse.sdkStableContaminated.mae|ci-num1 -->TBD (run npm run bench:report)<!-- /bench --> |
| Time to first verified pulse, median (s) | <!-- bench:friction.pulse.firstVerifiedS.median|num1 -->TBD (run npm run bench:report)<!-- /bench --> |

Full tables: `bench/out/tables.md`. Definitions: `DEFINITIONS` in `packages/bench-core/src/report.ts`, also copied into `results.json`.

## Honest negatives and limitations

TBD after the held-out run.
