import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeTrace, encodeTrace, replayTrace } from '@witness/bench-core';
import { secondsUntilClean, type Metric, type Receipt } from '@witness/gate';
import { SCENARIO_LABELS, SCENARIOS, syntheticTrace, type Scenario } from '@witness/sdk-adapter';
import { METRIC_LABEL, RULE_COPY, type MetricView } from '@witness/session';
import { ReceiptCard, Rings } from '@witness/ui';
import { SectionHead } from '../components/Reveal';
import { gateConfig, manifestClips, traces } from '../lib/data';

type Source = { kind: 'synthetic'; scenario: Scenario } | { kind: 'corpus'; id: string };
const METRICS: Metric[] = ['pulse', 'breathing', 'hrv'];
const COLOR: Record<string, string> = { VERIFIED: 'var(--verified)', WITHHELD: 'var(--withheld)', WARMING_UP: 'var(--warming)', OUT_OF_RANGE: 'var(--muted)' };

function load(src: Source) {
  const text = src.kind === 'synthetic' ? encodeTrace(syntheticTrace(src.scenario, { mode: 'full' })).text : traces[src.id]!;
  const { lines } = decodeTrace(text);
  const rep = replayTrace(lines, gateConfig);
  const bands =
    src.kind === 'synthetic'
      ? SCENARIO_LABELS[src.scenario].map((b) => ({ ...b, toS: b.toS ?? rep.durationS }))
      : (manifestClips.find((c) => c.id === src.id) as unknown as { intervals?: { condition: string; fromS: number; toS: number }[] })?.intervals ?? [];
  return { rep, bands };
}

/** Ring state for each metric at time t, from the receipts emitted up to t. */
function viewAt(receipts: Receipt[], t: number): Record<Metric, MetricView> {
  const out = {} as Record<Metric, MetricView>;
  for (const m of METRICS) {
    const rs = receipts.filter((r) => r.metric === m && r.window.endUs / 1e6 <= t);
    const latest = rs.at(-1) ?? null;
    const shown = [...rs].reverse().find((r) => r.verdict === 'VERIFIED') ?? null;
    const W = gateConfig.windowsS[m];
    let progress = Math.min(1, t / W), status: MetricView['status'] = t > 0 ? 'filling' : 'idle', countdownS = Math.max(0, W - t);
    if (latest?.verdict === 'VERIFIED') [progress, status, countdownS] = [1, 'verified', 0];
    else if (latest?.verdict === 'WITHHELD') {
      countdownS = Math.min(W, secondsUntilClean(latest, t * 1e6));
      progress = (W - countdownS) / W;
      status = 'withheld';
    } else if (latest?.verdict === 'OUT_OF_RANGE') status = 'out_of_range';
    out[m] = { metric: m, windowS: W, status, progress, shown: shown ? { value: shown.value, receipt: shown, verifiedAtUs: shown.window.endUs } : null, latest, countdownS, reasons: latest?.reasons ?? [], rewinds: 0, brokeAt: null };
  }
  return out;
}

