import { motion } from 'motion/react';
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { CONTAMINATES } from '@witness/bench-core';
import type { Metric } from '@witness/gate';

const DUR = 75;
const LEN = 3;
const WIN: Record<Metric, number> = { pulse: 12, breathing: 30, hrv: 60 };
const KINDS = [
  { id: 'talking', label: 'You speak' },
  { id: 'chewing', label: 'You chew gum' },
  { id: 'flicker', label: 'The lamp flickers' },
  { id: 'motion', label: 'You turn your head' },
] as const;
const COLOR: Record<Metric, string> = { pulse: 'var(--verified)', breathing: 'var(--warming)', hrv: 'var(--replay)' };
const NAME: Record<Metric, string> = { pulse: 'Pulse', breathing: 'Breathing', hrv: 'HRV' };

/**
 * Window arithmetic, not measurement: one reading per second per metric, each
 * summarising the last 12/30/60 s. Drag the disturbance and count how many
 * readings it sits inside, using the same CONTAMINATES map the bench uses.
 */
export function WindowExplainer() {
  const [at, setAt] = useState(20);
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('talking');
  const [hover, setHover] = useState<{ m: Metric; t: number } | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const affects = CONTAMINATES[kind];
  const fromT = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.round(Math.min(DUR - LEN, Math.max(0, ((clientX - r.left) / r.width) * DUR - LEN / 2)));
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setAt(fromT(e.clientX));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.buttons) setAt(fromT(e.clientX));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setAt((a) => Math.max(0, a - 1));
    if (e.key === 'ArrowRight') setAt((a) => Math.min(DUR - LEN, a + 1));
  };
  const pct = (s: number) => `${(s / DUR) * 100}%`;
  return (
    <div className="card p-5 md:p-7" data-tour="explainer">
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button key={k.id} onClick={() => setKind(k.id)} aria-pressed={kind === k.id} className={`chip transition ${kind === k.id ? 'border-ink text-ink' : 'text-muted hover:text-ink'}`}>
            {k.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted">Drag the block, or focus it and use ← →</span>
      </div>
      <div className="relative select-none" ref={track} onPointerDown={onDown} onPointerMove={onMove}>
        <div className="flex justify-between font-mono text-[10px] text-muted">
          {[0, 15, 30, 45, 60, 75].map((s) => <span key={s}>{s}s</span>)}
        </div>
        <div className="relative mt-1 h-9 rounded-lg border border-hairline bg-raised-2">
          <motion.div
            role="slider"
            tabIndex={0}
            aria-label={`Disturbance: ${KINDS.find((k) => k.id === kind)!.label}`}
            aria-valuemin={0}
            aria-valuemax={DUR - LEN}
            aria-valuenow={at}
            aria-valuetext={`${at} to ${at + LEN} seconds`}
            onKeyDown={onKey}
            className="absolute inset-y-1 cursor-grab rounded-md bg-withheld/80 shadow-[0_0_24px_-4px_var(--withheld)] active:cursor-grabbing"
            animate={{ left: pct(at), width: pct(LEN) }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        </div>
        {(['pulse', 'breathing', 'hrv'] as Metric[]).map((m) => {
          const samples = Array.from({ length: DUR - WIN[m] + 1 }, (_, i) => WIN[m] + i);
          const bad = (t: number) => affects.includes(m) && at < t && at + LEN > t - WIN[m];
          const n = samples.filter(bad).length;
          return (
            <div key={m} className="mt-4">
              <div className="mb-1 flex items-baseline justify-between text-xs">
                <span><span style={{ color: COLOR[m] }}>●</span> {NAME[m]} · {WIN[m]}-s window</span>
                <span className="font-mono tabular" aria-live="polite">
                  {affects.includes(m) ? <><span className="text-withheld">{n}</span> of {samples.length} readings include it</> : <span className="text-muted">not affected by this condition</span>}
                </span>
              </div>
              <div className="relative h-5">
                {hover?.m === m ? (
                  <div className="absolute inset-y-0 rounded" style={{ left: pct(hover.t - WIN[m]), width: pct(WIN[m]), background: `color-mix(in oklab, ${COLOR[m]} 18%, transparent)` }} />
                ) : null}
                {samples.map((t) => (
                  <motion.span
                    key={t}
                    onPointerEnter={() => setHover({ m, t })}
                    onPointerLeave={() => setHover(null)}
                    className="absolute top-1/2 h-2.5 w-[3px] -translate-y-1/2 rounded-full"
                    style={{ left: pct(t) }}
                    animate={{ backgroundColor: bad(t) ? 'var(--withheld)' : COLOR[m], scaleY: bad(t) ? 1.6 : 1, opacity: bad(t) ? 1 : 0.55 }}
                    transition={{ duration: 0.2 }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-sm text-muted">
        A {LEN}-second disturbance doesn't spoil one number, it spoils every reading whose window contains it. Hover a tick to see its window. The SDK has warning codes for motion, but not for talking, chewing or flickering light.
      </p>
    </div>
  );
}
