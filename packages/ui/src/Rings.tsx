import { motion, useReducedMotion } from 'motion/react';
import type { Metric } from '@witness/gate';
import type { MetricView } from '@witness/session';

const COLOR: Record<MetricView['status'], string> = {
  idle: 'var(--hairline)',
  filling: 'var(--warming)',
  verified: 'var(--verified)',
  withheld: 'var(--withheld)',
  out_of_range: 'var(--muted)',
};

const RADIUS: Record<Metric, number> = { pulse: 0.36, breathing: 0.42, hrv: 0.48 };

/**
 * Three concentric clean-window rings: pulse 12 s (inner), breathing 30 s,
 * HRV 60 s (outer). Each fills clockwise; contamination rewinds it with a
 * spring and leaves a coral tick where the window broke. A verified ring
 * glows, pulsing at the verified BPM (only after verification).
 */
export function Rings({ metrics, show, size, bpm }: { metrics: Record<Metric, MetricView>; show: Metric[]; size: number; bpm: number | null }) {
  const reduce = useReducedMotion();
  const c = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: 'absolute', inset: 0, margin: 'auto', overflow: 'visible' }}>
      {show.map((m) => {
        const v = metrics[m];
        const r = RADIUS[m] * size;
        const color = COLOR[v.status];
        const verified = v.status === 'verified';
        return (
          <g key={m} transform={`rotate(-90 ${c} ${c})`}>
            <circle cx={c} cy={c} r={r} fill="none" stroke="var(--hairline)" strokeWidth={1} />
            {verified && !reduce && bpm && m === 'pulse' ? (
              <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={8} style={{ filter: 'blur(6px)', animation: `witness-verified-pulse ${60 / bpm}s ease-out infinite` }} />
            ) : null}
            <motion.circle
              key={`${m}-${v.rewinds}`}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={color}
              strokeWidth={verified ? 2.5 : 1.75}
              strokeLinecap="round"
              initial={{ pathLength: v.rewinds > 0 && v.brokeAt !== null ? v.brokeAt : 0 }}
              animate={{ pathLength: Math.max(0.0001, v.progress) }}
              transition={reduce ? { duration: 0 } : v.rewinds > 0 ? { type: 'spring', stiffness: 260, damping: 22 } : { duration: 0.2, ease: 'linear' }}
            />
            {v.brokeAt !== null && v.status === 'withheld' ? (
              <circle
                cx={c + r * Math.cos(2 * Math.PI * v.brokeAt)}
                cy={c + r * Math.sin(2 * Math.PI * v.brokeAt)}
                r={3}
                fill="var(--withheld)"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
