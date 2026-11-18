import {
  GATE_V1,
  GateSession,
  secondsUntilClean,
  type GateConfig,
  type Metric,
  type Receipt,
  type RuleId,
} from '@witness/gate';
import {
  Code,
  ErrorCode,
  GateEventMapper,
  metricsFor,
  Status,
  type SourceEvent,
  type VitalsSource,
} from '@witness/sdk-adapter';
import { createActor } from 'xstate';
import { flowMachine, type Phase } from './machine.js';
import { flickerCopy, restartCopy, RULE_COPY } from './strings.js';

const US = 1e6;

export interface MetricView {
  metric: Metric;
  windowS: number;
  status: 'idle' | 'filling' | 'verified' | 'withheld' | 'out_of_range';
  /** 0..1 progress of the current clean window. */
  progress: number;
  /** Latest VERIFIED value (what the UI shows). */
  shown: { value: number; receipt: Receipt; verifiedAtUs: number } | null;
  latest: Receipt | null;
  countdownS: number;
  reasons: RuleId[];
  /** Increments each time this window is restarted by contamination (animation trigger). */
  rewinds: number;
  /** Progress at which the last rewind happened (for the coral tick). */
  brokeAt: number | null;
}

export interface Coaching {
  text: string;
  from: 'sdk' | 'witness' | 'paused';
  code?: number;
}

export interface SessionView {
  phase: Phase;
  mode: 'quick' | 'full';
  source: { kind: 'real' | 'replay'; label: string; sdkVersion: string } | null;
  elapsedS: number;
  capS: number;
  coaching: Coaching | null;
  paused: boolean;
  metrics: Record<Metric, MetricView>;
  requested: Metric[];
  light: { latest: [number, number] | null; spark: [number[], number[]] };
  waveforms: { pulse: number[]; chest: number[] };
  error: { code: number; message: string; retryable: boolean } | null;
  receiptCount: number;
  chainHead: string | null;
  sdkRunning: boolean;
}

export interface CheckinRecord {
  id: string;
  startedAt: string;
  durationS: number;
  mode: 'quick' | 'full';
  sourceKind: 'real' | 'replay';
  sourceLabel: string;
  sdkVersion: string;
  gateConfigHash: string;
  results: { metric: Metric; value: number; unit: string; receipt: Receipt }[];
  /** SDK readings marked stable that Witness withheld (for the "SDK alone" ghost overlay). */
  withheldStable: { metric: Metric; value: number; tUs: number; reasons: RuleId[] }[];
  chainHead: string;
  stoppedBy: 'complete' | 'cap' | 'user' | 'hidden' | 'error' | 'source_end';
}

export interface ControllerOptions {
  /** Builds the source. Only ever called after the user accepts consent. */
  createSource: (mode: 'quick' | 'full') => VitalsSource;
  cfg?: GateConfig;
  capS?: number;
  /** Minimum time a coaching message stays up (ms). */
  coachHoldMs?: number;
  now?: () => number;
  newId?: () => string;
  /** View publish rate (Hz). */
  fps?: number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: unknown) => void;
  onComplete?: (rec: CheckinRecord) => void;
}

const emptyMetric = (metric: Metric, windowS: number): MetricView => ({
  metric, windowS, status: 'idle', progress: 0, shown: null, latest: null, countdownS: windowS, reasons: [], rewinds: 0, brokeAt: null,
});

const SPARK = 90;
const WAVE = 180;

export class SessionController {
  private readonly actor = createActor(flowMachine).start();
  private readonly cfg: GateConfig;
  private readonly capS: number;
  private readonly opts: ControllerOptions;
  private readonly listeners = new Set<(v: SessionView) => void>();
  private source: VitalsSource | null = null;
  private unsub: (() => void) | null = null;
  private gate: GateSession | null = null;
  private mapper: GateEventMapper | null = null;
  private mode: 'quick' | 'full' = 'quick';
  private view: SessionView;
  private timer: unknown = null;
  private lastSdkCode = Code.ok as number;
  private lastSdkHint = '';
  private coach: Coaching | null = null;
  private coachSince = 0;
  private sparkA: number[] = [];
  private sparkB: number[] = [];
  private wavePulse: number[] = [];
  private waveChest: number[] = [];
  private lastBg: [number, number] | null = null;
  private withheldStable: CheckinRecord['withheldStable'] = [];
  private startedAt = '';
  private sessionId = '';
  private error: SessionView['error'] = null;
  private sdkRunning = false;
  private finished = false;

