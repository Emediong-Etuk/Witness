import { useEffect, useState } from 'react';
import type { Metric } from '@witness/gate';
import { METRIC_LABEL, METRIC_UNIT_LABEL } from '@witness/session';
import type { Checkin } from '../../shared/ipc-schema';
import { bridge } from '../bridge';
import { t } from '../strings';
import { Sheet } from './Sheet';

export function HistorySheet({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Checkin[] | null>(null);
  const [ghost, setGhost] = useState(false);
  const [quarantined, setQuarantined] = useState<string | null>(null);
  useEffect(() => {
    void bridge.store.list().then((r) => {
      setItems([...r.items].reverse());
      setQuarantined(r.quarantined);
    });
  }, []);
  return (
    <Sheet title={t('history.title')} onClose={onClose} testId="history">
      {quarantined ? <p role="alert" className="mb-4 text-sm text-warming">A damaged history file was set aside and could not be read.</p> : null}
      {!items ? null : items.length === 0 ? (
        <p className="text-muted">{t('history.empty')}</p>
      ) : (
        <>
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={ghost} onChange={(e) => setGhost(e.target.checked)} data-testid="ghost-toggle" />
            {t('history.ghost')}
          </label>
          {(['pulse', 'breathing', 'hrv'] as Metric[]).map((m) => (
            <TrendChart key={m} metric={m} items={[...items].reverse()} ghost={ghost} />
          ))}
          <ol className="mt-6 grid gap-2">
            {items.map((c) => (
              <li key={c.id} className="rounded-lg border border-hairline p-3 text-sm">
                <div className="flex gap-2 text-muted">
                  <time dateTime={c.startedAt}>{new Date(c.startedAt).toLocaleString()}</time>
                  <span>· {c.mode}</span>
                  {c.sourceKind === 'replay' ? <span className="text-replay">· {t('badge.replay')}</span> : null}
                </div>
                <div className="mt-1 flex gap-4 font-mono tabular">
                  {c.results.map((r) => (
                    <span key={r.metric}>
                      {METRIC_LABEL[r.metric]} {r.value.toFixed(r.metric === 'pulse' ? 0 : 1)} <span className="text-muted">{r.unit}</span>
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </Sheet>
  );
}

/** Verified values per check-in (filled), with SDK-stable-but-withheld readings as hollow coral "ghosts". */
function TrendChart({ metric, items, ghost }: { metric: Metric; items: Checkin[]; ghost: boolean }) {
  const pts = items.map((c, i) => ({ i, v: c.results.find((r) => r.metric === metric)?.value ?? null, g: c.withheldStable.filter((w) => w.metric === metric).map((w) => w.value) }));
  const all = pts.flatMap((p) => [...(p.v !== null ? [p.v] : []), ...(ghost ? p.g : [])]);
  if (!all.length) return null;
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const W = 460, H = 90, n = Math.max(1, items.length - 1);
  const x = (i: number) => 12 + (i / n) * (W - 24);
  const y = (v: number) => H - 12 - ((v - lo) / span) * (H - 24);
  const line = pts.filter((p) => p.v !== null).map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v!)}`).join(' ');
  return (
    <figure className="mb-4">
      <figcaption className="mb-1 text-xs text-muted">
        {METRIC_LABEL[metric]} · {METRIC_UNIT_LABEL[metric]}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${METRIC_LABEL[metric]} trend across ${items.length} check-ins`}>
        <path d={line} fill="none" stroke="var(--verified)" strokeWidth={1.5} />
        {pts.map((p) => (p.v !== null ? <circle key={`v${p.i}`} cx={x(p.i)} cy={y(p.v)} r={3} fill="var(--verified)" /> : null))}
        {ghost ? pts.flatMap((p) => p.g.map((g, k) => <circle key={`g${p.i}-${k}`} data-testid="ghost-dot" cx={x(p.i) + ((k % 5) - 2) * 2} cy={y(g)} r={2.5} fill="none" stroke="var(--withheld)" opacity={0.7} />)) : null}
      </svg>
    </figure>
  );
}
