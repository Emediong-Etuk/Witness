import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useEffect, useState } from 'react';

/**
 * ILLUSTRATION (not data): three clean-window rings filling at their real
 * relative speeds (12 s / 30 s / 60 s, time-compressed). Every few seconds a
 * "you spoke" disturbance rewinds the breathing ring, the way the app does.
 */
export function HeroRings() {
  const reduce = useReducedMotion();
  const t = useMotionValue(0);
  const [event, setEvent] = useState<string | null>(null);
  const [breathStart, setBreathStart] = useState(0);
  useEffect(() => {
    if (reduce) {
      t.set(70);
      return;
    }
    const ctl = animate(t, 70, { duration: 14, ease: 'linear', repeat: Infinity, repeatDelay: 1.2 });
    return () => ctl.stop();
  }, [reduce, t]);
  useEffect(() => {
    if (reduce) return;
    return t.on('change', (v) => {
      if (v < 1) {
        setBreathStart(0);
        setEvent(null);
      }
      if (v > 20 && v < 21 && breathStart === 0) {
        setBreathStart(21.5);
        setEvent('You spoke · breathing window restarts');
        setTimeout(() => setEvent(null), 2200);
      }
    });
  }, [t, reduce, breathStart]);
  const pulse = useTransform(t, (v) => Math.min(1, v / 12));
  const breath = useTransform(t, (v) => Math.min(1, Math.max(0, v - breathStart) / 30));
  const hrv = useTransform(t, (v) => Math.min(1, v / 60));
  const ring = (r: number, p: typeof pulse, color: string, w = 2) => (
    <g transform="rotate(-90 200 200)">
      <circle cx="200" cy="200" r={r} fill="none" stroke="var(--hairline)" strokeWidth="1" />
      <motion.circle cx="200" cy="200" r={r} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" style={{ pathLength: p }} />
    </g>
  );
  const pulseDone = useTransform(pulse, (p) => (p >= 1 ? 1 : 0));
  return (
    <figure className="relative mx-auto aspect-square w-full max-w-[460px]" aria-label="Illustration: three clean-window rings filling around a face, with the breathing ring rewinding when the person speaks">
      <svg viewBox="0 0 400 400" className="h-full w-full" role="img" aria-hidden="true">
        <defs>
          <radialGradient id="face" cx="50%" cy="42%" r="55%">
            <stop offset="0%" stopColor="var(--raised-2)" />
            <stop offset="100%" stopColor="var(--bg)" />
          </radialGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>
        <circle cx="200" cy="200" r="126" fill="url(#face)" />
        <ellipse cx="200" cy="182" rx="44" ry="58" fill="none" stroke="var(--hairline)" strokeWidth="1.5" />
        <path d="M118 318 C 132 258, 268 258, 282 318" fill="none" stroke="var(--hairline)" strokeWidth="1.5" />
        <motion.circle cx="200" cy="200" r="138" fill="none" stroke="var(--verified)" strokeWidth="10" filter="url(#glow)" style={{ opacity: pulseDone }} animate={reduce ? undefined : { scale: [1, 1.015, 1] }} transition={{ duration: 0.85, repeat: Infinity }} />
        {ring(138, pulse, 'var(--verified)', 2.5)}
        {ring(160, breath, 'var(--warming)')}
        {ring(182, hrv, 'var(--replay)')}
      </svg>
      <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
        <motion.span
          key={event ?? 'none'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: event ? 1 : 0, y: 0 }}
          className="rounded-full border border-withheld/60 bg-bg/80 px-3 py-1 text-xs text-withheld"
        >
          {event ?? '·'}
        </motion.span>
      </div>
      <figcaption className="mt-2 flex justify-center gap-4 text-[11px] text-muted">
        <span><span className="text-verified">●</span> pulse 12 s</span>
        <span><span className="text-warming">●</span> breathing 30 s</span>
        <span><span className="text-replay">●</span> HRV 60 s</span>
        <span className="italic">illustration, time-compressed</span>
      </figcaption>
    </figure>
  );
}