  constructor(opts: ControllerOptions) {
    this.opts = opts;
    this.cfg = opts.cfg ?? GATE_V1;
    this.capS = opts.capS ?? 180;
    this.view = this.buildView();
  }

  get phase(): Phase {
    return this.actor.getSnapshot().value as Phase;
  }

  get snapshot(): SessionView {
    return this.view;
  }

  subscribe(l: (v: SessionView) => void): () => void {
    this.listeners.add(l);
    l(this.view);
    return () => this.listeners.delete(l);
  }

  /** Home → consent card. Nothing touches the camera here. */
  checkIn(mode: 'quick' | 'full'): void {
    this.mode = mode;
    this.actor.send({ type: 'CHECK_IN' });
    if (this.phase === 'consent') {
      this.error = null;
      this.publish();
    }
  }

  decline(): void {
    this.actor.send({ type: 'DECLINE' });
    this.publish();
  }

  /** The consent click. This is the only path that creates (and starts) a source. */
  async accept(): Promise<void> {
    if (this.phase !== 'consent') return;
    this.actor.send({ type: 'ACCEPT' });
    this.reset();
    const src = this.opts.createSource(this.mode);
    this.source = src;
    this.sessionId = this.opts.newId?.() ?? `ses_${Math.random().toString(36).slice(2, 12)}`;
    this.startedAt = new Date(this.opts.now?.() ?? Date.now()).toISOString();
    this.gate = new GateSession(this.sessionId, src.sdkVersion, this.cfg);
    this.mapper = new GateEventMapper(this.mode);
    for (const g of this.mapper.start(0)) this.gate.push(g);
    this.unsub = src.on((e) => this.onEvent(e));
    const si = this.opts.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.timer = si(() => this.onTick(), 1000 / (this.opts.fps ?? 10));
    this.publish();
    try {
      await src.start();
      if (src.kind === 'replay' && (this.phase as Phase) === 'acquiring') this.actor.send({ type: 'RUNNING' });
    } catch (err) {
      const e = err as { code?: number; message?: string; retryable?: boolean };
      this.fail({ code: typeof e.code === 'number' ? e.code : -1, message: e.message ?? String(err), retryable: !!e.retryable });
    }
    this.publish();
  }

  stop(): void {
    void this.finish('user');
  }

  /** Window minimized/hidden: stop within a second. */
  hide(): void {
    if (this.phase === 'consent') {
      this.actor.send({ type: 'HIDE' });
      this.publish();
      return;
    }
    void this.finish('hidden');
  }

  again(): void {
    this.actor.send({ type: 'AGAIN' });
    this.publish();
  }

  dismiss(): void {
    this.actor.send({ type: 'DISMISS' });
    this.publish();
  }

  destroy(): void {
    void this.teardown();
    this.actor.stop();
    this.listeners.clear();
  }

  // ---------------------------------------------------------------------------

  private reset(): void {
    this.lastSdkCode = Code.ok;
    this.lastSdkHint = '';
    this.coach = null;
    this.coachSince = 0;
    this.sparkA = [];
    this.sparkB = [];
    this.wavePulse = [];
    this.waveChest = [];
    this.lastBg = null;
    this.withheldStable = [];
    this.error = null;
    this.sdkRunning = false;
    this.finished = false;
    this.metricState = {
      pulse: emptyMetric('pulse', this.cfg.windowsS.pulse),
      breathing: emptyMetric('breathing', this.cfg.windowsS.breathing),
      hrv: emptyMetric('hrv', this.cfg.windowsS.hrv),
    };
  }

  private metricState: Record<Metric, MetricView> = {
    pulse: emptyMetric('pulse', 12),
    breathing: emptyMetric('breathing', 30),
    hrv: emptyMetric('hrv', 60),
  };

