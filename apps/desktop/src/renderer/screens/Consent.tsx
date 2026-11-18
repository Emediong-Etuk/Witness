import { useEffect, useRef } from 'react';
import { t } from '../strings';

export function Consent(p: {
  replay: boolean;
  compact: boolean;
  retentionDays: number;
  onCompact: (v: boolean) => void;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const startRef = useRef<HTMLButtonElement>(null);
  useEffect(() => startRef.current?.focus(), []);
  const bullets = [t('consent.video'), t('consent.presage'), t('consent.insights'), t('consent.saved', { days: p.retentionDays }), t('consent.stop'), t('consent.wellness')];
  return (
    <section className="mx-auto flex h-full max-w-2xl flex-col justify-center px-6" aria-labelledby="consent-title" data-testid="consent">
      <div className="rounded-2xl border border-hairline bg-raised p-8">
        {p.replay ? <p className="mb-4 inline-block rounded-full border border-replay px-3 py-1 text-xs text-replay">{t('consent.replayNote')}</p> : null}
        <h1 id="consent-title" className="font-display text-3xl leading-tight">{p.compact ? t('consent.summary') : t('consent.title')}</h1>
        {!p.compact ? (
          <ul className="mt-6 grid gap-3 text-[15px]">
            {bullets.map((b) => (
              <li key={b} className="flex gap-3">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <button ref={startRef} data-testid="consent-start" onClick={p.onAccept} className="rounded-full bg-ink px-6 py-3 font-medium text-bg">
            {p.replay ? t('consent.startReplay') : t('consent.start')}
          </button>
          <button onClick={p.onDecline} className="rounded-full border border-hairline px-6 py-3">{t('consent.notNow')}</button>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={p.compact} onChange={(e) => p.onCompact(e.target.checked)} />
            {t('consent.compact')}
          </label>
        </div>
      </div>
    </section>
  );
}
