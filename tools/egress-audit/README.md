# tools/egress-audit (dev-only)

Measures what leaves the computer, so `docs/EGRESS.md` is a measurement rather than a claim.

```bash
npm run egress:matrix                                   # prints the 5 probe runs (≈ 15 credit-minutes) + the app run
npm run egress -- run --label <l> [--proxy] -- <cmd…>   # audit a command's whole process tree
npm run egress -- attach --pid <pid> --label <l>        # audit a running process (e.g. the Electron main process)
npm run egress:report                                   # bench/out/egress/*.json → docs/EGRESS.md
```

The method and its limits are written up in `docs/EGRESS.md` §2.
