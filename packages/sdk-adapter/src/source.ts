import type { SourceEvent } from './events.js';

/**
 * One interface over the real SDK and trace replay. The UI must not be able
 * to tell them apart, except for `kind`, which drives the visible "Replay" badge.
 */
export interface VitalsSource {
  readonly kind: 'real' | 'replay';
  /** Short human label, e.g. "Camera" or "Replay · synthetic: talking". */
  readonly label: string;
  readonly mode: 'quick' | 'full';
  readonly sdkVersion: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): void;
  /** Current session-clock time (µs since start()). */
  nowUs(): number;
  /** Subscribe to normalized events. Returns an unsubscribe function. */
  on(listener: (e: SourceEvent) => void): () => void;
  /** Live camera stream for the preview (real source only). */
  onStream(listener: (stream: MediaStream) => void): () => void;
}

export interface Clock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
}

export const systemClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

export class Emitter<T> {
  private readonly ls = new Set<(x: T) => void>();
  on(l: (x: T) => void): () => void {
    this.ls.add(l);
    return () => this.ls.delete(l);
  }
  emit(x: T): void {
    for (const l of [...this.ls]) {
      try {
        l(x);
      } catch (err) {
        console.error('listener threw', err);
      }
    }
  }
  clear(): void {
    this.ls.clear();
  }
}
