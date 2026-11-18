export type Metric = 'pulse' | 'breathing' | 'hrv';

export const METRIC_UNIT: Record<Metric, string> = { pulse: 'bpm', breathing: 'br/min', hrv: 'ms' };

/**
 * Everything the gate looks at is a GateEvent on one session clock (µs).
 * No frames, no images, no landmark coordinates: only scalars derived in the
 * feature worker or values reported by the SDK.
 */
export type GateEvent =
  | { kind: 'session'; t: number; mode: 'quick' | 'full' }
  /** SDK ValidationStatus. Piecewise-constant: holds until the next validation event. */
  | { kind: 'validation'; t: number; code: number }
  /** SDK rate sample (pulse rate, breathing rate, HRV RMSSD). */
  | { kind: 'rate'; t: number; metric: Metric; value: number; confidence: number; stable: boolean }
  /** SDK talking state. Piecewise-constant. */
  | { kind: 'talking'; t: number; detected: boolean }
  /** SDK blink detection (true = a blink was detected at t). */
  | { kind: 'blink'; t: number; detected: boolean }
  /** SDK Landmarks.reset === true: face-track continuity broke. */
  | { kind: 'landmarks_reset'; t: number }
  /** Per SDK landmark packet, derived in-worker: rigid motion (IOD/frame), mouth aperture, jaw (IOD). */
  | { kind: 'face_feature'; t: number; motion: number | null; mouth: number | null; jaw: number | null }
  /** Per camera frame: ROI luminance. bg = two background patches. */
  | { kind: 'frame'; t: number; bg: [number, number]; chest: number | null; face: number | null };

export type GateEventKind = GateEvent['kind'];

export type SdkRateSample = Extract<GateEvent, { kind: 'rate' }>;

export type RuleId =
  | 'R1_WARMUP'
  | 'R2_SDK_STABLE'
  | 'R3_RANGE'
  | 'R4_VALIDATION_CLEAN'
  | 'R5_ONE_CONTINUOUS_FACE'
  | 'R6_STILL'
  | 'R7_QUIET'
  | 'R8_FRAME_RATE'
  | 'R9_STEADY_LIGHT'
  | 'R10_NO_CHEWING'
  | 'R11_LIVE_FACE';

export type Verdict = 'VERIFIED' | 'WARMING_UP' | 'OUT_OF_RANGE' | 'WITHHELD';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface Check {
  id: RuleId;
  pass: boolean;
  observed: Json;
  threshold: Json;
  unit?: string;
  /** Session-clock µs of the latest violating evidence (drives the UI countdown). */
  lastViolationUs?: number;
}

export interface Receipt {
  v: 1;
  sessionId: string;
  metric: Metric;
  value: number;
  unit: string;
  window: { startUs: number; endUs: number; lengthS: number };
  sdk: { confidence: number; stable: boolean; sdkVersion: string };
  checks: Check[];
  verdict: Verdict;
  reasons: RuleId[];
  gateVersion: string;
  gateConfigHash: string;
  inputsHash: string;
  prevReceiptHash: string;
  receiptHash: string;
}
