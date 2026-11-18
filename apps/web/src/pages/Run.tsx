import { CopyBlock } from '../components/CopyBlock';
import { Reveal, SectionHead } from '../components/Reveal';
import { Link } from '../lib/router';
import { SITE } from '../site.config';

export function Run() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Run it in 5 minutes" title="Four ways in, from zero setup to reproducing the bench." />
      <div className="grid gap-6 md:grid-cols-2" data-tour="run-paths">
        <Reveal className="card card-hover p-6">
          <p className="font-mono text-xs text-verified">A · no setup · 1 min</p>
          <h3 className="mt-1 text-xl font-medium">This site</h3>
          <p className="mt-2 text-sm text-muted">Watch the videos, play a replay, then run the verifier in your browser.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/" hash="videos" className="btn py-1.5 text-sm">Videos</Link>
            <Link to="/replay" className="btn py-1.5 text-sm">Replay Lab</Link>
            <Link to="/verify" className="btn py-1.5 text-sm">Verify</Link>
          </div>
        </Reveal>
        <Reveal delay={0.05} className="card card-hover p-6">
          <p className="font-mono text-xs text-verified">B · the app · 5 min</p>
          <h3 className="mt-1 text-xl font-medium">Download for your computer</h3>
          <p className="mt-2 text-sm text-muted">macOS (Apple Silicon), Windows x64 or Linux x64. Open it, paste a free SmartSpectra key, and press <b>Check in</b>. Intel Macs aren't supported by the SDK.</p>
          <a href={SITE.releasesUrl} className="btn btn-primary mt-4 py-1.5 text-sm">Releases and SHA-256 sums</a>
          <p className="mt-3 text-xs text-muted">Builds are unsigned. macOS: right-click the app → Open. Windows: SmartScreen → More info → Run anyway. Free key: physiology.presagetech.com/auth/register</p>
        </Reveal>
        <Reveal delay={0.1} className="card p-6">
          <p className="font-mono text-xs text-verified">C · from source</p>
          <h3 className="mb-3 mt-1 text-xl font-medium">Node 24, any supported OS</h3>
          <CopyBlock code={'git clone https://github.com/Emediong-Etuk/Witness\ncd Witness && npm ci\ncp .env.example .env   # paste your own key\nnpm run dev -w @witness/desktop'} />
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
