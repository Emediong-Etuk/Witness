import { useRef, useState } from 'react';
import { GATE_V1, configHash } from '@witness/gate';
import type { Settings } from '../../shared/ipc-schema';
import { bridge, type AppInfo, type KeyStatus } from '../bridge';
import { t } from '../strings';
import { Sheet } from './Sheet';

export function DataSheet(p: {
  settings: Settings;
  info: AppInfo | null;
  keyStatus: KeyStatus | null;
  onSettings: (patch: Partial<Settings>) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [deleted, setDeleted] = useState(false);
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startHold = () => {
    setHolding(true);
    timer.current = setTimeout(async () => {
      setHolding(false);
      const ok = await bridge.store.deleteAll();
      setDeleted(ok);
      p.onDeleted();
    }, 1500);
  };
  const endHold = () => {
    setHolding(false);
    if (timer.current) clearTimeout(timer.current);
  };
  const exportAll = async () => {
    const json = await bridge.store.exportAll();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `witness-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const Toggle = ({ k, label, hint }: { k: 'saveByDefault' | 'telemetry' | 'sounds' | 'spokenCoaching'; label: string; hint?: string }) => (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" checked={p.settings[k]} onChange={(e) => p.onSettings({ [k]: e.target.checked })} data-testid={`toggle-${k}`} />
      <span>
        <span className="block text-sm">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
    </label>
  );
  return (
    <Sheet title={t('data.title')} onClose={p.onClose} testId="data">
      <p className="text-sm text-muted">{t('data.where')}</p>
      <div className="mt-6 grid gap-1 border-t border-hairline pt-4">
        <label className="flex items-center gap-3 py-2 text-sm">
          {t('data.retention')}
          <select
            value={p.settings.retentionDays}
            onChange={(e) => p.onSettings({ retentionDays: Number(e.target.value) as 7 | 30 | 90 })}
            className="rounded-md border border-hairline bg-raised-2 px-2 py-1"
          >
            {[7, 30, 90].map((n) => (
              <option key={n} value={n}>{t('data.days', { n })}</option>
            ))}
          </select>
        </label>
        <Toggle k="saveByDefault" label="Save verified check-ins automatically" />
        <Toggle k="telemetry" label={t('data.telemetry')} hint={t('data.telemetryHint')} />
        <Toggle k="sounds" label="Chime when a reading is verified" />
        <label className="flex items-center gap-3 py-2 text-sm">
          Theme
          <select value={p.settings.theme} onChange={(e) => p.onSettings({ theme: e.target.value as Settings['theme'] })} className="rounded-md border border-hairline bg-raised-2 px-2 py-1">
            <option value="system">System</option>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
      </div>
      <div className="mt-6 flex flex-wrap gap-3 border-t border-hairline pt-6">
        <button onClick={() => void exportAll()} className="rounded-full border border-hairline px-4 py-2 text-sm">{t('data.export')}</button>
        <button
          data-testid="delete-all"
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && startHold()}
          onKeyUp={endHold}
          className="relative overflow-hidden rounded-full border border-withheld px-4 py-2 text-sm text-withheld"
        >
          <span
            aria-hidden="true"
            className="absolute inset-y-0 left-0 bg-withheld/25"
            style={{ width: holding ? '100%' : '0%', transition: holding ? 'width 1.5s linear' : 'width 150ms' }}
          />
          <span className="relative">{t('data.delete')}</span>
        </button>
      </div>
      {deleted ? <p role="status" className="mt-3 text-sm text-verified" data-testid="deleted">{t('data.deleted')}</p> : null}
      <section className="mt-8 border-t border-hairline pt-4 font-mono text-xs text-muted" aria-label={t('data.about')}>
        <h3 className="mb-2 font-sans text-sm text-ink">{t('data.about')}</h3>
        <p>Witness {p.info?.appVersion}</p>
        <p data-testid="sdk-version">SmartSpectra SDK {p.info?.sdkVersion}</p>
        <p>{p.info?.platform} {p.info?.electron ? `· Electron ${p.info.electron}` : ''}</p>
        <p>Gate v{GATE_V1.version} · {GATE_V1.calibration.status} · {configHash(GATE_V1).slice(0, 19)}…</p>
        <p>Key: {p.keyStatus?.hasKey ? (p.keyStatus.encrypted ? 'stored, encrypted' : p.keyStatus.fromEnv ? 'from environment (dev)' : 'this session only') : 'none'}</p>
      </section>
    </Sheet>
  );
}
