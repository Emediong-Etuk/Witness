import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { decodeTrace, encodeTrace, replayTrace } from '@witness/bench-core';
import { syntheticTrace } from '@witness/sdk-adapter';
import type { VerifyReport } from '@witness/verify';
import { SectionHead } from '../components/Reveal';
import { CopyBlock } from '../components/CopyBlock';
import { egress, gateConfig, manifestText, markerDocs, receipts, recordedCount, resultsText, traces } from '../lib/data';
import { TAMPERS, type Tamper } from '../lib/demo-corpus';

type State = { status: 'idle' } | { status: 'running'; done: number; total: number; label: string } | { status: 'done'; report: VerifyReport; ms: number } | { status: 'error'; message: string };

function useVerifier() {
  const [state, setState] = useState<State>({ status: 'idle' });
  const worker = useRef<Worker | null>(null);
  useEffect(() => () => worker.current?.terminate(), []);
  const run = useCallback((msg: unknown) => {
    worker.current?.terminate();
    const w = new Worker(new URL('../lib/verify.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    setState({ status: 'running', done: 0, total: 1, label: 'starting' });
    w.onmessage = (e: MessageEvent<{ type: string; done?: number; total?: number; label?: string; report?: VerifyReport; ms?: number; message?: string }>) => {
      const d = e.data;
      if (d.type === 'progress') setState({ status: 'running', done: d.done!, total: d.total!, label: d.label! });
      if (d.type === 'done') setState({ status: 'done', report: d.report!, ms: d.ms! });
      if (d.type === 'error') setState({ status: 'error', message: d.message! });
    };
    w.postMessage(msg);
  }, []);
  return { state, run };
}

function Checks({ report, ms, highlight }: { report: VerifyReport; ms: number; highlight?: string }) {
  const [all, setAll] = useState(false);
  // Failures first; passes collapse so the check that caught the problem is the first thing you see.
  const order = { fail: 0, pass: 1, skip: 2 } as const;
  const sorted = [...report.checks].sort((a, b) => order[a.status] - order[b.status]);
  const fails = sorted.filter((c) => c.status === 'fail').length;
  const shown = all ? sorted : sorted.slice(0, Math.max(fails + 4, 6));
  return (
    <div>
      <motion.p initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`mb-4 rounded-xl border p-4 font-medium ${report.ok ? 'border-verified/50 text-verified' : 'border-withheld/60 text-withheld'}`} role="status" data-testid="verify-summary">
        {report.ok ? '✓ ' : '✗ '}
        {report.summary} <span className="font-mono text-xs text-muted">· {ms} ms in your browser</span>
      </motion.p>
      <ul className="grid gap-1.5" data-testid="verify-checks">
        {shown.map((c, i) => {
          const hot = highlight && c.status === 'fail';
          return (
            <motion.li
              key={c.id + i}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.9) }}
              className={`grid grid-cols-[1.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2 py-1.5 text-sm sm:grid-cols-[1.5rem_13rem_minmax(0,1fr)] ${hot ? 'bg-withheld/10' : ''}`}
            >
              <span className={c.status === 'pass' ? 'text-verified' : c.status === 'fail' ? 'text-withheld' : 'text-muted'} aria-label={c.status}>{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : '–'}</span>
              <span className="truncate font-mono text-xs">{c.id}</span>
              <span className={`col-start-2 min-w-0 break-all sm:col-start-auto ${c.status === 'skip' ? 'text-muted' : ''}`}>{c.detail}</span>
            </motion.li>
          );
        })}
      </ul>
      {sorted.length > shown.length || all ? (
        <button className="mt-2 text-sm text-muted underline hover:text-ink" onClick={() => setAll((a) => !a)} data-testid="verify-toggle">
          {all ? 'Show fewer' : `Show all ${sorted.length} checks`}
        </button>
      ) : null}
    </div>
  );
}

function Progress({ s }: { s: Extract<State, { status: 'running' }> }) {
  return (
    <div className="py-6" aria-live="polite">
      <div className="h-1.5 overflow-hidden rounded-full bg-hairline">
        <motion.div className="h-full bg-verified" animate={{ width: `${Math.max(6, (s.done / Math.max(1, s.total)) * 100)}%` }} />
      </div>
      <p className="mt-2 font-mono text-xs text-muted">recomputing · {s.label}</p>
    </div>
  );
}

function sampleExport(): string {
  const lines = decodeTrace(encodeTrace(syntheticTrace('clean', { mode: 'quick', durS: 20 })).text).lines;
  const v = replayTrace(lines, gateConfig).receipts.filter((r) => r.verdict === 'VERIFIED').at(-1)!;
  return JSON.stringify({ note: 'SAMPLE built from a synthetic replay, for trying the checker', checkins: [{ id: 'ses_sample', results: [{ metric: 'pulse', value: v.value, receipt: v }] }] }, null, 2);
}

