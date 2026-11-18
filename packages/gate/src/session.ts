import { GENESIS } from './canonical.js';
import type { GateConfig } from './config.js';
import { evaluate } from './evaluate.js';
import type { GateEvent, Metric, Receipt } from './types.js';

/**
 * Stateful convenience wrapper used by the app, bench and verifier: holds
 * the session's events (pruned to the longest lookback), evaluates every SDK
 * rate sample, and chains receipts.
 */
export class GateSession {
  private events: GateEvent[] = [];
  private prev = GENESIS;
  readonly receipts: Receipt[] = [];
  private readonly keepUs: number;
  private sessionEvent: GateEvent | null = null;
  private readyEvent: GateEvent | null = null;

  constructor(
    readonly sessionId: string,
    readonly sdkVersion: string,
    readonly cfg: GateConfig,
  ) {
    const w = Math.max(...Object.values(cfg.windowsS), cfg.liveFace.blinkWindowS);
    this.keepUs = (w + 5) * 1e6;
  }

  push(e: GateEvent): Receipt | null {
    if (e.kind === 'session') this.sessionEvent = e;
    if (e.kind === 'stream_ready' && !this.readyEvent) this.readyEvent = e;
    this.events.push(e);
    if (e.kind !== 'rate') return null;
    return this.evaluateNow(e);
  }

  private evaluateNow(sample: Extract<GateEvent, { kind: 'rate' }>): Receipt {
    this.prune(sample.t);
    const r = evaluate(sample, this.events, this.cfg, { sessionId: this.sessionId, sdkVersion: this.sdkVersion, prevReceiptHash: this.prev });
    this.prev = r.receiptHash;
    this.receipts.push(r);
    return r;
  }

  /**
   * Keep everything inside the lookback plus the latest piecewise state
   * (validation, talking) before it, so carried-in state survives pruning.
   */
  private prune(nowUs: number): void {
    const cut = nowUs - this.keepUs;
    if (!this.events.length || this.events[0]!.t >= cut) return;
    let lastVal: GateEvent | null = null;
    let lastTalk: GateEvent | null = null;
    const keep: GateEvent[] = [];
    for (const e of this.events) {
      if (e.t < cut) {
        if (e.kind === 'validation' && (!lastVal || e.t >= lastVal.t)) lastVal = e;
        if (e.kind === 'talking' && (!lastTalk || e.t >= lastTalk.t)) lastTalk = e;
        continue;
      }
      keep.push(e);
    }
    const head: GateEvent[] = [];
    if (this.sessionEvent && this.sessionEvent.t < cut) head.push(this.sessionEvent);
    if (this.readyEvent && this.readyEvent.t < cut) head.push(this.readyEvent);
    if (lastVal) head.push(lastVal);
    if (lastTalk) head.push(lastTalk);
    this.events = [...head, ...keep];
  }

  get chainHead(): string {
    return this.prev;
  }

  /** Last VERIFIED receipt per metric (what the UI shows). */
  latestVerified(metric: Metric): Receipt | null {
    for (let i = this.receipts.length - 1; i >= 0; i--) {
      const r = this.receipts[i]!;
      if (r.metric === metric && r.verdict === 'VERIFIED') return r;
    }
    return null;
  }
}
