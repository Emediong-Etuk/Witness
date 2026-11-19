import { useCallback, useEffect, useRef, useState } from 'react';
import { assessCamera, listCameras, openCamera, sampleCamera, saveCameraId, savedCameraId, type CameraVerdict } from '../camera-check';
import { t } from '../strings';

type State =
  | { s: 'opening' }
  | { s: 'sampling'; p: number }
  | { s: 'done'; v: CameraVerdict }
  | { s: 'error'; message: string };

/**
 * Free camera check between consent and the SDK start. The stream it opens is
 * handed to the SDK on "Start", so the camera stays on and isn't reopened.
 */
export function CameraCheck(p: { onReady: (stream: MediaStream, healthy: boolean) => void; onCancel: () => void }) {
  const [state, setState] = useState<State>({ s: 'opening' });
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [cameraId, setCameraId] = useState<string | null>(savedCameraId());
  const [stream, setStreamState] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const setStream = (st: MediaStream | null) => {
    streamRef.current = st;
    setStreamState(st);
  };
  const handedOff = useRef(false);
  const run = useRef(0);
  const video = useRef<HTMLVideoElement>(null);

  const stopStream = (st: MediaStream | null) => st?.getTracks().forEach((tr) => tr.stop());

  const check = useCallback(async (id: string | null): Promise<void> => {
    const my = ++run.current;
    setState({ s: 'opening' });
    stopStream(streamRef.current);
    setStream(null);
    let st: MediaStream;
    try {
      st = await openCamera(id);
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === 'OverconstrainedError' && id) {
        // The saved camera is gone: fall back to the default one.
        saveCameraId(null);
        setCameraId(null);
        return check(null);
      }
      if (my !== run.current) return;
      setState({ s: 'error', message: name === 'NotAllowedError' ? t('camcheck.denied') : name === 'NotReadableError' ? t('camcheck.busy') : t('camcheck.failed') });
      return;
    }
    if (my !== run.current) return stopStream(st);
    setStream(st);
    void listCameras().then(setCameras, () => undefined);
    setState({ s: 'sampling', p: 0 });
    const sample = await sampleCamera(st, 3000, (x) => my === run.current && setState({ s: 'sampling', p: x }));
    if (my !== run.current) return;
    if (!sample) {
      // No MediaStreamTrackProcessor: nothing to measure with, so don't block.
      handedOff.current = true;
      p.onReady(st, false);
      return;
    }
    const v = assessCamera(sample);
    setState({ s: 'done', v });
    if (v.ok && v.level === 'good') {
      handedOff.current = true;
      p.onReady(st, true);
    }
  }, [p]);

  useEffect(() => {
    void check(cameraId);
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop the camera if we leave without handing the stream to the SDK.
  useEffect(() => () => {
    if (!handedOff.current) stopStream(streamRef.current);
  }, []);

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);

  const pick = (id: string) => {
    setCameraId(id);
    saveCameraId(id);
    void check(id);
  };
  const start = (healthy: boolean) => {
    if (!stream) return;
    handedOff.current = true;
    p.onReady(stream, healthy);
  };

  const verdict = state.s === 'done' ? state.v : null;
  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col justify-center px-6" aria-labelledby="camcheck-title" data-testid="camera-check">
      <div className="grid gap-6 rounded-2xl border border-hairline bg-raised p-8 md:grid-cols-[14rem_1fr]">
        <div className="relative aspect-square overflow-hidden rounded-full bg-raised-2">
          {stream ? <video ref={video} autoPlay muted playsInline className="h-full w-full -scale-x-100 object-cover" aria-label={t('camcheck.preview')} /> : null}
        </div>
        <div className="min-w-0">
          <h1 id="camcheck-title" className="font-display text-3xl leading-tight">{t('camcheck.title')}</h1>
          <p className="mt-2 text-sm text-muted">{t('camcheck.body')}</p>

          <div className="mt-5" aria-live="polite" data-testid="camcheck-status">
            {state.s === 'opening' ? <p className="text-sm text-muted">{t('camcheck.opening')}</p> : null}
            {state.s === 'sampling' ? (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-hairline">
                  <div className="h-full bg-verified transition-[width]" style={{ width: `${Math.max(4, state.p * 100)}%` }} />
                </div>
                <p className="mt-2 text-sm text-muted">{t('camcheck.measuring')}</p>
              </div>
            ) : null}
            {verdict ? (
              <p className={`rounded-xl border p-3 text-sm ${verdict.ok ? (verdict.level === 'good' ? 'border-verified/50 text-verified' : 'border-warming/60') : 'border-withheld/60'}`} data-testid={`camcheck-${verdict.level}`}>
                {verdict.reason}
              </p>
            ) : null}
            {state.s === 'error' ? <p className="rounded-xl border border-withheld/60 p-3 text-sm" data-testid="camcheck-error">{state.message}</p> : null}
          </div>

          {cameras.length > 1 ? (
            <label className="mt-5 block text-sm">
              <span className="mb-1 block text-muted">{t('camcheck.camera')}</span>
              <select
                className="w-full rounded-lg border border-hairline bg-bg px-3 py-2"
                value={cameraId ?? stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ''}
                onChange={(e) => pick(e.target.value)}
                data-testid="camcheck-picker"
              >
                {cameras.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {verdict?.ok ? (
              <button className="rounded-full bg-ink px-6 py-3 font-medium text-bg" onClick={() => start(true)} data-testid="camcheck-start">{t('camcheck.start')}</button>
            ) : null}
            {verdict || state.s === 'error' ? (
              <button className={verdict?.ok ? 'rounded-full border border-hairline px-6 py-3' : 'rounded-full bg-ink px-6 py-3 font-medium text-bg'} onClick={() => void check(cameraId)} data-testid="camcheck-again">
                {t('camcheck.again')}
              </button>
            ) : null}
            <button className="rounded-full border border-hairline px-6 py-3" onClick={p.onCancel}>{t('consent.notNow')}</button>
          </div>
          {verdict && !verdict.ok && verdict.level === 'slow' ? (
            <button className="mt-4 text-sm text-muted underline hover:text-ink" onClick={() => start(false)} data-testid="camcheck-anyway">{t('camcheck.anyway')}</button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