export function Verify() {
  const corpus = useVerifier();
  const demo = useVerifier();
  const checkin = useVerifier();
  const [tamper, setTamper] = useState<Tamper>('doc');
  const [drag, setDrag] = useState(false);
  const runCorpus = () =>
    corpus.run({ kind: 'all', input: { gateConfig, manifestText, traces, receipts, resultsText, docs: markerDocs, egress, git: null } });
  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) checkin.run({ kind: 'checkin', text: await f.text(), cfg: gateConfig });
  };
  const expect = TAMPERS.find((t) => t.id === tamper)!.expect;

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Verify" title="Don't trust us. Recompute it.">
        The same verifier as <code>npm run verify</code>, compiled for the browser and running in a Web Worker. No key, no credits, no server. It re-runs the gate on every published trace and must reproduce every receipt, chain head, result and number in the docs.
      </SectionHead>

      <section className="card p-6" data-tour="verify-run">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1">
            <h3 className="text-xl font-medium">The published corpus</h3>
            <p className="break-words text-sm text-muted">{recordedCount} recorded traces · {Object.keys(receipts).length} receipt files · results {resultsText ? 'published' : 'not yet published'} · {Object.keys(markerDocs).length} docs scanned for embedded numbers</p>
          </div>
          <button onClick={runCorpus} className="btn btn-primary" disabled={corpus.state.status === 'running'} data-testid="verify-run">
            {corpus.state.status === 'running' ? 'Verifying…' : 'Run the verifier'}
          </button>
        </div>
        <AnimatePresence mode="wait">
          {corpus.state.status === 'running' ? <Progress key="p" s={corpus.state} /> : null}
          {corpus.state.status === 'done' ? (
            <motion.div key="d" className="mt-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Checks report={corpus.state.report} ms={corpus.state.ms} />
              {recordedCount === 0 ? <p className="mt-4 text-sm text-warming">No clips have been recorded yet, so there's nothing to recompute beyond the config and the TBD placeholders. This check gains teeth as traces are published.</p> : null}
              <p className="mt-3 text-xs text-muted">The git freeze-order check needs the repository, so it runs in the CLI only.</p>
            </motion.div>
          ) : null}
          {corpus.state.status === 'error' ? <p className="mt-4 text-withheld">{corpus.state.message}</p> : null}
        </AnimatePresence>
      </section>

      <section className="card mt-8 p-6" data-tour="verify-tamper">
        <h3 className="text-xl font-medium">Tamper playground</h3>
        <p className="mb-5 text-sm text-muted">
          Builds a small <span className="chip border-replay text-replay">demo</span> corpus from labelled synthetic traces, applies one change, and runs the same verifier. Pick a way to cheat:
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Tamper">
          {TAMPERS.map((t) => (
            <button key={t.id} role="radio" aria-checked={tamper === t.id} onClick={() => setTamper(t.id)} data-testid={`tamper-${t.id}`} className={`rounded-xl border p-3 text-left text-sm transition ${tamper === t.id ? 'border-ink bg-raised-2' : 'border-hairline text-muted hover:text-ink'}`}>
              {t.label}
              <span className="mt-1 block font-mono text-[11px] text-muted">expect: {t.expect}</span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary mt-5" onClick={() => demo.run({ kind: 'demo', cfg: gateConfig, tamper })} disabled={demo.state.status === 'running'} data-testid="tamper-run">
          {demo.state.status === 'running' ? 'Verifying…' : 'Apply and verify'}
        </button>
        <AnimatePresence mode="wait">
          {demo.state.status === 'running' ? <Progress key="p" s={demo.state} /> : null}
          {demo.state.status === 'done' ? (
            <motion.div key={`d-${demo.state.ms}`} className="mt-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <Checks report={demo.state.report} ms={demo.state.ms} highlight={expect} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      <section className="card mt-8 p-6" data-tour="verify-checkin">
        <h3 className="text-xl font-medium">Verify a check-in</h3>
        <p className="mb-4 text-sm text-muted">Drop a file from the Witness app (Your data → Export). Each saved receipt is checked: its hash, its value, and that its verdict follows from its checks under a published gate config. Nothing is uploaded.</p>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition ${drag ? 'border-verified bg-verified/5' : 'border-hairline'}`}
        >
          <span className="text-3xl" aria-hidden="true">⇣</span>
          <span>Drop an export here, or choose a file</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) checkin.run({ kind: 'checkin', text: await f.text(), cfg: gateConfig }); }} data-testid="checkin-file" />
        </label>
        <button className="mt-3 text-sm text-muted underline hover:text-ink" onClick={() => checkin.run({ kind: 'checkin', text: sampleExport(), cfg: gateConfig })} data-testid="checkin-sample">
          No export handy? Try a sample (built from a synthetic replay)
        </button>
        {checkin.state.status === 'done' ? <div className="mt-5"><Checks report={checkin.state.report} ms={checkin.state.ms} /></div> : null}
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <CopyBlock label="Or on your machine (needs Node 24):" code={'git clone https://github.com/Emediong-Etuk/Witness\ncd Witness && npm ci\nnpm run verify'} />
        <CopyBlock label="Verify an exported check-in:" code="npm run verify -- checkin witness-export.json" />
      </section>
    </div>
  );
}
