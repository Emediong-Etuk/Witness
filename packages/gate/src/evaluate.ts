import { analyzeFlicker, chewingScore, maxRollingRms, mean } from '@witness/features';
import { canonical, round6, sha256Hex } from './canonical.js';
import { configHash, type GateConfig } from './config.js';
import {
  METRIC_UNIT,
  type Check,
  type GateEvent,
  type Json,
  type Metric,
  type Receipt,
  type RuleId,
  type SdkRateSample,
  type Verdict,
} from './types.js';

export const GATE_VERSION = '1.0.0';

export interface EvalContext {
  sessionId: string;
  sdkVersion: string;
  prevReceiptHash: string;
}

const US = 1e6;

const KIND_ORDER: Record<GateEvent['kind'], number> = {
  session: 0,
  validation: 1,
  talking: 2,
  blink: 3,
  landmarks_reset: 4,
  face_feature: 5,
  frame: 6,
  rate: 7,
};

interface Keyed {
  e: GateEvent;
  key: string;
}

const keyCache = new WeakMap<GateEvent, string>();
function keyOf(e: GateEvent): string {
  let k = keyCache.get(e);
  if (k === undefined) {
    k = canonical(e);
    keyCache.set(e, k);
  }
  return k;
}

function cmp(a: Keyed, b: Keyed): number {
  return a.e.t - b.e.t || KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/** The last event (in total order) of a kind strictly before `before`. */
function lastBefore(events: readonly GateEvent[], kind: GateEvent['kind'], before: number): Keyed | undefined {
  let best: Keyed | undefined;
  for (const e of events) {
    if (e.kind !== kind || e.t >= before) continue;
    const k = { e, key: keyOf(e) };
    if (!best || cmp(k, best) > 0) best = k;
  }
  return best;
}

/**
 * The events the gate is allowed to look at, in a total order (time, kind,
 * canonical bytes) so the result never depends on arrival order: the session
 * start, the piecewise states carried into the lookback, and everything in it.
 */
function selectInputs(events: readonly GateEvent[], t: number, lookback: number): { sorted: Keyed[]; session: Extract<GateEvent, { kind: 'session' }> | undefined } {
  let session: Keyed | undefined;
  const win: Keyed[] = [];
  for (const e of events) {
    if (e.t > t) continue;
    if (e.kind === 'session') {
      const k = { e, key: keyOf(e) };
      if (!session || cmp(k, session) < 0) session = k;
      continue;
    }
    if (e.t >= lookback) win.push({ e, key: keyOf(e) });
  }
  win.sort(cmp);
  const head: Keyed[] = [];
  if (session) head.push(session);
  const cv = lastBefore(events, 'validation', lookback);
  const ct = lastBefore(events, 'talking', lookback);
  if (cv) head.push(cv);
  if (ct) head.push(ct);
  head.sort(cmp);
  return { sorted: [...head, ...win], session: session?.e as Extract<GateEvent, { kind: 'session' }> | undefined };
}

/** A piecewise-constant state (validation code, talking) integrated over [ws, we]. */
interface Segment<T> {
  from: number;
  to: number;
  value: T | undefined;
}

function segments<T>(sorted: readonly Keyed[], pick: (e: GateEvent) => T | undefined, ws: number, we: number): Segment<T>[] {
  let state: T | undefined;
  const out: Segment<T>[] = [];
  let cursor = ws;
  for (const { e } of sorted) {
    const v = pick(e);
    if (v === undefined) continue;
    if (e.t < ws) {
      state = v;
      continue;
    }
    if (e.t > we) break;
    if (e.t > cursor) out.push({ from: cursor, to: e.t, value: state });
    cursor = Math.max(cursor, e.t);
    state = v;
  }
  if (we > cursor) out.push({ from: cursor, to: we, value: state });
  // a zero-length window still has one (instantaneous) state
  if (out.length === 0) out.push({ from: ws, to: we, value: state });
  return out;
}

function inWindow<K extends GateEvent['kind']>(sorted: readonly Keyed[], kind: K, ws: number, we: number): Extract<GateEvent, { kind: K }>[] {
  const out: Extract<GateEvent, { kind: K }>[] = [];
  for (const { e } of sorted) if (e.kind === kind && e.t >= ws && e.t <= we) out.push(e as Extract<GateEvent, { kind: K }>);
  return out;
}

const r6 = (n: number | null | undefined): number | null => (n === null || n === undefined || !Number.isFinite(n) ? null : round6(n));

/**
 * The Clean-Window Gate. Pure and deterministic: the same sample, events and
 * config always produce a byte-identical receipt.
 *
 * `events` may be the whole session so far; the gate selects what it needs.
 */
export function evaluate(sample: SdkRateSample, events: readonly GateEvent[], cfg: GateConfig, ctx: EvalContext): Receipt {
  const metric = sample.metric;
  const W = cfg.windowsS[metric];
  const t = sample.t;
  const ws = t - W * US;
  const lookback = t - Math.max(W, cfg.liveFace.blinkWindowS) * US;
  const { sorted, session } = selectInputs(events, t, lookback);
  const applies = (id: RuleId) => cfg.appliesTo[id]?.includes(metric) ?? false;
  const checks: Check[] = [];
  // While the window is still filling, evidence is judged over [sessionStart, t].
  const evStart = session ? Math.max(ws, session.t) : ws;
  const minSamples = Math.floor(((t - evStart) / US) * cfg.minEvidenceHz);

  const inputKeys = sorted.map((k) => k.key);
  const sk = keyOf(sample);
  if (!inputKeys.includes(sk)) inputKeys.push(sk);
  const inputsHash = sha256Hex('[' + inputKeys.join(',') + ']');

  // ---- R1 warm-up
  if (applies('R1_WARMUP')) {
    const elapsedS = session ? (t - session.t) / US : null;
    checks.push({
      id: 'R1_WARMUP',
      pass: elapsedS !== null && elapsedS >= W,
      observed: r6(elapsedS),
      threshold: W,
      unit: 's elapsed',
    });
  }

  // ---- R2 SDK stable + confidence
  if (applies('R2_SDK_STABLE')) {
    const min = cfg.sdkConfidenceMin[metric];
    checks.push({
      id: 'R2_SDK_STABLE',
      pass: sample.stable === true && sample.confidence >= min,
      observed: { stable: sample.stable, confidence: r6(sample.confidence) },
      threshold: { stable: true, confidence: min },
    });
  }

  // ---- R3 range
  if (applies('R3_RANGE')) {
    if (metric === 'hrv') {
      const pulses = inWindow(sorted, 'rate', ws, t).filter((e) => e.metric === 'pulse');
      const [lo, hi] = cfg.range.hrvPulse;
      const vals = pulses.map((p) => p.value);
      const ok = vals.length > 0 && vals.every((v) => v >= lo && v <= hi) && sample.value > 0;
      checks.push({
        id: 'R3_RANGE',
        pass: ok,
        observed: { pulseMin: r6(vals.length ? Math.min(...vals) : null), pulseMax: r6(vals.length ? Math.max(...vals) : null), pulseSamples: vals.length },
        threshold: { pulse: [lo, hi] },
        unit: 'bpm',
      });
    } else {
      const [lo, hi] = cfg.range[metric];
      checks.push({ id: 'R3_RANGE', pass: sample.value >= lo && sample.value <= hi, observed: r6(sample.value), threshold: [lo, hi], unit: METRIC_UNIT[metric] });
    }
  }

  // validation state segments over the window
  const valSegs = segments(sorted, (e) => (e.kind === 'validation' ? e.code : undefined), evStart, t);
  const faceCodes = new Set(cfg.validation.faceCountCodes);

  // ---- R4 validation clean (face-count codes are judged by R5)
  if (applies('R4_VALIDATION_CLEAN')) {
    let nonOk = 0;
    let longest = 0;
    let run = 0;
    let lastBad: number | null = null;
    const codes = new Set<number>();
    for (const s of valSegs) {
      const unknown = s.value === undefined;
      const bad = unknown ? cfg.validation.unknownCountsAsNonOk : s.value !== 0 && !faceCodes.has(s.value!);
      const d = s.to - s.from;
      if (bad) {
        nonOk += d;
        run += d;
        longest = Math.max(longest, run);
        lastBad = s.to;
        codes.add(unknown ? -1 : s.value!);
      } else run = 0;
    }
    const total = Math.max(1, t - evStart);
    const share = nonOk / total;
    const check: Check = {
      id: 'R4_VALIDATION_CLEAN',
      pass: share <= cfg.validation.maxNonOkShare && longest / 1000 <= cfg.validation.maxEpisodeMs,
      observed: { nonOkShare: r6(share), longestEpisodeMs: r6(longest / 1000), codes: [...codes].sort((a, b) => a - b) },
      threshold: { maxNonOkShare: cfg.validation.maxNonOkShare, maxEpisodeMs: cfg.validation.maxEpisodeMs },
    };
    checks.push(withViolation(check, check.pass ? null : lastBad));
  }

  // ---- R5 one continuous face
  if (applies('R5_ONE_CONTINUOUS_FACE')) {
    let faceIssueUs = 0;
    let last: number | null = null;
    for (const s of valSegs) {
      if (s.value !== undefined && faceCodes.has(s.value)) {
        faceIssueUs += s.to - s.from;
        last = s.to;
      }
    }
    // an instantaneous face-count event exactly at the sample time also counts
    for (const v of inWindow(sorted, 'validation', ws, t)) if (faceCodes.has(v.code)) last = Math.max(last ?? 0, v.t);
    const resets = inWindow(sorted, 'landmarks_reset', ws, t);
    if (resets.length) last = Math.max(last ?? 0, resets[resets.length - 1]!.t);
    const faceEvents = inWindow(sorted, 'validation', ws, t).filter((v) => faceCodes.has(v.code)).length;
    const pass = faceIssueUs === 0 && faceEvents === 0 && resets.length === 0;
    checks.push(withViolation({
      id: 'R5_ONE_CONTINUOUS_FACE',
      pass,
      observed: { faceCountIssueMs: r6(faceIssueUs / 1000), landmarkResets: resets.length },
      threshold: { faceCountIssueMs: 0, landmarkResets: 0 },
    }, pass ? null : last));
  }

  const ff = inWindow(sorted, 'face_feature', evStart, t);
  const motion = ff.filter((f) => f.motion !== null && Number.isFinite(f.motion));

  // ---- R6 still
  if (applies('R6_STILL')) {
    const enough = motion.length >= Math.max(1, minSamples);
    const ts = motion.map((f) => f.t / US);
    const vs = motion.map((f) => f.motion!);
    const peak = enough ? maxRollingRms(ts, vs, cfg.still.rmsWindowS) : null;
    let last: number | null = null;
    if (peak !== null && peak > cfg.still.maxRms) {
      for (const f of motion) if (Math.abs(f.motion!) > cfg.still.maxRms) last = f.t;
      last ??= t;
    }
    const pass = enough && peak !== null && peak <= cfg.still.maxRms;
    checks.push(withViolation({
      id: 'R6_STILL',
      pass,
      observed: enough ? r6(peak) : { insufficientEvidence: motion.length },
      threshold: cfg.still.maxRms,
      unit: `IOD/frame (${cfg.still.rmsWindowS}s RMS, max)`,
    }, pass ? null : enough ? last : t));
  }

  const talkSegs = segments(sorted, (e) => (e.kind === 'talking' ? e.detected : undefined), evStart, t);

  // ---- R7 quiet
  if (applies('R7_QUIET')) {
    let talkUs = 0;
    let unknownUs = 0;
    let last: number | null = null;
    for (const s of talkSegs) {
      if (s.value === undefined) unknownUs += s.to - s.from;
      else if (s.value) {
        talkUs += s.to - s.from;
        last = s.to;
      }
    }
    const known = unknownUs < 0.5 * Math.max(1, t - evStart);
    const pass = known && talkUs / US < cfg.quiet.maxTalkingS;
    checks.push(withViolation({
      id: 'R7_QUIET',
      pass,
      observed: known ? { talkingS: r6(talkUs / US) } : { insufficientEvidence: true },
      threshold: { maxTalkingS: cfg.quiet.maxTalkingS },
    }, pass ? null : last ?? t));
  }

  const frames = inWindow(sorted, 'frame', evStart, t);

  // ---- R8 frame rate: every full 1-s bin inside the window
  if (applies('R8_FRAME_RATE')) {
    const bin = cfg.frameRate.binS * US;
    const nBins = Math.floor((t - evStart) / bin);
    const counts = new Array<number>(nBins).fill(0);
    for (const f of frames) {
      const k = Math.floor((f.t - evStart) / bin);
      if (k >= 0 && k < nBins) counts[k]!++;
    }
    const fps = counts.map((c) => c / cfg.frameRate.binS);
    const minFps = fps.length ? Math.min(...fps) : 0;
    let last: number | null = null;
    fps.forEach((f, k) => {
      if (f < cfg.frameRate.minFps) last = evStart + (k + 1) * bin;
    });
    const pass = (fps.length > 0 || t - evStart < bin) && (fps.length === 0 || minFps >= cfg.frameRate.minFps);
    checks.push(withViolation({ id: 'R8_FRAME_RATE', pass, observed: r6(minFps), threshold: cfg.frameRate.minFps, unit: 'fps (min 1-s bin)' }, pass ? null : last ?? t));
  }

  // ---- R9 steady light
  if (applies('R9_STEADY_LIGHT')) {
    const sl = cfg.steadyLight;
    const enough = frames.length >= Math.max(1, minSamples);
    let refHz: number | null;
    if (metric === 'hrv') {
      const pulses = inWindow(sorted, 'rate', ws, t).filter((e) => e.metric === 'pulse');
      refHz = pulses.length ? mean(pulses.map((p) => p.value)) / 60 : null;
    } else refHz = sample.value / 60;
    let worstRatio = 0;
    let coincidentHz: number | null = null;
    let coincidentSnr = 0;
    if (enough) {
      const ts = frames.map((f) => f.t / US);
      for (const patch of [0, 1] as const) {
        const y = frames.map((f) => f.bg[patch]);
        const res = analyzeFlicker(ts, y, {
          fs: sl.fs,
          band: sl.bandHz[metric],
          fullBand: sl.fullBandHz,
          refHz,
          tolHz: sl.tolHz[metric],
          segS: sl.segS[metric],
        });
        worstRatio = Math.max(worstRatio, res.bandRatio);
        if (res.coincidentSnr > coincidentSnr) {
          coincidentSnr = res.coincidentSnr;
          coincidentHz = res.coincidentHz;
        }
      }
    }
    const coincident = coincidentSnr > sl.maxCoincidentSnr;
    const pass = enough && worstRatio < sl.maxBandRatio[metric] && !coincident;
    const perMin = (hz: number | null) => (hz === null ? null : r6(hz * 60));
    checks.push(withViolation({
      id: 'R9_STEADY_LIGHT',
      pass,
      observed: enough
        ? { bandRatio: r6(worstRatio), coincidentPeakPerMin: coincident ? perMin(coincidentHz) : null, coincidentSnr: r6(coincidentSnr) }
        : { insufficientEvidence: frames.length },
      threshold: { bandRatio: sl.maxBandRatio[metric], coincidentSnr: sl.maxCoincidentSnr },
    }, pass ? null : t));
  }

  // ---- R10 no chewing
  if (applies('R10_NO_CHEWING')) {
    const c = cfg.chewing;
    const talkingAt = (time: number): boolean => {
      for (const s of talkSegs) if (time >= s.from && time <= s.to) return s.value === true;
      return false;
    };
    const opts = { fs: c.fs, winS: c.winS, hopS: c.hopS, lo: c.loHz, hi: c.hiHz, sustain: c.sustain };
    const enough = ff.length >= Math.max(1, minSamples);
    let peak = 0;
    let lagS: number | null = null;
    if (enough) {
      for (const pick of [(f: (typeof ff)[number]) => f.mouth, (f: (typeof ff)[number]) => f.jaw]) {
        const rows = ff.filter((f) => pick(f) !== null && Number.isFinite(pick(f)!));
        const res = chewingScore(rows.map((f) => f.t / US), rows.map((f) => pick(f)!), rows.map((f) => talkingAt(f.t)), opts);
        if (res.peak > peak) {
          peak = res.peak;
          lagS = res.lagS;
        }
      }
    }
    const pass = enough && peak <= c.maxPeak;
    checks.push(withViolation({
      id: 'R10_NO_CHEWING',
      pass,
      observed: enough ? { autocorrPeak: r6(peak), periodS: r6(lagS) } : { insufficientEvidence: ff.length },
      threshold: { autocorrPeak: c.maxPeak },
    }, pass ? null : t));
  }

  // ---- R11 live face: a blink recently + rigid micro-motion above a floor
  if (applies('R11_LIVE_FACE')) {
    const lf = cfg.liveFace;
    const from = Math.max(session ? session.t : -Infinity, t - lf.blinkWindowS * US);
    const blinks = inWindow(sorted, 'blink', from, t).filter((b) => b.detected).length;
    const meanMotion = motion.length >= Math.max(1, minSamples) ? mean(motion.map((f) => Math.abs(f.motion!))) : null;
    const pass = blinks >= lf.minBlinks && meanMotion !== null && meanMotion >= lf.minMeanMotion;
    checks.push(withViolation({
      id: 'R11_LIVE_FACE',
      pass,
      observed: { blinks, meanMotion: r6(meanMotion) },
      threshold: { minBlinks: lf.minBlinks, minMeanMotion: lf.minMeanMotion },
    }, pass ? null : t));
  }

  const { verdict, reasons } = decide(checks, cfg);

  const body: Omit<Receipt, 'receiptHash'> = {
    v: 1,
    sessionId: ctx.sessionId,
    metric,
    value: round6(sample.value),
    unit: METRIC_UNIT[metric],
    window: { startUs: ws, endUs: t, lengthS: W },
    sdk: { confidence: round6(sample.confidence), stable: sample.stable, sdkVersion: ctx.sdkVersion },
    checks,
    verdict,
    reasons,
    gateVersion: GATE_VERSION,
    gateConfigHash: configHash(cfg),
    inputsHash,
    prevReceiptHash: ctx.prevReceiptHash,
  };
  return { ...body, receiptHash: receiptHashOf(body) };
}

function withViolation(c: Check, lastViolationUs: number | null): Check {
  return lastViolationUs === null ? c : { ...c, lastViolationUs };
}

/**
 * Verdict precedence (BUILD_PROMPT §5.2), with one documented refinement:
 * while the window is still filling (R1 fails), low SDK confidence (R2),
 * range (R3) and "no blink yet" (R11) are expected and don't turn the verdict
 * into WITHHELD. Any
 * contamination rule failing always yields WITHHELD.
 */
export function decide(checks: readonly Check[], cfg: GateConfig): { verdict: Verdict; reasons: RuleId[] } {
  const failed = new Set(checks.filter((c) => !c.pass).map((c) => c.id));
  const order = (ids: Iterable<RuleId>) => [...ids].sort((a, b) => rank(cfg, a) - rank(cfg, b));
  if (failed.size === 0) return { verdict: 'VERIFIED', reasons: [] };
  // Evidence that only accumulates with time (SDK confidence, range, a first blink) is not contamination.
  const accumulating = new Set<RuleId>(['R1_WARMUP', 'R2_SDK_STABLE', 'R3_RANGE', 'R11_LIVE_FACE']);
  const contamination = [...failed].filter((id) => !accumulating.has(id));
  if (failed.has('R1_WARMUP') && contamination.length === 0) return { verdict: 'WARMING_UP', reasons: order(failed) };
  if (failed.size === 1 && failed.has('R3_RANGE')) return { verdict: 'OUT_OF_RANGE', reasons: ['R3_RANGE'] };
  return { verdict: 'WITHHELD', reasons: order(failed) };
}

function rank(cfg: GateConfig, id: RuleId): number {
  const i = cfg.reasonOrder.indexOf(id);
  return i < 0 ? 999 : i;
}

export function receiptHashOf(r: Omit<Receipt, 'receiptHash'> | Receipt): string {
  const { receiptHash: _drop, ...body } = r as Receipt;
  return sha256Hex(canonical(body));
}

/** Seconds until a clean window can complete, for the UI countdown. 0 when nothing is pending. */
export function secondsUntilClean(r: Receipt, nowUs: number): number {
  if (r.verdict === 'VERIFIED' || r.verdict === 'OUT_OF_RANGE') return 0;
  const lastBad = Math.max(
    ...r.checks.filter((c) => !c.pass).map((c) => c.lastViolationUs ?? r.window.startUs),
  );
  if (r.verdict === 'WARMING_UP') {
    const r1 = r.checks.find((c) => c.id === 'R1_WARMUP');
    const elapsed = typeof r1?.observed === 'number' ? r1.observed : 0;
    return Math.max(0, r.window.lengthS - elapsed - (nowUs - r.window.endUs) / US);
  }
  return Math.max(0, r.window.lengthS - (nowUs - lastBad) / US);
}

export type { Json };
