import { faceBox, normaliseBox, OffsetEstimator, type Point } from '@witness/features';
import {
  RealSmartSpectra, requestedMetrics, type RendererSdkLike, syntheticTrace, TraceReplaySdk, type Scenario, type SourceEvent, type VitalsSource,
} from '@witness/sdk-adapter';
import { bridge } from './bridge';

export type SourceChoice = { kind: 'camera' } | { kind: 'replay'; scenario: Scenario };

/** Per-frame worker cost samples (ms) for the performance budget check. */
export const workerStats: number[] = [];

/**
 * The real camera source: the SDK acquires the camera (AE/AWB/focus locked
 * once Running); we clone its track for the feature worker, which reports ROI
 * luminance per frame. Stopping stops our clone too, so the camera LED goes off.
 */
class CameraSource implements VitalsSource {
  readonly kind = 'real' as const;
  readonly label = 'Camera';
  readonly mode: 'quick' | 'full';
  readonly sdkVersion: string;
  private readonly real: RealSmartSpectra;
  private worker: Worker | null = null;
  private clone: MediaStreamTrack | null = null;
  private readonly frameClock = new OffsetEstimator(301);
  private lastBoxAt = 0;

  constructor(mode: 'quick' | 'full', sdkVersion: string, telemetry: boolean) {
    this.mode = mode;
    this.sdkVersion = sdkVersion;
    this.real = new RealSmartSpectra({
      mode,
      sdkVersion,
      create: async () => {
        const key = await bridge.session.getKey();
        if (!key) throw Object.assign(new Error('No API key'), { code: 2, retryable: false });
        const { SmartSpectraSDK } = await import('@smartspectra/node-sdk/renderer');
        return new SmartSpectraSDK({
          apiKey: key,
          requestedMetrics: requestedMetrics(mode),
          enableTelemetry: telemetry,
          enableAccumulatedOutput: false,
          logLevel: 2,
          sendTimeoutMs: 15000,
        }) as unknown as RendererSdkLike;
      },
      decode: (buf) => decodeLater(buf),
      onLandmarks: (_t, pts) => this.onLandmarks(pts),
    });
    this.real.onStream((s) => this.attachWorker(s));
  }

  private onLandmarks(pts: Point[]): void {
    const now = performance.now();
    if (!this.worker || now - this.lastBoxAt < 500) return;
    this.lastBoxAt = now;
    const b = faceBox(pts, 1.6);
    if (!b) return;
    // Landmarks may be normalised or in pixels; the worker wants normalised.
    const box = normaliseBox(b, this.videoSize?.w ?? 1280, this.videoSize?.h ?? 720);
    this.worker.postMessage({ type: 'face', box });
  }

  private videoSize: { w: number; h: number } | null = null;

  private attachWorker(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const s = track.getSettings();
    this.videoSize = { w: s.width ?? 1280, h: s.height ?? 720 };
    const MSTP = (globalThis as unknown as { MediaStreamTrackProcessor?: new (o: { track: MediaStreamTrack }) => { readable: ReadableStream<VideoFrame> } }).MediaStreamTrackProcessor;
    if (!MSTP) {
      console.warn('[witness] MediaStreamTrackProcessor unavailable: no frame features (R8/R9 will fail closed)');
      return;
    }
    this.clone = track.clone();
    const proc = new MSTP({ track: this.clone });
    this.worker = new Worker(new URL('./feature-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<{ type: 'frame'; ts: number; arrival: number; bg: [number, number]; chest: number | null; face: number | null; workMs: number }>) => {
      const m = e.data;
      this.frameClock.add(m.arrival, m.ts);
      const t = this.real.sessionTime(this.frameClock.toSession(m.ts, m.arrival));
      workerStats.push(m.workMs);
      if (workerStats.length > 2000) workerStats.shift();
      this.real.inject({ type: 'frame', t, bg: m.bg, chest: m.chest, face: m.face });
    };
    this.worker.postMessage({ type: 'start', readable: proc.readable }, [proc.readable as unknown as Transferable]);
  }

  private stopWorker(): void {
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.clone?.stop();
    this.clone = null;
  }

  start(): Promise<void> {
    return this.real.start();
  }
  async stop(): Promise<void> {
    this.stopWorker();
    await this.real.stop();
  }
  destroy(): void {
    this.stopWorker();
    this.real.destroy();
  }
  nowUs(): number {
    return this.real.nowUs();
  }
  on(l: (e: SourceEvent) => void): () => void {
    return this.real.on(l);
  }
  onStream(l: (s: MediaStream) => void): () => void {
    return this.real.onStream(l);
  }
}

// decodeMetrics is loaded with the SDK, on demand.
let decoder: ((b: Uint8Array) => unknown) | null = null;
function decodeLater(buf: Uint8Array) {
  if (!decoder) throw new Error('decoder not loaded');
  return decoder(buf) as never;
}
export async function loadDecoder(): Promise<void> {
  if (decoder) return;
  const m = await import('@smartspectra/node-sdk/messages');
  decoder = m.decodeMetrics as unknown as (b: Uint8Array) => unknown;
}

export async function prepareSource(choice: SourceChoice): Promise<void> {
  if (choice.kind === 'camera') await loadDecoder();
}

export function createSource(choice: SourceChoice, mode: 'quick' | 'full', o: { sdkVersion: string; telemetry: boolean; speed?: number }): VitalsSource {
  if (choice.kind === 'replay') return new TraceReplaySdk(syntheticTrace(choice.scenario, { mode }), { speed: o.speed ?? 1 });
  return new CameraSource(mode, o.sdkVersion, o.telemetry);
}
