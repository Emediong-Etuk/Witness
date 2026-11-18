# tools/bench (dev-only, never packaged)

```bash
npm run bench:estimate -- --clip B1,T1        # duration → credit-minutes, no SDK
npm run bench:record -- --clip B1 --yes        # SPENDS CREDITS: real SDK via useCustomInput + sendFrame
npm run bench:replay [-- --write]               # offline: gate over every trace; --write stores corpus/receipts/<id>.jsonl
npm run bench:calibrate [-- --write]            # calibration split only → gate.v1.json (then commit + tag m4-thresholds-frozen)
npm run bench:report                            # held-out split; refuses unless thresholds are frozen; fills doc numbers
npm run bench:docs                              # refill embedded numbers from results.json (or TBD placeholders)
npm run verify                                  # recompute everything (no key, no credits)
```

**Order of operations:**
1. `record` the clips;
2. `replay --write` stores the receipts;
3. `calibrate --write` on the calibration split;
4. commit, then `git tag m4-thresholds-frozen`;
5. `report` on the held-out split;
6. commit, then `git tag m5-heldout`;
7. `verify`.

Receipts are always computed from the **published, decoded** trace, whose floats are canonicalised to 6 decimals, never from in-memory lines.

- **`record`** only accepts clips listed in `corpus/manifest.json`, whose schema requires a consent attestation. It feeds frames at or below real time with the clip's own timestamps. It computes ROI luminance with the same `roiLayout`/`luma` the live worker uses, and writes `corpus/traces/<id>.jsonl` with a hash chain. The header records:
  - frames sent and dropped;
  - whether SDK timestamps came back equal to the ones we passed (`tsPassthrough`);
  - wall time;
  - the credit readings you pass with `--credits-before/--credits-after`.
- **`calibrate`**:
  - Method, fixed in code before any data: `p99 × 1.5` of clean baseline readings, with a live-motion floor at `p1` and caps/floors as listed in `METHOD`.
  - It writes `bench/out/calibration.json`, including FAR/FRR curves.
  - With `--write` it updates the gate config. Keys without enough clean readings stay uncalibrated, and the file says so.
- **`report`**:
  - Applies the fixed definitions in `report.ts` (`DEFINITIONS`) and writes `bench/out/results.json` + `tables.md`.
  - Confidence intervals are clip-level cluster bootstraps with a fixed seed.
  - `--unfrozen` writes a labelled dry run to `bench/out/unfrozen/` instead.
