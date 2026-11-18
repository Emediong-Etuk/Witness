import { OffsetEstimator, type Point } from '@witness/features';
import { Status, type SourceEvent } from './events.js';
import { LandmarkFeatureTracker, normalizeMetrics, type DecodedMetricsLike } from './normalize.js';
import { Emitter, type VitalsSource } from './source.js';

/** The slice of `@smartspectra/node-sdk/renderer`'s SmartSpectraSDK we use. */
export interface RendererSdkLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  on(event: string, cb: (...args: never[]) => void): unknown;
}

export interface RealOptions {
  /** Builds the renderer SDK (injected so this package has no SDK dependency). */
  create: () => RendererSdkLike;
  decode: (buf: Uint8Array) => DecodedMetricsLike;
  mode: 'quick' | 'full';
  sdkVersion: string;
  /** Monotonic renderer clock in µs: performance.timeOrigin + performance.now(). */
  clockUs?: () => number;
  /** Receives landmark sets on the session clock for ROI placement. Coordinates must not be stored. */
  onLandmarks?: (t: number, points: Point[]) => void;
}

const defaultClockUs = () => (performance.timeOrigin + performance.now()) * 1000;

/**
 * Wraps the renderer SDK. Every SDK timestamp (epoch µs, anchored to
 * VideoFrame.timestamp by the SDK) is mapped onto the session clock with a
 * running median offset learned from validation callbacks, which arrive about
 * once per processed frame with little latency. Metric timestamps share that
 * clock domain, so they use the same offset.
 */
export class RealSmartSpectra implements VitalsSource {
  readonly kind = 'real' as const;
  readonly label = 'Camera';
  readonly mode: 'quick' | 'full';
  readonly sdkVersion: string;
  private sdk: RendererSdkLike | null = null;
  private readonly events = new Emitter<SourceEvent>();
  private readonly streams = new Emitter<MediaStream>();
  private readonly sdkClock = new OffsetEstimator(301);
  private readonly tracker = new LandmarkFeatureTracker();
  private readonly clockUs: () => number;
  private t0 = 0;

  constructor(private readonly o: RealOptions) {
    this.mode = o.mode;
    this.sdkVersion = o.sdkVersion;
    this.clockUs = o.clockUs ?? defaultClockUs;
  }

  nowUs(): number {
    return this.clockUs() - this.t0;
  }

  on(l: (e: SourceEvent) => void): () => void {
    return this.events.on(l);
  }

  onStream(l: (s: MediaStream) => void): () => void {
    return this.streams.on(l);
  }

  private toSession(sdkTs: number): number {
    return this.sdkClock.toSession(sdkTs, this.clockUs()) - this.t0;
  }

  async start(): Promise<void> {
    if (this.sdk) return;
    const sdk = this.o.create();
    this.sdk = sdk;
    this.t0 = this.clockUs();
    this.tracker.reset();
    sdk.on('processingStatus', ((status: number) => this.events.emit({ type: 'status', t: this.nowUs(), status })) as never);
    sdk.on('validationStatus', ((code: number, ts: number, hint: string) => {
      this.sdkClock.add(this.clockUs(), ts);
      this.events.emit({ type: 'validation', t: this.toSession(ts), code, hint: String(hint ?? '').slice(0, 256) });
    }) as never);
    sdk.on('metrics', ((buf: Uint8Array, ts: number) => {
      let decoded: DecodedMetricsLike;
      try {
        decoded = this.o.decode(buf);
      } catch {
        return;
      }
      const n = normalizeMetrics(decoded, ts);
      for (const e of n.events) this.events.emit({ ...e, t: this.toSession(e.t) });
      for (const l of n.landmarks) {
        const t = this.toSession(l.t);
        this.events.emit(this.tracker.push(t, l.points, l.reset));
        this.o.onLandmarks?.(t, l.points);
      }
    }) as never);
    sdk.on('error', ((code: number, message: string, retryable: boolean) =>
      this.events.emit({ type: 'error', t: this.nowUs(), code, message: String(message ?? ''), retryable: !!retryable })) as never);
    sdk.on('streamAvailable', ((stream: MediaStream) => this.streams.emit(stream)) as never);
    await sdk.start();
  }

  async stop(): Promise<void> {
    const sdk = this.sdk;
    if (!sdk) return;
    try {
      await sdk.stop();
    } finally {
      this.events.emit({ type: 'status', t: this.nowUs(), status: Status.idle });
    }
  }

  destroy(): void {
    const sdk = this.sdk;
    this.sdk = null;
    try {
      sdk?.destroy();
    } finally {
      this.events.clear();
      this.streams.clear();
    }
  }
}
