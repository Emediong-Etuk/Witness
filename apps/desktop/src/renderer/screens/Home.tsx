import { SCENARIOS, type Scenario } from '@witness/sdk-adapter';
import type { SourceChoice } from '../sources';
import { t } from '../strings';

export function Home(p: {
  mode: 'quick' | 'full';
  onMode: (m: 'quick' | 'full') => void;
  choice: SourceChoice;
  onChoice: (c: SourceChoice) => void;
  sdkAvailable: boolean;
  onCheckIn: () => void;
}) {
  const replay = p.choice.kind === 'replay';
  return (
    <section className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-8 px-6 py-12 text-center" aria-labelledby="home-title">
      <div>
        <h1 id="home-title" className="font-display text-6xl leading-none tracking-tight">{t('home.promise')}</h1>
        <p className="mt-4 text-muted">{t('app.tagline')}</p>
      </div>

      <div role="radiogroup" aria-label="Check-in length" className="grid w-full grid-cols-2 gap-2 rounded-xl border border-hairline bg-raised p-1">
        {(['quick', 'full'] as const).map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={p.mode === m}
            onClick={() => p.onMode(m)}
            className={`rounded-lg px-4 py-3 text-left transition-colors duration-150 ${p.mode === m ? 'bg-raised-2 text-ink' : 'text-muted hover:text-ink'}`}
          >
            <span className="block text-sm font-medium">{t(m === 'quick' ? 'home.quick' : 'home.full')}</span>
            <span className="block text-xs text-muted">{t(m === 'quick' ? 'home.quickHint' : 'home.fullHint')}</span>
          </button>
        ))}
      </div>

      <button
        data-testid="check-in"
        onClick={p.onCheckIn}
        aria-keyshortcuts="Space"
        className="w-full rounded-full bg-ink px-8 py-4 text-lg font-medium text-bg transition-transform duration-150 hover:scale-[1.01] active:scale-[0.99]"
      >
        {t('home.checkIn')}
        {replay ? <span className="ml-2 text-sm font-normal opacity-80">· {t("badge.replay")}</span> : null}
      </button>

      <details className="w-full text-left text-sm" open={!p.sdkAvailable || replay}>
        <summary className="cursor-pointer text-muted hover:text-ink">{t('home.replay')}</summary>
        <div className="mt-3 rounded-xl border border-hairline bg-raised p-3">
          {!p.sdkAvailable ? <p className="mb-2 text-xs text-muted">{t('home.noSdk')}</p> : null}
          <p className="mb-3 text-xs text-muted">{t('home.replayHint')}</p>
          <div role="radiogroup" aria-label="Replay scenario" className="grid gap-1">
            {p.sdkAvailable ? (
              <label className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised-2">
                <input type="radio" name="src" checked={!replay} onChange={() => p.onChoice({ kind: 'camera' })} />
                <span>Camera (real SmartSpectra)</span>
              </label>
            ) : null}
            {(Object.keys(SCENARIOS) as Scenario[]).map((s) => (
              <label key={s} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-raised-2">
                <input
                  type="radio"
                  name="src"
                  data-testid={`scenario-${s}`}
                  checked={p.choice.kind === 'replay' && p.choice.scenario === s}
                  onChange={() => p.onChoice({ kind: 'replay', scenario: s })}
                />
                <span className="font-mono text-xs text-replay">{s}</span>
                <span className="text-muted">{SCENARIOS[s]}</span>
              </label>
            ))}
          </div>
        </div>
      </details>
      <p className="text-xs text-muted">{t('disclaimer')}</p>
    </section>
  );
}