  private onEvent(e: SourceEvent): void {
    if (!this.gate || !this.mapper || this.finished) return;
    for (const g of this.mapper.map(e)) {
      const r = this.gate.push(g);
      if (r) this.onReceipt(r);
    }
    switch (e.type) {
      case 'status':
        this.sdkRunning = e.status === Status.running;
        if (e.status === Status.running && this.phase === 'acquiring') this.actor.send({ type: 'RUNNING' });
        break;
      case 'validation':
        this.onValidation(e.code, e.hint);
        break;
      case 'frame':
        this.lastBg = e.bg;
        this.sparkA.push(e.bg[0]);
        this.sparkB.push(e.bg[1]);
        if (this.sparkA.length > SPARK) this.sparkA.shift();
        if (this.sparkB.length > SPARK) this.sparkB.shift();
        break;
      case 'trace': {
        const buf = e.kind === 'pulse' ? this.wavePulse : this.waveChest;
        buf.push(e.value);
        if (buf.length > WAVE) buf.shift();
        break;
      }
      case 'error':
        this.fail({ code: e.code, message: e.message, retryable: e.retryable });
        break;
      case 'end':
        void this.finish('source_end');
        break;
    }
  }

  private onValidation(code: number, hint: string): void {
    if (code === Code.multipleFaces && this.phase !== 'paused') this.actor.send({ type: 'FACES_MULTIPLE' });
    else if (code !== Code.multipleFaces && this.phase === 'paused') this.actor.send({ type: 'FACES_OK' });
    if (code !== this.lastSdkCode) {
      this.lastSdkCode = code;
      this.lastSdkHint = hint;
    }
  }

  private onReceipt(r: Receipt): void {
    const m = this.metricState[r.metric];
    if (!this.requested().includes(r.metric)) return;
    const prev = m.latest;
    m.latest = r;
    m.reasons = r.reasons;
    if (r.verdict === 'VERIFIED') {
      m.shown = { value: r.value, receipt: r, verifiedAtUs: r.window.endUs };
      m.status = 'verified';
    } else if (r.verdict === 'WITHHELD') {
      if (r.sdk.stable) this.withheldStable.push({ metric: r.metric, value: r.value, tUs: r.window.endUs, reasons: r.reasons });
      const wasClean = !prev || prev.verdict !== 'WITHHELD' || newestViolation(prev) !== newestViolation(r);
      if (wasClean && m.progress > 0.02) {
        m.rewinds++;
        m.brokeAt = m.progress;
      }
      m.status = 'withheld';
    } else if (r.verdict === 'OUT_OF_RANGE') {
      m.status = 'out_of_range';
    } else {
      m.status = 'filling';
    }
    if (this.requested().every((k) => this.metricState[k].shown)) void this.finish('complete');
  }

  private onTick(): void {
    if (!this.source || this.finished) return;
    const now = this.source.nowUs();
    if (now / US >= this.capS) {
      void this.finish('cap');
      return;
    }
    this.publish();
  }

  private requested(): Metric[] {
    return metricsFor(this.mode);
  }

  private updateProgress(nowUs: number): void {
    for (const k of this.requested()) {
      const m = this.metricState[k];
      const W = m.windowS;
      const r = m.latest;
      if (r && r.verdict === 'VERIFIED') {
        m.progress = 1;
        m.countdownS = 0;
      } else if (r && r.verdict === 'WITHHELD') {
        const left = Math.min(W, secondsUntilClean(r, nowUs));
        m.countdownS = left;
        m.progress = Math.max(0, Math.min(1, (W - left) / W));
      } else {
        // Warming up: progress since the stream started (start-up tuning excluded).
        const r1 = r?.checks.find((c) => c.id === 'R1_WARMUP');
        const el = typeof r1?.observed === 'number' ? r1.observed + (nowUs - r!.window.endUs) / US : nowUs / US;
        m.progress = Math.max(0, Math.min(1, el / W));
        m.countdownS = Math.max(0, W - el);
        if (m.status === 'idle' && el > 0) m.status = 'filling';
      }
    }
  }

  private coaching(nowMs: number): Coaching | null {
    let next: Coaching | null = null;
    if (this.phase === 'paused') next = { text: RULE_COPY.R5_ONE_CONTINUOUS_FACE, from: 'paused', code: Code.multipleFaces };
    else if (this.lastSdkCode !== Code.ok && this.lastSdkHint) next = { text: this.lastSdkHint, from: 'sdk', code: this.lastSdkCode };
    else {
      // the most-advanced requested metric that is currently withheld
      for (const k of this.requested()) {
        const m = this.metricState[k];
        if (m.status !== 'withheld' || !m.latest) continue;
        const top = m.reasons[0];
        if (!top) continue;
        let text = RULE_COPY[top];
        if (top === 'R9_STEADY_LIGHT') {
          const c = m.latest.checks.find((x) => x.id === 'R9_STEADY_LIGHT');
          const per = (c?.observed as { coincidentPeakPerMin?: number | null } | null)?.coincidentPeakPerMin ?? null;
          text = flickerCopy(per);
        }
        next = { text: `${text} ${restartCopy(m.windowS)}`, from: 'witness' };
        break;
      }
    }
    // Debounce: hold a message ≥ coachHoldMs unless the next one is "paused".
    const hold = this.opts.coachHoldMs ?? 1200;
    if (this.coach && next?.text !== this.coach.text && next?.from !== 'paused' && nowMs - this.coachSince < hold) return this.coach;
    if (next?.text !== this.coach?.text) {
      this.coach = next;
      this.coachSince = nowMs;
    }
    return this.coach;
  }