export function Replay() {
  const corpusIds = Object.keys(traces).sort();
  const [src, setSrc] = useState<Source>({ kind: 'synthetic', scenario: 'talking' });
  const { rep, bands } = useMemo(() => load(src), [src]);
  const dur = Math.ceil(rep.durationS);
  const [t, setT] = useState(dur);
  const [playing, setPlaying] = useState(false);
  const [open, setOpen] = useState<Receipt | null>(null);
  const [hover, setHover] = useState<{ r: Receipt; x: number; y: number } | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    setT(Math.ceil(rep.durationS));
    setPlaying(false);
  }, [rep]);
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number) => {
      setT((x) => {
        const n = x + ((now - last) / 1000) * 6;
        if (n >= dur) {
          setPlaying(false);
          return dur;
        }
        return n;
      });
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  const views = useMemo(() => viewAt(rep.receipts, t), [rep, t]);
  const topReason = METRICS.map((m) => views[m]).find((v) => v.status === 'withheld')?.reasons[0];
  const W = 1000, laneH = 58, top = 28, H = top + laneH * 3 + 10;
  const x = (s: number) => (s / Math.max(1, dur)) * W;

  return (
    <div className="mx-auto max-w-6xl px-5 py-14">
      <SectionHead eyebrow="Replay Lab" title="Watch the gate decide, second by second.">
        The real gate runs in your browser on a recorded trace. Hollow dots are readings the SDK marked <code>stable</code>, the ones an app trusting the SDK alone would show. Filled colour is Witness's verdict on the same reading.
      </SectionHead>

      <div className="mb-6 flex flex-wrap gap-2" data-tour="replay-picker" role="radiogroup" aria-label="Trace">
        {(Object.keys(SCENARIOS) as Scenario[]).map((s) => {
          const on = src.kind === 'synthetic' && src.scenario === s;
          return (
            <button key={s} role="radio" aria-checked={on} onClick={() => setSrc({ kind: 'synthetic', scenario: s })} data-testid={`replay-${s}`} className={`chip py-1.5 transition ${on ? 'border-replay text-ink' : 'text-muted hover:text-ink'}`} title={SCENARIOS[s]}>
              <span className="font-mono text-replay">{s}</span>
            </button>
          );
        })}
        {corpusIds.map((id) => {
          const on = src.kind === 'corpus' && src.id === id;
          return (
            <button key={id} role="radio" aria-checked={on} onClick={() => setSrc({ kind: 'corpus', id })} className={`chip py-1.5 ${on ? 'border-verified text-ink' : 'text-muted'}`}>
              <span className="font-mono text-verified">{id}</span>
            </button>
          );
        })}
      </div>
      <p className="mb-6 text-sm text-muted">
        {src.kind === 'synthetic' ? (
          <><span className="chip mr-2 border-replay text-replay">synthetic</span>{SCENARIOS[src.scenario]}. Generated by Witness to show behaviour. This is not SmartSpectra output, and no result is computed from it.{corpusIds.length === 0 ? ' Recorded corpus clips will appear here once published.' : ''}</>
        ) : (
          <><span className="chip mr-2 border-verified text-verified">corpus</span>Recorded through the SmartSpectra SDK ({rep.header.sdkVersion}).</>
        )}
      </p>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="card p-4" data-tour="replay-timeline">
          <div className="relative">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="group" aria-label="Timeline of SDK readings and Witness verdicts per metric">
              {bands.map((b, i) => (
                <g key={i}>
                  <rect x={x(b.fromS)} y={top - 6} width={Math.max(2, x(b.toS) - x(b.fromS))} height={laneH * 3 + 6} fill="var(--withheld)" opacity="0.09" />
                  <text x={x(b.fromS) + 4} y={top - 10} fontSize="11" fill="var(--withheld)" fontFamily="var(--font-mono)">{b.condition}</text>
                </g>
              ))}
              {[0, 15, 30, 45, 60, 75].filter((s) => s <= dur).map((s) => (
                <g key={s}>
                  <line x1={x(s)} x2={x(s)} y1={top} y2={H - 10} stroke="var(--hairline)" />
                  <text x={x(s) + 2} y={H} fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">{s}s</text>
                </g>
              ))}
              {METRICS.map((m, li) => {
                const y = top + li * laneH + laneH / 2;
                return (
                  <g key={m}>
                    <text x={4} y={y - 16} fontSize="11" fill="var(--muted)">{METRIC_LABEL[m]}</text>
                    <line x1={0} x2={W} y1={y} y2={y} stroke="var(--hairline)" strokeDasharray="2 4" />
                    {rep.receipts.filter((r) => r.metric === m).map((r, k) => {
                      const cx = x(r.window.endUs / 1e6);
                      if (!r.sdk.stable) return <circle key={k} cx={cx} cy={y} r={1.5} fill="var(--hairline)" />;
                      return (
                        <circle
                          key={k}
                          cx={cx}
                          cy={y}
                          r={5}
                          fill={COLOR[r.verdict]}
                          stroke="var(--ink)"
                          strokeOpacity="0.55"
                          strokeWidth="1.2"
                          className="cursor-pointer"
                          tabIndex={0}
                          role="button"
                          aria-label={`${METRIC_LABEL[m]} at ${(r.window.endUs / 1e6).toFixed(0)} s: SDK stable, Witness ${r.verdict}`}
                          onClick={() => setOpen(r)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen(r)}
                          onPointerEnter={(e) => setHover({ r, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })}
                          onPointerLeave={() => setHover(null)}
                          data-testid={`dot-${m}-${r.verdict}`}
                        />
                      );
                    })}
                  </g>
                );
              })}
              <motion.line x1={x(t)} x2={x(t)} y1={top - 8} y2={H - 10} stroke="var(--ink)" strokeWidth="1.5" initial={false} animate={{ x1: x(t), x2: x(t) }} transition={{ duration: 0 }} />
            </svg>
            <AnimatePresence>
              {hover ? (
                <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="glass pointer-events-none absolute z-10 rounded-lg border border-hairline px-3 py-2 text-xs" style={{ left: Math.min(hover.x + 12, 640), top: hover.y + 12 }}>
                  <p className="font-mono">{METRIC_LABEL[hover.r.metric]} {hover.r.value.toFixed(hover.r.metric === 'pulse' ? 0 : 1)} {hover.r.unit} · {(hover.r.window.endUs / 1e6).toFixed(0)} s</p>
                  <p style={{ color: COLOR[hover.r.verdict] }}>{hover.r.verdict}{hover.r.reasons[0] ? ` · ${RULE_COPY[hover.r.reasons[0]]}` : ''}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
            <span><span className="text-verified">●</span> verified</span>
            <span><span className="text-withheld">●</span> withheld</span>
            <span><span className="text-warming">●</span> warming up</span>
            <span>○ ring = SDK said <code>stable</code></span>
            <span>· SDK not yet stable</span>
          </div>
          <div className="mt-5 flex items-center gap-3" data-tour="replay-scrubber">
            <button onClick={() => { if (t >= dur) setT(0); setPlaying((p) => !p); }} className="btn btn-primary py-1.5 text-sm" aria-label={playing ? 'Pause' : 'Play'} data-testid="replay-play">
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <input type="range" min={0} max={dur} step={0.1} value={t} onChange={(e) => { setPlaying(false); setT(Number(e.target.value)); }} className="flex-1 accent-[var(--verified)]" aria-label="Playhead (seconds)" />
            <span className="w-16 text-right font-mono text-sm tabular">{t.toFixed(1)} s</span>
          </div>
        </div>

        <aside className="card p-5">
          <p className="mb-3 font-mono text-xs text-muted">At {t.toFixed(1)} s</p>
          <div className="relative mx-auto aspect-square w-full max-w-[240px]">
            <div className="absolute inset-[18%] rounded-full bg-raised-2" />
            <Rings metrics={views} show={METRICS} size={240} bpm={reduce ? null : views.pulse.shown?.value ?? null} />
          </div>
          <ul className="mt-4 grid gap-2 text-sm">
            {METRICS.map((m) => {
              const v = views[m];
              return (
                <li key={m} className="flex items-baseline justify-between">
                  <span className="text-muted">{METRIC_LABEL[m]}</span>
                  <span className="font-mono tabular">
                    {v.shown ? v.shown.value.toFixed(m === 'pulse' ? 0 : 1) : '—'}{' '}
                    <span className={v.status === 'verified' ? 'text-verified' : v.status === 'withheld' ? 'text-withheld' : 'text-warming'}>{v.status === 'verified' ? '✓' : v.status === 'withheld' ? '✕' : '…'}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          <AnimatePresence mode="wait">
            <motion.p key={topReason ?? 'none'} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} className="mt-4 min-h-[3rem] rounded-lg border border-hairline p-3 text-sm" aria-live="polite">
              {topReason ? RULE_COPY[topReason] : 'No condition in the current windows.'}
            </motion.p>
          </AnimatePresence>
        </aside>
      </div>

      <AnimatePresence>
        {open ? (
          <motion.div className="fixed inset-0 z-30 flex justify-end bg-bg/60" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(null)}>
            <motion.div role="dialog" aria-modal="true" aria-label="Evidence receipt" initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }} className="h-full w-[480px] max-w-full overflow-y-auto border-l border-hairline bg-raised p-6" onClick={(e) => e.stopPropagation()} data-testid="receipt-drawer">
              <div className="mb-4 flex items-center">
                <h2 className="font-display text-2xl">Receipt</h2>
                <button autoFocus onClick={() => setOpen(null)} className="ml-auto chip py-1">Close</button>
              </div>
              <ReceiptCard receipt={open} />
              {open.reasons.length ? <p className="mt-4 text-sm text-withheld">{RULE_COPY[open.reasons[0]!]}</p> : null}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
