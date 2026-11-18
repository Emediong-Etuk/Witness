# Witness: camera vitals that show their work

> Work in progress for the Presage SmartSpectra SDK Challenge (`#presagechallenge`). See `docs/BUILD_LOG.md`.

Witness shows a pulse, breathing rate or HRV value only when the **entire** analysis window behind it passed every documented condition: still, quiet, steady light, one continuous face, enough frames, SDK confident. Each shown number comes with an evidence receipt that anyone can recompute.

General wellness information, not medical advice.

## Status

- `packages/features`: pure DSP and landmark/ROI features ✅
- `packages/gate`: the Clean-Window Gate (R1–R11), receipts and hash chain ✅ (thresholds **uncalibrated**)
- `packages/schema`: zod schemas for events, receipts, session logs and the manifest ✅
- Desktop app, bench, verify CLI, judge site: not started

```bash
npm ci
npm test
npm run typecheck
```

License: MIT (Witness code). The SmartSpectra SDK is proprietary and installed from npm; it isn't redistributed here.
