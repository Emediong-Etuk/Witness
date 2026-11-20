import { CopyBlock } from '../components/CopyBlock';
import { TestingNote } from '../components/TestingNote';
import { Reveal, SectionHead } from '../components/Reveal';
import { Link } from '../lib/router';
import { SITE } from '../site.config';

export function Run() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Run it in 5 minutes" title="Four ways in, from zero setup to reproducing the bench." />
      <Reveal className="mb-8"><TestingNote compact /></Reveal>
      <div className="grid gap-6 md:grid-cols-2" data-tour="run-paths">
        <Reveal className="card card-hover p-6">
          <p className="font-mono text-xs text-verified">A · no setup · 1 min</p>
          <h3 className="mt-1 text-xl font-medium">This site</h3>
          <p className="mt-2 text-sm text-muted">Watch the videos, play a replay, then run the verifier in your browser, at witness-nine.vercel.app.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/" hash="videos" className="btn py-1.5 text-sm">Videos</Link>
            <Link to="/replay" className="btn py-1.5 text-sm">Replay Lab</Link>
            <Link to="/verify" className="btn py-1.5 text-sm">Verify</Link>
            {SITE.devPostUrl ? <a href={SITE.devPostUrl} className="btn py-1.5 text-sm">DEV post</a> : null}
          </div>
        </Reveal>
        <Reveal delay={0.05} className="card card-hover p-6">
          <p className="font-mono text-xs text-verified">B · the app · 5 min</p>
          <h3 className="mt-1 text-xl font-medium">{SITE.releasesUrl ? 'Download for your computer' : 'Installers: not published yet'}</h3>
          {SITE.releasesUrl ? (
            <>
              <p className="mt-2 text-sm text-muted">Windows x64, macOS (Apple Silicon) or Linux x64. Install it, paste a free SmartSpectra key, and press <b>Check in</b>. You need a camera that gives 25 fps or more; the app checks this for free before the SDK starts. Intel Macs aren't supported by the SDK.</p>
              <a href={SITE.releasesUrl} className="btn btn-primary mt-4 py-1.5 text-sm" data-testid="download">Download (with SHA-256 sums)</a>
              <p className="mt-3 text-xs text-muted">Builds are unsigned. Windows: SmartScreen → More info → Run anyway. macOS: on first launch, System Settings → Privacy &amp; Security → Open Anyway. Linux: chmod +x the AppImage. Free key: physiology.presagetech.com/auth/register</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-muted" data-testid="no-installers">Use option C to run the app from source; it takes a few minutes with Node 24. Free key: physiology.presagetech.com/auth/register</p>
          )}
        </Reveal>
        <Reveal delay={0.1} className="card p-6">
          <p className="font-mono text-xs text-verified">C · from source</p>
          <h3 className="mb-3 mt-1 text-xl font-medium">Node 24, any supported OS</h3>
          <CopyBlock code={'git clone https://github.com/Emediong-Etuk/Witness\ncd Witness && npm ci\ncp .env.example .env   # paste your own key\nnpm run dev -w @witness/desktop'} />
          <p className="mt-3 text-xs text-muted">Needs a camera that gives 25 fps or more (SmartSpectra's floor). The app checks this before the SDK starts, for free. Windows: copy instead of cp, and run it from a normal terminal.</p>
        </Reveal>
        <Reveal delay={0.15} className="card p-6">
          <p className="font-mono text-xs text-verified">D · reproduce</p>
          <h3 className="mb-3 mt-1 text-xl font-medium">Check our numbers, then re-record one clip</h3>
          <CopyBlock code={'npm run verify                       # no key, no credits\nnpm run bench:record -- --clip B1 --yes   # your key; costs about the clip length in credit-minutes'} />
          <p className="mt-3 text-xs text-muted">The SDK doesn't sign its output, so reproduction is the check: anyone with a free key can re-run a published clip and compare.</p>
        </Reveal>
      </div>
    </div>
  );
}
