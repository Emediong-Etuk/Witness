import type { SourceEvent, TraceHeader, TraceLine } from './events.js';
import { Emitter, systemClock, type Clock, type VitalsSource } from './source.js';

export interface ReplayOptions {
  /** Playback speed multiplier (1 = original timing). */
  speed?: number;
  clock?: Clock;
  /** Tick interval in ms. */
  tickMs?: number;
}

export function parseTrace(text: string): TraceLine[] {
  const out: TraceLine[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    out.push(JSON.parse(line) as TraceLine);
  }
  return out;
}

/**
 * Replays a recorded or synthetic trace with its original timing (or faster).
 * Used for UI development, visual tests, the judge site and most E2E tests,
 * so none of those spend Presage credits.
 */
export class TraceReplaySdk implements VitalsSource {
  readonly kind = 'replay' as const;
  readonly label: string;
  readonly mode: 'quick' | 'full';
  readonly sdkVersion: string;
  readonly header: TraceHeader;
  private readonly events: SourceEvent[];
  private readonly emitter = new Emitter<SourceEvent>();
  private readonly speed: number;
  private readonly clock: Clock;
  private readonly tickMs: number;
  private timer: unknown = null;
  private startedAt: number | null = null;
  private cursor = 0;
  private ended = false;
  private stoppedAtUs = 0;

  constructor(lines: TraceLine[], o: ReplayOptions = {}) {
    const header = lines.find((l): l is TraceHeader => l.type === 'header');
    if (!header) throw new Error('trace has no header line');
    this.header = header;
    this.mode = header.mode;
    this.sdkVersion = header.sdkVersion;
    this.label = `Replay · ${header.source}`;
    this.events = lines.filter((l): l is SourceEvent => l.type !== 'header').sort((a, b) => a.t - b.t);
    this.speed = o.speed ?? 1;
    this.clock = o.clock ?? systemClock;
    this.tickMs = o.tickMs ?? 33;
  }

  get durationUs(): number {
    return this.events.length ? this.events[this.events.length - 1]!.t : 0;
  }

  nowUs(): number {
    if (this.startedAt === null) return this.stoppedAtUs;
    return (this.clock.now() - this.startedAt) * 1000 * this.speed;
  }

  on(listener: (e: SourceEvent) => void): () => void {
    return this.emitter.on(listener);
  }

  onStream(): () => void {
    return () => {};
  }

  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.cursor = 0;
    this.ended = false;
    this.startedAt = this.clock.now();
    this.timer = this.clock.setInterval(() => this.tick(), this.tickMs);
    this.tick();
  }

  /** Emit everything due by now. Exposed for deterministic tests. */
  tick(): void {
    if (this.startedAt === null) return;
    const now = this.nowUs();
    while (this.cursor < this.events.length && this.events[this.cursor]!.t <= now) {
      this.emitter.emit(this.events[this.cursor++]!);
    }
    if (this.cursor >= this.events.length && !this.ended) {
      this.ended = true;
      this.emitter.emit({ type: 'end', t: now });
    }
  }

  async stop(): Promise<void> {
    if (this.timer !== null) this.clock.clearInterval(this.timer);
    this.timer = null;
    if (this.startedAt !== null) {
      this.stoppedAtUs = this.nowUs();
      this.emitter.emit({ type: 'status', t: this.stoppedAtUs, status: 1 });
    }
    this.startedAt = null;
  }

  destroy(): void {
    void this.stop();
    this.emitter.clear();
  }
}
