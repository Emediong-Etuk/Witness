import { LandmarkFeatureTracker } from './landmark-tracker.js';
import type { SourceEvent } from './events.js';
import type { Point } from '@witness/features';

/** protobufjs Long-like, number, bigint or string → number. */
export function tsToNumber(ts: unknown): number | null {
  if (ts === null || ts === undefined) return null;
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : null;
  if (typeof ts === 'bigint') return Number(ts);
  if (typeof ts === 'string') {
    const n = Number(ts);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof ts === 'object') {
    const o = ts as { toNumber?: () => number; low?: number; high?: number; unsigned?: boolean };
    if (typeof o.toNumber === 'function') return o.toNumber();
    if (typeof o.low === 'number' && typeof o.high === 'number') {
      const lo = o.low >>> 0;
      return (o.unsigned ? o.high >>> 0 : o.high) * 4294967296 + lo;
    }
  }
  return null;
}

// Loose structural view of the decoded Metrics message (see SDK messages/generated.d.ts).
interface Mwc { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: unknown }
interface Det { detected?: boolean | null; stable?: boolean | null; timestamp?: unknown }
interface Lm { value?: { x?: number | null; y?: number | null }[] | null; reset?: boolean | null; timestamp?: unknown }
interface Hrv { rmssd?: number | null; confidence?: number | null; stable?: boolean | null; timestamp?: unknown }
export interface DecodedMetricsLike {
  cardio?: { pulseRate?: Mwc[] | null; arterialPressureTrace?: Mwc[] | null; hrv?: Hrv[] | null } | null;
  breathing?: { rate?: Mwc[] | null; upperTrace?: { value?: number | null; timestamp?: unknown }[] | null } | null;
  face?: { talking?: Det[] | null; blinking?: Det[] | null; landmarks?: Lm[] | null } | null;
}

export interface Normalized {
  /** Events with SOURCE timestamps (µs); the caller maps them to the session clock. */
  events: SourceEvent[];
  /** Landmark sets with source timestamps: for the feature tracker only, never stored. */
  landmarks: { t: number; points: Point[]; reset: boolean }[];
}

/**
 * Decoded SDK payload → normalized events. Payloads are deltas (only samples
 * since the previous callback), so an empty payload produces nothing; it
 * never clears a previous value.
 */
export function normalizeMetrics(m: DecodedMetricsLike, fallbackTs: number): Normalized {
  const events: SourceEvent[] = [];
  const landmarks: Normalized['landmarks'] = [];
  const ts = (x: unknown) => tsToNumber(x) ?? fallbackTs;
  for (const s of m.cardio?.pulseRate ?? []) {
    if (typeof s.value === 'number') events.push({ type: 'rate', t: ts(s.timestamp), metric: 'pulse', value: s.value, confidence: s.confidence ?? 0, stable: !!s.stable });
  }
  for (const s of m.breathing?.rate ?? []) {
    if (typeof s.value === 'number') events.push({ type: 'rate', t: ts(s.timestamp), metric: 'breathing', value: s.value, confidence: s.confidence ?? 0, stable: !!s.stable });
  }
  for (const s of m.cardio?.hrv ?? []) {
    if (typeof s.rmssd === 'number') events.push({ type: 'rate', t: ts(s.timestamp), metric: 'hrv', value: s.rmssd, confidence: s.confidence ?? 0, stable: !!s.stable });
  }
  for (const s of m.cardio?.arterialPressureTrace ?? []) {
    if (typeof s.value === 'number') events.push({ type: 'trace', t: ts(s.timestamp), kind: 'pulse', value: s.value });
  }
  for (const s of m.breathing?.upperTrace ?? []) {
    if (typeof s.value === 'number') events.push({ type: 'trace', t: ts(s.timestamp), kind: 'chest', value: s.value });
  }
  // Face detections: merge talking + blinking by timestamp into one face event.
  const face = new Map<number, { talking: boolean | null; blinking: boolean | null; landmarksReset: boolean }>();
  const slot = (t: number) => {
    let f = face.get(t);
    if (!f) face.set(t, (f = { talking: null, blinking: null, landmarksReset: false }));
    return f;
  };
  for (const d of m.face?.talking ?? []) slot(ts(d.timestamp)).talking = !!d.detected;
  for (const d of m.face?.blinking ?? []) slot(ts(d.timestamp)).blinking = !!d.detected;
  for (const l of m.face?.landmarks ?? []) {
    const t = ts(l.timestamp);
    if (l.reset) slot(t).landmarksReset = true;
    const points = (l.value ?? []).map((p) => ({ x: p.x ?? NaN, y: p.y ?? NaN }));
    if (points.length) landmarks.push({ t, points, reset: !!l.reset });
  }
  for (const [t, f] of [...face.entries()].sort((a, b) => a[0] - b[0])) events.push({ type: 'face', t, ...f });
  events.sort((a, b) => a.t - b.t);
  return { events, landmarks };
}

export { LandmarkFeatureTracker };
