# Deploying the judge site (Vercel)

The site is static (`apps/web`). `vercel.json` at the repo root holds the whole configuration:
- **Install:** a workspace-scoped `npm ci`, about 6 s. It skips the SDK's native binaries.
- **Build:** `npm run build:site`.
- **Output:** `apps/web/dist`.
- **Routing:** SPA rewrites.
- **Security headers:**
  - CSP with no third-party scripts, fonts or connections; frames only from `youtube-nocookie.com`;
  - `frame-ancestors 'none'`;
  - HSTS, `nosniff`, `no-referrer`;
  - a Permissions-Policy that denies camera, microphone and geolocation;
  - immutable caching for `/assets`.

## One-time setup (Greg)

1. Go to vercel.com → **Add New… → Project → Import** `Emediong-Etuk/Witness`.
2. Leave **Root Directory** as the repository root. Framework preset is "Other": `vercel.json` already sets install, build and output.
3. Node.js version: **24.x** (Project → Settings → General). npm ≥ 11 is required, and Node 24 ships it.
4. Click **Deploy**. Every push to the production branch redeploys, because the site is rebuilt from `corpus/`, `bench/out/` and `docs/` at build time. New traces and results appear on their own.

## After publishing the videos

Put the YouTube IDs in `apps/web/src/site.config.ts` (`videos.pitch.youtubeId`, `videos.walkthrough.youtubeId`) and push. The video cards load nothing from YouTube until the viewer presses play.

## Check locally first

```bash
npm run build:site
npm run preview -w @witness/web      # http://localhost:4174
npx playwright test --project=site   # 13 tests incl. tour, verifier, CSP, axe, mobile
```
