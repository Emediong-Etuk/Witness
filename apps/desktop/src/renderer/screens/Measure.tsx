import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Metric } from '@witness/gate';
import { ERROR_COPY, METRIC_LABEL, METRIC_UNIT_LABEL, RULE_CHIP, RULE_COPY, type CheckinRecord, type MetricView, type SessionView } from '@witness/session';
import { ReceiptCard, Rings, Sparkline, Waveform } from '@witness/ui';
import { t } from '../strings';

const STATUS: Record<MetricView['status'], { word: string; icon: string; cls: string }> = {
  idle: { word: t('result.warming'), icon: '○', cls: 'text-muted' },
  filling: { word: t('result.warming'), icon: '◔', cls: 'text-warming' },
  verified: { word: t('result.verified'), icon: '✓', cls: 'text-verified' },
  withheld: { word: t('result.withheld'), icon: '✕', cls: 'text-withheld' },
  out_of_range: { word: t('result.outOfRange'), icon: '–', cls: 'text-muted' },
};

export function Measure(p: {
  view: SessionView;
  stream: MediaStream | null;
  record: CheckinRecord | null;
  saved: 'no' | 'yes' | 'failed';
  onStop: () => void;
  onAgain: () => void;
  onDone: () => void;
  onHistory: () => void;
}) {
  const v = p.view;
  const live = v.phase === 'measuring' || v.phase === 'paused' || v.phase === 'acquiring';
  const [receiptFor, setReceiptFor] = useState<Metric | null>(null);
  const bpm = v.metrics.pulse.shown?.value ?? null;
  const replay = v.source?.kind === 'replay';
  const tuning = v.coaching?.code === 10;

  return (
    <div className="grid h-full min-h-0 grid-cols-[1fr_380px]">
      <section className="flex min-h-0 flex-col gap-4 p-6" aria-label="Measurement">
        <div className="flex items-center gap-3">
          {live ? (
            <span role="status" data-testid="measuring-banner" className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${v.paused ? 'bg-withheld/15 text-withheld' : 'bg-verified/12 text-verified'}`}>
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${v.paused ? 'bg-withheld' : 'bg-verified'}`} />
              {v.paused ? t('measure.paused') : t('measure.banner')}
            </span>
          ) : (
            <span className="text-sm text-muted">{t('complete.title')}</span>
          )}
          {replay ? (
            <span data-testid="replay-badge" className="rounded-full border border-replay px-3 py-1 text-xs text-replay">
              {t('badge.replay')} · {v.source?.label.replace('Replay · ', '')}
            </span>
          ) : null}
          <span className="ml-auto font-mono text-sm text-muted tabular">
            {fmtClock(v.elapsedS)} / {fmtClock(v.capS)}
          </span>
          {live ? (
            <button data-testid="stop" onClick={p.onStop} aria-keyshortcuts="Space Escape" className="rounded-full border border-hairline px-4 py-1.5 text-sm hover:border-ink">
              {t('measure.stop')}
            </button>
          ) : null}
        </div>

        <div className="relative mx-auto aspect-square w-full max-w-[min(100%,calc(100vh-280px))] min-w-[320px]">
          <Preview stream={p.stream} replay={replay} />
          <LightPatches spark={v.light.spark} flagged={v.requested.some((m) => v.metrics[m].reasons[0] === 'R9_STEADY_LIGHT' && v.metrics[m].status === 'withheld')} />
          <Sizer>{(size) => <Rings metrics={v.metrics} show={v.requested} size={size} bpm={bpm} />}</Sizer>
          {v.paused ? (
            <div role="alert" className="absolute inset-0 flex items-center justify-center rounded-full bg-bg/70 p-16 text-center text-lg text-withheld">
              {RULE_COPY.R5_ONE_CONTINUOUS_FACE}
            </div>
          ) : null}
        </div>

        <div aria-live="polite" className="mx-auto min-h-[44px] max-w-2xl text-center" data-testid="coaching">
          <AnimatePresence mode="wait">
            {live ? (
              <motion.p
                key={v.coaching?.text ?? 'idle'}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className={`inline-block rounded-full border px-4 py-2 text-sm ${v.coaching?.from === 'witness' ? 'border-withheld/50 text-ink' : 'border-hairline text-ink'}`}
              >
                {v.coaching?.text ?? (tuning || v.elapsedS < 3 ? t('measure.tuning') : t('measure.filling'))}
              </motion.p>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="mb-1 text-xs text-muted">Pulse signal (SDK arterial trace)</p>
            <Waveform values={v.waveforms.pulse} label="Live pulse waveform" />
          </div>
          {v.mode === 'full' ? (
            <div>
              <p className="mb-1 text-xs text-muted">Breathing signal (SDK chest trace)</p>
              <Waveform values={v.waveforms.chest} color="var(--replay)" label="Live breathing waveform" />
            </div>
          ) : null}
        </div>
      </section>

      <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-hairline bg-raised/40 p-5" aria-label="Results">
        {v.requested.map((m) => (
          <MetricCard key={m} m={v.metrics[m]} nowS={v.elapsedS} onReceipt={() => setReceiptFor(m)} live={live} />
        ))}
        {v.phase === 'complete' ? <CompletePanel record={p.record} saved={p.saved} onAgain={p.onAgain} onDone={p.onDone} onHistory={p.onHistory} /> : null}
        {v.phase === 'error' && v.error ? <ErrorPanel error={v.error} onAgain={p.onAgain} onDone={p.onDone} /> : null}
        <p className="mt-auto pt-4 text-xs leading-relaxed text-muted">{t('disclaimer')}</p>
        <p className="font-mono text-[11px] text-muted">
          {v.receiptCount} receipts · chain {v.chainHead ? v.chainHead.slice(7, 11) + '…' + v.chainHead.slice(-4) : '–'} · SDK {v.source?.sdkVersion ?? '–'}
        </p>
      </aside>

      {receiptFor && v.metrics[receiptFor].shown ? (
        <div role="dialog" aria-modal="true" aria-label="Evidence receipt" className="fixed inset-0 z-20 flex items-center justify-center bg-bg/70 p-6" onClick={() => setReceiptFor(null)}>
          <div className="w-[460px] max-w-full" onClick={(e) => e.stopPropagation()}>
            <ReceiptCard receipt={v.metrics[receiptFor].shown!.receipt} startedAt={p.record?.startedAt} />
            <button autoFocus onClick={() => setReceiptFor(null)} className="mt-3 w-full rounded-full border border-hairline py-2 text-sm">Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ m, nowS, onReceipt, live }: { m: MetricView; nowS: number; onReceipt: () => void; live: boolean }) {
  const st = m.shown && m.status !== 'verified' ? STATUS.verified : STATUS[m.status];
  const agoS = m.shown ? Math.max(0, nowS - m.shown.verifiedAtUs / 1e6) : 0;
  const stale = m.shown && m.status !== 'verified';
  const checks = m.latest?.checks ?? [];
  const decimals = m.metric === 'pulse' ? 0 : 1;
  return (
    <article data-testid={`metric-${m.metric}`} data-status={m.status} className="rounded-xl border border-hairline bg-raised p-4" aria-label={METRIC_LABEL[m.metric]}>
      <header className="flex items-baseline gap-2">
        <h2 className="text-sm font-medium">{METRIC_LABEL[m.metric]}</h2>
        <span className="text-xs text-muted">{m.windowS}-s window</span>
        <span className={`ml-auto inline-flex items-center gap-1 text-xs font-medium ${st.cls}`} data-testid={`badge-${m.metric}`}>
          <span aria-hidden="true">{st.icon}</span>
          {m.shown ? t('result.verified') : st.word}
        </span>
      </header>
      <div className="mt-2 flex items-end gap-2" style={{ opacity: stale && agoS > 30 ? 0.55 : 1, transition: 'opacity 250ms' }}>
        {m.shown ? (
          <>
            <span data-testid={`value-${m.metric}`} className="font-display text-6xl leading-none tabular">{m.shown.value.toFixed(decimals)}</span>
            <span className="pb-1 text-sm text-muted">{METRIC_UNIT_LABEL[m.metric]}</span>
          </>
        ) : (
          <span className="font-display text-5xl leading-none text-muted" aria-label="No verified value yet">—</span>
        )}
        {m.shown ? (
          <button onClick={onReceipt} className="ml-auto rounded-full border border-hairline px-3 py-1 text-xs hover:border-ink" data-testid={`receipt-${m.metric}`}>
            {t('result.receipt')}
          </button>
        ) : null}
      </div>
      {stale ? <p className="mt-1 text-xs text-muted">{t('result.ago', { s: Math.round(agoS) })}</p> : null}
      {live && m.status === 'withheld' && m.reasons[0] ? (
        <p className="mt-2 text-xs text-withheld" data-testid={`reason-${m.metric}`}>
          {RULE_COPY[m.reasons[0]]} <span className="font-mono text-muted tabular">{t('result.in', { s: Math.ceil(m.countdownS) })}</span>
        </p>
      ) : null}
      {live && (m.status === 'filling' || m.status === 'idle') ? (
        <p className="mt-2 font-mono text-xs text-muted tabular">{t('result.in', { s: Math.ceil(m.countdownS) })}</p>
      ) : null}
      {m.status === 'out_of_range' ? <p className="mt-2 text-xs text-muted">{RULE_COPY.R3_RANGE}</p> : null}
      {checks.length ? (
        <ul className="mt-3 flex flex-wrap gap-1" aria-label="Evidence checks">
          {checks.filter((c) => c.id !== 'R1_WARMUP').map((c, i) => (
            <motion.li
              key={c.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: m.status === 'verified' ? i * 0.04 : 0, duration: 0.15 }}
              className={`rounded-full border px-2 py-0.5 text-[11px] ${c.pass ? 'border-verified/40 text-verified' : 'border-withheld/50 text-withheld'}`}
            >
              <span aria-hidden="true">{c.pass ? '✓ ' : '✕ '}</span>
              {RULE_CHIP[c.id]}
              <span className="sr-only">{c.pass ? ' passed' : ' failed'}</span>
            </motion.li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

function CompletePanel({ record, saved, onAgain, onDone, onHistory }: { record: CheckinRecord | null; saved: 'no' | 'yes' | 'failed'; onAgain: () => void; onDone: () => void; onHistory: () => void }) {
  const none = record && record.results.length === 0;
  return (
    <div className="rounded-xl border border-hairline bg-raised p-4" data-testid="complete">
      {none ? <p className="text-sm text-muted">{t('complete.nothing')}</p> : null}
      {saved === 'yes' ? (
        <p className="text-sm text-verified">
          ✓ {t('complete.saved')} · <button className="underline" onClick={onHistory}>{t('history.title')}</button>
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {record ? `Check-in finished. ${record.results.map((r) => `${r.metric} ${r.value.toFixed(r.metric === 'pulse' ? 0 : 1)} ${r.unit}, verified`).join('. ')}` : ''}
      </p>
      <div className="mt-3 flex gap-2">
        <button data-testid="again" onClick={onAgain} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg">{t('complete.again')}</button>
        <button onClick={onDone} className="rounded-full border border-hairline px-4 py-2 text-sm">{t('complete.home')}</button>
      </div>
    </div>
  );
}

function ErrorPanel({ error, onAgain, onDone }: { error: { code: number; message: string; retryable: boolean }; onAgain: () => void; onDone: () => void }) {
  const copy = ERROR_COPY[error.code];
  return (
    <div role="alert" className="rounded-xl border border-withheld/60 bg-raised p-4" data-testid="error">
      <p className="text-sm">{copy?.text ?? 'Something stopped the check-in.'}</p>
      <div className="mt-3 flex gap-2">
        <button onClick={onAgain} className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg">{copy?.action === 'Start fresh' ? 'Start fresh' : 'Retry'}</button>
        <button onClick={onDone} className="rounded-full border border-hairline px-4 py-2 text-sm">{t('complete.home')}</button>
      </div>
    </div>
  );
}

function Preview({ stream, replay }: { stream: MediaStream | null; replay: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="absolute inset-[8%] overflow-hidden rounded-full bg-raised">
      {stream ? (
        <video ref={ref} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" aria-label="Your camera preview (mirrored)" />
      ) : (
        <svg viewBox="0 0 200 200" className="h-full w-full" role="img" aria-label={replay ? 'Replay: no camera in use' : 'Camera starting'}>
          <defs>
            <radialGradient id="g" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="var(--raised-2)" />
              <stop offset="100%" stopColor="var(--raised)" />
            </radialGradient>
          </defs>
          <rect width="200" height="200" fill="url(#g)" />
          <ellipse cx="100" cy="88" rx="34" ry="44" fill="none" stroke="var(--hairline)" strokeWidth="1.5" />
          <path d="M40 200 C 48 150, 152 150, 160 200" fill="none" stroke="var(--hairline)" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

function LightPatches({ spark, flagged }: { spark: [number[], number[]]; flagged: boolean }) {
  return (
    <>
      {[0, 1].map((i) => (
        <div
          key={i}
          className={`absolute top-0 ${i === 0 ? 'left-0' : 'right-0'} flex flex-col items-center gap-1 rounded-md border bg-bg/60 p-2 ${flagged ? 'border-withheld text-withheld' : 'border-hairline text-muted'}`}
          style={flagged ? { animation: 'witness-verified-pulse 0.83s ease-out infinite' } : undefined}
          aria-hidden={i === 1}
        >
          <span className="text-[10px] uppercase tracking-wide">{t('measure.light')}</span>
          <Sparkline values={spark[i]!} stroke={flagged ? 'var(--withheld)' : 'var(--muted)'} label={i === 0 ? (flagged ? 'Background light is flickering' : 'Background light level') : undefined} />
        </div>
      ))}
    </>
  );
}

function Sizer({ children }: { children: (size: number) => React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize(Math.min(e.contentRect.width, e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0">
      {children(size)}
    </div>
  );
}

function fmtClock(s: number): string {
  const x = Math.max(0, Math.floor(s));
  return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`;
}
