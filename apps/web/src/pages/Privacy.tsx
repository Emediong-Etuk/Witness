import { Reveal, SectionHead } from '../components/Reveal';
import { consent, egress } from '../lib/data';

const measuredRuns = Object.keys(egress.runs).length;

const ROWS: { data: string; leaves: 'No' | 'Yes' | 'Only if you ask' | 'Pending'; who: string; how: string }[] = [
  { data: 'Camera video and frames', leaves: 'No', who: 'Processed on this computer by SmartSpectra. Witness never writes frames to disk.', how: 'SDK docs, our code (frames are closed straight after reading 4 small regions), egress audit' },
  { data: 'Face landmarks, blinking, talking', leaves: 'No', who: 'Turned into a few quality numbers in memory, then discarded. The schemas reject coordinates.', how: 'code + strict schemas + tests' },
  { data: 'API key and usage metering', leaves: 'Yes', who: 'Presage, to check the key and count minutes (the SDK requires it).', how: 'SDK docs; egress audit' },
  { data: 'SDK telemetry (session summaries, readiness reports)', leaves: 'No', who: 'Off by default: enableTelemetry: false.', how: 'config; egress audit (telemetry on/off runs)' },
  { data: 'Pulse/HRV/breathing numbers to Presage’s AI gateway (auto-insights)', leaves: 'Pending', who: 'The SDK always registers an insight sink and has no off switch (from reading its code). Whether numbers are sent without a request is being measured.', how: 'static analysis done; probe + egress runs pending' },
  { data: 'On-demand AI summary', leaves: 'Only if you ask', who: 'Off by default. Not shipped yet.', how: 'UI flow' },
  { data: 'Saved check-ins', leaves: 'No', who: 'Encrypted on this computer (AES-256-GCM, key held by the OS keychain), auto-deleted after 7/30/90 days.', how: 'store tests' },
];

const tone = { No: 'text-verified', Yes: 'text-warming', 'Only if you ask': 'text-replay', Pending: 'text-withheld' } as const;

export function Privacy() {
  const bullets = ['consent.video', 'consent.presage', 'consent.insights', 'consent.stop', 'consent.wellness'].map((k) => consent[k]!);
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Consent & data" title="What leaves the computer, and how we know.">
        One source of truth, shared with the app's consent card. Anything we haven't measured yet says <span className="text-withheld">pending</span>.
      </SectionHead>
      <Reveal>
        <div className="card overflow-x-auto" data-tour="privacy-table">
          <table className="w-full text-sm">
            <thead className="text-left text-muted"><tr><th className="p-4">Data</th><th className="p-4">Leaves?</th><th className="p-4">To whom / why</th><th className="p-4">How we know</th></tr></thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.data} className="border-t border-hairline align-top">
                  <td className="p-4 font-medium">{r.data}</td>
                  <td className={`p-4 font-mono ${tone[r.leaves]}`}>{r.leaves}</td>
                  <td className="p-4 text-muted">{r.who}</td>
                  <td className="p-4 text-muted">{r.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-hairline p-4 text-xs text-muted">Egress audit runs published: {measuredRuns}. Method and raw tables: docs/EGRESS.md in the repository.</p>
        </div>
      </Reveal>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        <Reveal className="card p-6">
          <p className="mb-2 font-mono text-xs text-muted">The app’s consent card, word for word</p>
          <h3 className="font-display text-2xl leading-snug">{consent['consent.title']}</h3>
          <ul className="mt-4 grid gap-2 text-sm">
            {bullets.map((b) => <li key={b} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />{b}</li>)}
          </ul>
          <p className="mt-4 text-sm"><span className="btn btn-primary pointer-events-none py-1.5 text-sm">{consent['consent.start']}</span> <span className="ml-2 text-muted">The camera stays off until this click, every session.</span></p>
        </Reveal>
        <Reveal delay={0.06} className="card p-6">
          <h3 className="mb-3 text-xl font-medium">Built not to be misused</h3>
          <ul className="grid gap-2 text-sm text-muted">
            <li><b className="text-ink">No video-file analysis</b> in the shipped app, so it can't be used to measure people in someone else's video.</li>
            <li><b className="text-ink">No background mode:</b> minimizing or hiding the window stops the camera.</li>
            <li><b className="text-ink">One face only:</b> a second face pauses the session.</li>
            <li><b className="text-ink">No expressions, no "stress score":</b> only pulse, breathing and HRV, worded neutrally.</li>
            <li><b className="text-ink">Delete everything</b> with a 1.5-s hold; retention 7/30/90 days, purged on launch.</li>
          </ul>
        </Reveal>
        <Reveal className="card p-6 lg:col-span-2">
          <h3 className="mb-3 text-xl font-medium">Honest limitations</h3>
          <ul className="grid gap-2 text-sm text-muted md:grid-cols-2">
            <li>Small corpus, mostly one subject and one camera; accuracy varies with skin tone and lighting.</li>
            <li>Ground truth is a fingertip oximeter read off a video: coarse.</li>
            <li>Thresholds are calibrated on that data and can't catch every failure (makeup, occlusion, unusual light).</li>
            <li>The SDK doesn't sign its output; reproduction with your own key is the check.</li>
            <li>Recorded clips are compressed, so bench runs differ from live use.</li>
            <li>General wellness only, not medical advice.</li>
          </ul>
        </Reveal>
      </div>
    </div>
  );
}
