import { DEFINITIONS, renderValue } from '@witness/bench-core';
import { Reveal, SectionHead } from '../components/Reveal';
import { gateConfig, recordedCount, results, stage } from '../lib/data';
import { Link } from '../lib/router';

const PROTOCOL = [
  ['Record', 'Greg records consented clips with the lab recorder: scripted cues, oximeter ground truth, one consent per clip.'],
  ['Trace', 'Each clip goes through the real SmartSpectra SDK with its own timestamps, giving a hash-chained trace.'],
  ['Calibrate', 'Thresholds come from the calibration split only: p99 × 1.5 of clean readings, with the method fixed in code first.'],
  ['Freeze', 'The gate config is committed and tagged m4-thresholds-frozen before any held-out clip is scored.'],
  ['Held-out', 'The frozen gate is scored on clips it never saw, using definitions fixed before the run.'],
  ['Verify', 'npm run verify (and this site) recompute every number from the published traces.'],
] as const;

const f = (v: unknown, fmt: string) => renderValue(v, fmt) ?? 'n/a';

export function Results() {
  const idx = { 'no-clips': 0, recording: 1, calibrated: 3, results: 5 }[stage];
  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Results" title={results ? 'Held-out results.' : 'Held-out results land here.'}>
        {results ? 'Computed by npm run bench:report on the held-out split with frozen thresholds, and recomputed by the verifier.' : 'No held-out run has happened yet, so this page shows the protocol and where it stands. No number appears here until the frozen-threshold run produces it.'}
      </SectionHead>

      <Reveal>
        <ol className="card grid overflow-hidden sm:grid-cols-2 lg:grid-cols-6" data-tour="results-status" aria-label="Protocol">
          {PROTOCOL.map(([h, b], i) => (
            <li key={h} className={`border-hairline p-4 lg:border-l first:lg:border-l-0 ${i === idx ? 'bg-raised-2' : ''}`}>
              <p className={`mb-1 font-mono text-xs ${i < idx ? 'text-verified' : i === idx ? 'text-warming' : 'text-muted'}`}>{i < idx ? '✓ done' : i === idx ? '● now' : `step ${i + 1}`}</p>
              <p className="font-medium">{h}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{b}</p>
            </li>
          ))}
        </ol>
      </Reveal>
      <p className="mt-3 text-sm text-muted">Corpus traces recorded: {recordedCount} · gate calibration: {gateConfig.calibration.status}</p>

      {results ? (
        <>
          <Reveal className="mt-10">
            <div className="card overflow-x-auto p-5">
              <table className="w-full text-sm">
                <thead className="text-left text-muted"><tr><th className="py-2">Scope</th><th>Readings</th><th>SDK false-trust</th><th>Witness withheld (contaminated)</th><th>Witness FAR</th><th>Witness FRR</th></tr></thead>
                <tbody className="font-mono">
                  {([['All', results.overall], ...Object.entries(results.perMetric)] as [string, typeof results.overall][]).map(([k, s]) => (
                    <tr key={k} className="border-t border-hairline"><td className="py-2 font-sans">{k}</td><td>{s.readings}</td><td>{f(s.sdkFalseTrust, 'ci-pct')}</td><td>{f(s.witnessWithheldContaminated, 'ci-pct')}</td><td>{f(s.witnessFAR, 'ci-pct')}</td><td>{f(s.witnessFRR, 'ci-pct')}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
          <Reveal className="mt-6">
            <div className="card overflow-x-auto p-5">
              <h3 className="mb-3 font-medium">Accuracy vs ground truth</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-muted"><tr><th className="py-2">Metric</th><th>Group</th><th>MAE</th><th>Within tolerance</th><th>n (clips)</th></tr></thead>
                <tbody className="font-mono">
                  {Object.entries(results.accuracy).flatMap(([m, g]) => Object.entries(g).map(([k, v]) => (
                    <tr key={m + k} className="border-t border-hairline"><td className="py-2 font-sans">{m}</td><td className="font-sans">{k}</td><td>{f(v.mae, 'ci-num1')}</td><td>{f(v.within, 'ci-pct')}</td><td>{v.mae.n} ({v.mae.clusters})</td></tr>
                  )))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </>
      ) : (
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal className="card p-6">
            <h3 className="mb-3 font-medium">What will appear here</h3>
            <ul className="grid gap-2 text-sm text-muted">
              <li>SDK false-trust rate, and Witness false-accept / false-reject rates, overall and per metric</li>
              <li>Per-condition and per-rule attribution (which rule caught which condition)</li>
              <li>Accuracy vs a fingertip oximeter for SDK-stable and Witness-verified readings, with 95% clip-level bootstrap intervals</li>
              <li>Time to first verified value and coverage (the friction cost)</li>
              <li>The flicker test: does the SDK's pulse drift toward the lamp's rhythm?</li>
              <li>Honest negatives, including what the SDK was <i>not</i> fooled by</li>
            </ul>
          </Reveal>
          <Reveal delay={0.06} className="card p-6">
            <h3 className="mb-3 font-medium">Definitions (fixed before the run)</h3>
            <dl className="grid gap-2 text-sm">
              {Object.entries(DEFINITIONS).map(([k, v]) => (
                <div key={k}><dt className="font-mono text-xs text-verified">{k}</dt><dd className="text-muted">{v}</dd></div>
              ))}
            </dl>
          </Reveal>
        </div>
      )}
      <p className="mt-8 text-sm text-muted">Want to check the arithmetic? <Link to="/verify" className="underline hover:text-ink">Run the verifier</Link>.</p>
    </div>
  );
}
