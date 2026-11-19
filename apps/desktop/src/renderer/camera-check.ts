// Camera pre-check, run after consent and before the SDK starts (which is what
// spends Presage minutes). SmartSpectra ends a session that stays below
// 25 fps, so a slow or dark camera is caught here, for free, with a reason
// and a way to fix it. Nothing is stored: only a frame count, frame
// timestamps and a coarse mean brightness are computed, then the frames are closed.

/** SmartSpectra stops a session whose frame rate stays below this. */
export const SDK_MIN_FPS = 25;
/** Margin above the SDK floor before we call a camera good. */
export const GOOD_FPS = 27;
const BLACK_LUMA = 12;
const DIM_LUMA = 45;

export interface CameraSample {
  fps: number | null;
  /** Mean luma 0-255 over a coarse downscale of the frame. */
  luma: number | null;
  width: number;
  height: number;
  frames: number;
}

export type CameraVerdict =
  | { ok: true; level: 'good' | 'borderline'; reason: string }
  | { ok: false; level: 'slow' | 'black' | 'none'; reason: string };

/** Pure: turns a 3-s sample into a verdict and plain advice. */
export function assessCamera(s: CameraSample): CameraVerdict {
  if (s.frames < 2 || s.fps === null) {
    return { ok: false, level: 'none', reason: 'No frames arrived from this camera. Close other apps using it (Zoom, Teams, a browser tab), or pick another camera.' };
  }
  if (s.luma !== null && s.luma < BLACK_LUMA) {
    return { ok: false, level: 'black', reason: 'This camera shows an almost black image. Open the privacy shutter or camera switch, or pick another camera. Some laptops list an infrared (face sign-in) camera first.' };
  }
  const fps = Math.round(s.fps);
  if (s.fps < SDK_MIN_FPS) {
    const dim = s.luma !== null && s.luma < DIM_LUMA;
    return {
      ok: false,
      level: 'slow',
      reason: `This camera is giving ${fps} fps; SmartSpectra needs ${SDK_MIN_FPS} or more and would stop the check-in. ${
        dim ? 'The picture is dim, so the camera is slowing down to collect light: face a window or a lamp.' : 'Add light in front of you, turn off low-light compensation in the camera settings, or pick another camera.'
      }`,
    };
  }
  if (s.fps < GOOD_FPS) {
    return { ok: true, level: 'borderline', reason: `${fps} fps, just above SmartSpectra's ${SDK_MIN_FPS} fps floor. More light in front of you makes the check-in less likely to stop.` };
  }
  return { ok: true, level: 'good', reason: `${fps} fps at ${s.width}×${s.height}.` };
}

/** fps from capture timestamps (µs), robust to a slow first frame. */
export function fpsFromTimestamps(tsUs: number[]): number | null {
  if (tsUs.length < 2) return null;
  const sorted = [...tsUs].sort((a, b) => a - b);
  const spanS = (sorted[sorted.length - 1]! - sorted[0]!) / 1e6;
  return spanS > 0 ? (sorted.length - 1) / spanS : null;
}

const CAMERA_KEY = 'witness.cameraId';
export function savedCameraId(): string | null {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
}
export function saveCameraId(id: string | null): void {
  try {
    if (id) localStorage.setItem(CAMERA_KEY, id);
    else localStorage.removeItem(CAMERA_KEY);
  } catch {
    // per-device convenience only
  }
}

export async function listCameras(): Promise<{ id: string; label: string }[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

/** Same request as the SDK's own default, plus an optional chosen device. Video only. */
export function openCamera(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }),
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
  });
}

type Mstp = new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> };

/**
 * Reads frames from a clone of the track for `ms`, counting them and taking a
 * coarse brightness from every 8th. Returns null when the browser has no
 * MediaStreamTrackProcessor (the check is then skipped, not failed).
 */
export async function sampleCamera(stream: MediaStream, ms = 3000, onProgress?: (p: number) => void): Promise<CameraSample | null> {
  const MSTP = (globalThis as unknown as { MediaStreamTrackProcessor?: Mstp }).MediaStreamTrackProcessor;
  const track = stream.getVideoTracks()[0];
  if (!MSTP || !track) return null;
  const settings = track.getSettings();
  const clone = track.clone();
  const reader = new MSTP({ track: clone }).readable.getReader();
  const canvas = new OffscreenCanvas(32, 18);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const ts: number[] = [];
  const lumas: number[] = [];
  const t0 = performance.now();
  // Skip the first 400 ms: cameras often deliver a burst or a stall while starting.
  const settle = 400;
  const timer = setTimeout(() => void reader.cancel().catch(() => undefined), ms + settle);
  try {
    for (;;) {
      const { value: frame, done } = await reader.read();
      if (done || !frame) break;
      const now = performance.now() - t0;
      if (now >= settle) {
        ts.push(frame.timestamp);
        if (ctx && ts.length % 8 === 1) {
          ctx.drawImage(frame, 0, 0, 32, 18);
          const d = ctx.getImageData(0, 0, 32, 18).data;
          let s = 0;
          for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
          lumas.push(s / (d.length / 4));
        }
        onProgress?.(Math.min(1, (now - settle) / ms));
      }
      frame.close();
    }
  } finally {
    clearTimeout(timer);
    clone.stop();
  }
  return {
    fps: fpsFromTimestamps(ts),
    luma: lumas.length ? lumas.reduce((a, b) => a + b, 0) / lumas.length : null,
    width: settings.width ?? 0,
    height: settings.height ?? 0,
    frames: ts.length,
  };
}

/**
 * Lock exposure, white balance and focus where the camera allows it, as the
 * SDK does for streams it opens itself. Only called once the pre-check showed
 * a healthy frame rate: locking a long low-light exposure would pin the
 * camera below the SDK's floor for the whole session.
 */
export function lockCamera(stream: MediaStream): void {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as Record<string, unknown>;
  const has = (k: string) => Array.isArray(caps[k]) && (caps[k] as string[]).includes('manual');
  const advanced = (['exposureMode', 'whiteBalanceMode', 'focusMode'] as const).filter(has).map((k) => ({ [k]: 'manual' }));
  if (advanced.length) void track.applyConstraints({ advanced } as MediaTrackConstraints).catch((e: Error) => console.warn('[witness] camera lock not applied:', e.message));
}
