# Threat model

What Witness protects, from whom, how, and what is left over. Controls point at the code that implements them. Anything not built or not tested yet is marked **pending**.

## 1. What we protect

| Asset | Why it matters |
| --- | --- |
| **The camera** | Video of a person's face is the most sensitive thing the app touches. |
| **Readings and their trustworthiness** | Witness's whole claim is that a shown number had a clean window. A forged or replayed "verified" value would break it. |
| **Saved history** | Health-adjacent data about one person, kept over time. |
| **The SmartSpectra API key** | It costs the owner credit-minutes, and it identifies their Presage account. |
| **Published evidence** (traces, receipts, results, numbers in the docs) | Judges and readers must be able to trust that the numbers weren't tuned after the fact. |

## 2. Who we defend against

1. **Untrusted content in the app's window:** a compromised dependency in the renderer bundle, or injected markup.
2. **Someone with the user's files but not their OS login:** a copied home folder, a backup, a stolen disk.
3. **Someone who edits evidence:** changes a trace, a receipt, a threshold or a number in the README after the fact.
4. **A misuser of the app:** measuring someone who didn't agree, in the background or from a video.
5. **The SDK and its network traffic.** Not an attacker, but a closed-source component whose network behaviour we can't fully switch off (see section 5).

Out of scope: malware running as the user with full access, a compromised OS, and Presage's servers.

## 3. Controls

### The window (attacker 1)

| Control | Where |
| --- | --- |
| `contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`, no webview tag, DevTools off when packaged | `apps/desktop/src/main/index.ts` `createWindow` |
| UI served from a privileged `app://witness` scheme. It reads files only from the bundle's renderer folder (path traversal refused) with a fixed MIME allowlist, and sends a strict CSP plus `nosniff` | `index.ts` `registerAppProtocol`, `security.ts` `CSP` |
| CSP: `script-src 'self'`, `style-src 'self'` (relaxed only for the dev server), `connect-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'` | `security.ts`, `config/vite-dev-csp.ts` (serve only) |
| Every network request from the app's pages other than `app://`, `blob:` and `data:` is cancelled | `security.ts` `onBeforeRequest` |
| Navigation, redirects, new windows and webviews are denied. External links open only by allowlisted id, never as raw URLs from the renderer. | `security.ts` `lockDownContents`, `EXTERNAL` |
| Permissions: only `media`, only video (no microphone), only from our own origin. Device permissions are denied. | `security.ts` `installPermissionHandlers` |
| IPC: every channel checks the sender's origin, a 2 MB size limit and a zod schema. There is no generic "invoke anything" bridge. The API key is handed out only while a consented session is starting, with the window visible, at most once every 3 s. | `ipc.ts`, `shared/ipc-schema.ts` |
| Preload exposes one frozen `window.witness` API plus the SDK's bridge | `preload/index.ts` |

### Files at rest (attacker 2)

| Control | Where |
| --- | --- |
| API key encrypted with the OS keychain (`safeStorage`, async API), or kept in memory only if the OS has no keychain. Plain text is used only if the user explicitly opts in. | `keystore.ts` |
| History encrypted with AES-256-GCM using a random data key, which the OS keychain wraps. A tampered file fails authentication and is quarantined, not loaded. | `datastore.ts`, `apps/desktop/test/main-stores.test.ts` |
| Only verified values, receipts and derived check values are saved. No frames, images, landmarks or expressions. The schemas reject coordinates. | `packages/schema`, `CheckinSchema` |
| Retention purge (7/30/90 days) at launch and hourly; hold-to-delete removes everything and checks it's gone | `index.ts`, `ipc.ts` |

### Evidence (attacker 3)

| Control | Where |
| --- | --- |
| Each receipt hashes its canonical JSON, the hash of its inputs, the gate config's hash and the previous receipt's hash. The chain breaks if any receipt is changed, dropped or reordered. | `packages/gate` (`canonical.ts`, `evaluate.ts`) |
| Each trace line carries a running chain hash, and the manifest pins each trace's SHA-256 | `packages/bench-core`, `ManifestSchema` |
| `npm run verify` re-runs the gate on every published trace and must reproduce every receipt byte for byte, plus the results file and every number embedded in the docs. The same code runs in the judge site's Verify page, which includes a tamper playground. | `packages/verify`, `tools/verify`, `apps/web` |
| Thresholds are frozen with a git tag (`m4-thresholds-frozen`) before the held-out run (`m5-heldout`). Verify fails if the config changed after the freeze or the tags are out of order. | `tools/verify` (`git.freeze`) |
| Synthetic traces can never enter the corpus: the verifier requires `corpus:<id>` sources | `packages/verify` |
| Numbers in the README and docs are generated between markers, and verify fails on any hand edit | `bench-core/markers.ts` |

**Limit:** the SDK doesn't sign its output. Someone who controls the recording machine could feed invented SDK events into a trace before it's hashed. The defence is reproduction: anyone with a free key can re-record a published clip and compare.

### Misuse (attacker 4)

- Consent card before every session. The camera stays off until the button is pressed.
- A free camera check runs before the SDK starts, so a session that can't work doesn't spend credits.
- No video-file input in the app. Minimizing, hiding or closing the window stops the camera.
- A second face withholds the readings and pauses the session (rule R5).
- No expression, emotion or "stress" output.

### The SDK (5)

- Telemetry is off by default (`enableTelemetry: false`). The user can turn it on in **Your data**.
- **Closing safely:** if the window is torn down while the SDK is running, its native runtime aborts the process. So the window's close is deferred until the renderer has stopped the session (`index.ts`, close handler).
- **Native library path:** packaged builds load it only from the app bundle, via `SMARTSPECTRA_CAPI_PATH`, set unconditionally at startup.
- **Test switches:** the fake-camera switches exist only in unpackaged builds started with `WITNESS_E2E=1`.

## 4. Residual risks

| Risk | Status |
| --- | --- |
| The SDK may send vitals numbers to Presage's AI gateway on its own. Reading its code shows no setting to disable this. | Disclosed on the consent card. Egress audit **pending**. |
| The SDK's native library makes its own connections (key check, metering, model downloads), and the app's request filter doesn't cover them | Disclosed in `docs/CONSENT_AND_DATA.md`. Egress audit **pending**. |
| Without an OS keychain, the key and history are kept in memory only, so they're lost on exit | By design; the UI says so |
| Builds are not code-signed. Electron Fuses and the packaging hardening aren't applied, because installers aren't published. | **Pending.** Run from source. |
| A user who chooses "Start anyway" on a slow camera may spend minutes on a session the SDK stops | The user is warned on the button |
| Supply chain: npm dependencies | `npm ci` from a lockfile; only listed packages may run install scripts (`allowScripts`); `npm audit --omit=dev --audit-level=high` in CI |

## 5. Verifying these claims

- `npm test`: unit and property tests (gate monotonicity, order independence, store encryption, IPC schemas, camera check).
- `npx playwright test`: UI tests, including "camera never requested before consent", the tour, and accessibility.
- `npm run verify`: recomputes all published evidence.
- `docs/EGRESS.md`: the egress audit method and its results once runs exist.
