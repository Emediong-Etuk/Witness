import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Metric } from '@witness/gate';
import { SessionController, type CheckinRecord } from '@witness/session';
import type { Scenario } from '@witness/sdk-adapter';
import type { Checkin, Settings } from '../shared/ipc-schema';
import { bridge, hasSdk, type AppInfo, type KeyStatus } from './bridge';
import { chime } from './sound';
import { createSource, prepareSource, type CheckedCamera, type SourceChoice } from './sources';
import { t } from './strings';
import { Home } from './screens/Home';
import { KeySetup } from './screens/KeySetup';
import { Consent } from './screens/Consent';
import { CameraCheck } from './screens/CameraCheck';
import { Measure } from './screens/Measure';
import { HistorySheet } from './screens/History';
import { DataSheet } from './screens/DataSheet';

type Sheet = 'history' | 'data' | null;

/** Test/demo hook: `?speed=8` speeds up replays (never affects camera sessions). */
const replaySpeed = Number(new URLSearchParams(location.search).get('speed') ?? '1') || 1;

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [choice, setChoice] = useState<SourceChoice>(hasSdk ? { kind: 'camera' } : { kind: 'replay', scenario: 'clean' });
  const [keySetup, setKeySetup] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [record, setRecord] = useState<CheckinRecord | null>(null);
  const [saved, setSaved] = useState<'no' | 'yes' | 'failed'>('no');
  const [camCheck, setCamCheck] = useState(false);
  const checked = useRef<CheckedCamera | null>(null);
  const refs = useRef({ choice, settings, info });
  refs.current = { choice, settings, info };

  useEffect(() => {
    void bridge.settings.get().then(setSettings);
    void bridge.key.status().then(setKeyStatus);
    void bridge.app.info().then(setInfo);
  }, []);

  useEffect(() => {
    const th = settings?.theme ?? 'system';
    if (th === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = th;
  }, [settings?.theme]);

  const controller = useMemo(
    () =>
      new SessionController({
        createSource: (mode) => {
          const { choice: c, settings: s, info: i } = refs.current;
          // The checked stream belongs to exactly one session.
          const camera = c.kind === 'camera' ? checked.current : null;
          checked.current = null;
          const src = createSource(c, mode, { sdkVersion: i?.sdkVersion ?? 'unknown', telemetry: s?.telemetry ?? false, speed: replaySpeed, camera });
          src.onStream((st) => setStream(st));
          return src;
        },
        onComplete: (rec) => {
          setRecord(rec);
          setStream(null);
          const s = refs.current.settings;
          if (s?.saveByDefault !== false && rec.results.length > 0) {
            bridge.store.save(rec as Checkin).then(() => setSaved('yes'), () => setSaved('failed'));
          }
        },
      }),
    [],
  );
  useEffect(() => () => controller.destroy(), [controller]);

  const view = useSyncExternalStore(
    useCallback((cb) => controller.subscribe(cb), [controller]),
    () => controller.snapshot,
  );

  // Chime once per newly verified metric.
  const verifiedSeen = useRef(new Set<Metric>());
  useEffect(() => {
    if (view.phase === 'consent') verifiedSeen.current.clear();
    for (const m of view.requested) {
      if (view.metrics[m].shown && !verifiedSeen.current.has(m)) {
        verifiedSeen.current.add(m);
        if (settings?.sounds) chime();
      }
    }
  }, [view, settings?.sounds]);

  // Minimize / hide / tab hidden: stop within a second.
  useEffect(() => {
    const off = bridge.onHidden(() => controller.hide());
    const vis = () => {
      if (document.visibilityState === 'hidden') controller.hide();
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('beforeunload', () => controller.destroy());
    return () => {
      off();
      document.removeEventListener('visibilitychange', vis);
    };
  }, [controller]);

  const mode = settings?.mode ?? 'quick';
  const startCheckIn = useCallback(() => {
    if (choice.kind === 'camera' && !keyStatus?.hasKey) {
      setKeySetup(true);
      return;
    }
    setRecord(null);
    setSaved('no');
    controller.checkIn(mode);
  }, [choice, keyStatus, controller, mode]);

  const accept = useCallback(async () => {
    try {
      await prepareSource(refs.current.choice);
    } catch (e) {
      console.error(e);
    }
    await controller.accept();
  }, [controller]);

  // Consent given: camera sessions get the free camera check first; replays start at once.
  const onConsent = useCallback(() => {
    if (refs.current.choice.kind === 'camera') setCamCheck(true);
    else void accept();
  }, [accept]);
  const onCameraReady = useCallback((stream: MediaStream, healthy: boolean) => {
    checked.current = { stream, healthy };
    setCamCheck(false);
    void accept();
  }, [accept]);
  const cancelCameraCheck = useCallback(() => {
    setCamCheck(false);
    controller.decline();
  }, [controller]);

  // Keyboard: Space start/stop, Esc stop, H history, D data.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      const p = controller.phase;
      if (e.key === 'Escape') {
        if (sheet) setSheet(null);
        else if (p === 'measuring' || p === 'paused' || p === 'acquiring') controller.stop();
        else if (p === 'consent') {
          if (camCheck) cancelCameraCheck();
          else controller.decline();
        }
        return;
      }
      if (e.key === ' ' && !(el && el.tagName === 'BUTTON')) {
        e.preventDefault();
        if (p === 'idle' || p === 'complete') startCheckIn();
        else if (p === 'consent' && !camCheck) onConsent();
        else if (p === 'measuring' || p === 'paused' || p === 'acquiring') controller.stop();
        return;
      }
      if (e.key === 'h' || e.key === 'H') setSheet((s) => (s === 'history' ? null : 'history'));
      if (e.key === 'd' || e.key === 'D') setSheet((s) => (s === 'data' ? null : 'data'));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [controller, sheet, startCheckIn, onConsent, camCheck, cancelCameraCheck]);

  const updateSettings = async (p: Partial<Settings>) => setSettings(await bridge.settings.set(p));

  if (!settings) return <div className="h-full" aria-busy="true" />;

  let body;
  if (keySetup) {
    body = (
      <KeySetup
        onSaved={async () => {
          setKeyStatus(await bridge.key.status());
          setKeySetup(false);
          controller.checkIn(mode);
        }}
        onCancel={() => setKeySetup(false)}
      />
    );
  } else if (view.phase === 'idle') {
    body = (
      <Home
        mode={mode}
        onMode={(m) => void updateSettings({ mode: m })}
        choice={choice}
        onChoice={setChoice}
        sdkAvailable={hasSdk}
        onCheckIn={startCheckIn}
      />
    );
  } else if (view.phase === 'consent' && camCheck) {
    body = <CameraCheck onReady={onCameraReady} onCancel={cancelCameraCheck} />;
  } else if (view.phase === 'consent') {
    body = (
      <Consent
        replay={choice.kind === 'replay'}
        compact={settings.consentCompact}
        retentionDays={settings.retentionDays}
        onCompact={(v) => void updateSettings({ consentCompact: v })}
        onAccept={onConsent}
        onDecline={() => controller.decline()}
      />
    );
  } else {
    body = (
      <Measure
        view={view}
        stream={stream}
        record={record}
        saved={saved}
        onStop={() => controller.stop()}
        onAgain={startCheckIn}
        onDone={() => controller.dismiss()}
        onHistory={() => setSheet('history')}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-4 border-b border-hairline px-6 py-3">
        <span className="font-display text-2xl tracking-tight">{t('app.name')}</span>
        <span className="hidden text-sm text-muted md:inline">{t('app.tagline')}</span>
        <nav className="ml-auto flex gap-1" aria-label="Main">
          <button className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink" onClick={() => setSheet('history')} aria-keyshortcuts="H">
            {t('history.title')}
          </button>
          <button className="rounded-md px-3 py-1.5 text-sm text-muted hover:text-ink" onClick={() => setSheet('data')} aria-keyshortcuts="D">
            {t('data.title')}
          </button>
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{body}</main>
      {sheet === 'history' ? <HistorySheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'data' ? (
        <DataSheet
          settings={settings}
          info={info}
          keyStatus={keyStatus}
          onSettings={(p) => void updateSettings(p)}
          onDeleted={async () => {
            setSettings(await bridge.settings.get());
            setKeyStatus(await bridge.key.status());
          }}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </div>
  );
}

export type { Scenario };