  private buildView(): SessionView {
    const nowUs = this.source?.nowUs() ?? 0;
    if (this.source && !this.finished) this.updateProgress(nowUs);
    const nowMs = this.opts.now?.() ?? Date.now();
    const clone = (m: MetricView): MetricView => ({ ...m, reasons: [...m.reasons] });
    return {
      phase: this.phase,
      mode: this.mode,
      source: this.source ? { kind: this.source.kind, label: this.source.label, sdkVersion: this.source.sdkVersion } : null,
      elapsedS: nowUs / US,
      capS: this.capS,
      coaching: this.phase === 'measuring' || this.phase === 'paused' || this.phase === 'acquiring' ? this.coaching(nowMs) : null,
      paused: this.phase === 'paused',
      metrics: { pulse: clone(this.metricState.pulse), breathing: clone(this.metricState.breathing), hrv: clone(this.metricState.hrv) },
      requested: this.requested(),
      light: { latest: this.lastBg, spark: [[...this.sparkA], [...this.sparkB]] },
      waveforms: { pulse: [...this.wavePulse], chest: [...this.waveChest] },
      error: this.error,
      receiptCount: this.gate?.receipts.length ?? 0,
      chainHead: this.gate?.chainHead ?? null,
      sdkRunning: this.sdkRunning,
    };
  }

  private publish(): void {
    this.view = this.buildView();
    for (const l of [...this.listeners]) l(this.view);
  }

  private fail(err: NonNullable<SessionView['error']>): void {
    this.error = err;
    this.actor.send({ type: 'ERROR' });
    // never auto-restart on sustained low frame rate (SDK docs); just stop.
    void this.teardown();
    this.publish();
  }

  private async finish(by: CheckinRecord['stoppedBy']): Promise<void> {
    if (this.finished || !this.source) {
      if (by === 'hidden' || by === 'user') {
        this.actor.send({ type: by === 'hidden' ? 'HIDE' : 'STOP' });
        this.publish();
      }
      return;
    }
    this.finished = true;
    const durationS = this.source.nowUs() / US;
    this.updateProgress(this.source.nowUs());
    this.actor.send({ type: by === 'complete' || by === 'cap' || by === 'source_end' ? 'DONE' : by === 'hidden' ? 'HIDE' : 'STOP' });
    const gate = this.gate!;
    const rec: CheckinRecord = {
      id: this.sessionId,
      startedAt: this.startedAt,
      durationS,
      mode: this.mode,
      sourceKind: this.source.kind,
      sourceLabel: this.source.label,
      sdkVersion: this.source.sdkVersion,
      gateConfigHash: gate.receipts[0]?.gateConfigHash ?? '',
      results: this.requested()
        .map((k) => this.metricState[k].shown)
        .filter((s): s is NonNullable<MetricView['shown']> => !!s)
        .map((s) => ({ metric: s.receipt.metric, value: s.value, unit: s.receipt.unit, receipt: s.receipt })),
      withheldStable: this.withheldStable,
      chainHead: gate.chainHead,
      stoppedBy: by,
    };
    this.opts.onComplete?.(rec);
    const done = this.teardown();
    this.publish();
    await done;
  }

  private async teardown(): Promise<void> {
    if (this.timer !== null) (this.opts.clearInterval ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>)))(this.timer);
    this.timer = null;
    const src = this.source;
    this.unsub?.();
    this.unsub = null;
    if (!src) return;
    this.finished = true;
    try {
      await src.stop();
    } catch {
      /* already stopped */
    }
    src.destroy();
    this.sdkRunning = false;
  }
}

function newestViolation(r: Receipt): number {
  let t = -Infinity;
  for (const c of r.checks) if (!c.pass && c.lastViolationUs !== undefined) t = Math.max(t, c.lastViolationUs);
  return t;
}

export { ErrorCode };
