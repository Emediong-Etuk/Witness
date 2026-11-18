import type { Metric } from '@witness/gate';

/**
 * The one event vocabulary the app sees, whatever the source. Times are
 * session-clock µs (0 = session start). Contains no frames, images, landmark
 * coordinates or expressions, so a trace of these is safe to store and publish.
 */
export type SourceEvent =
  | { type: 'status'; t: number; status: number }
  | { type: 'validation'; t: number; code: number; hint: string }
  | { type: 'rate'; t: number; metric: Metric; value: number; confidence: number; stable: boolean }
  | { type: 'face'; t: number; talking: boolean | null; blinking: boolean | null; landmarksReset: boolean }
  | { type: 'face_feature'; t: number; motion: number | null; mouth: number | null; jaw: number | null }
  | { type: 'frame'; t: number; bg: [number, number]; chest: number | null; face: number | null }
  /** Display-only waveforms (arterial pressure trace, chest breathing trace). Never gated. */
  | { type: 'trace'; t: number; kind: 'pulse' | 'chest'; value: number }
  | { type: 'error'; t: number; code: number; message: string; retryable: boolean }
  | { type: 'end'; t: number };

export interface TraceHeader {
  type: 'header';
  v: 1;
  /** `synthetic:<scenario>` for generated demo data, `corpus:<clipId>` for bench recordings. */
  source: string;
  synthetic: boolean;
  sdkVersion: string;
  mode: 'quick' | 'full';
  note?: string;
  /** Recording metadata (bench): clip hash, frames sent/dropped, timestamp passthrough check… */
  meta?: Record<string, unknown>;
}

export type TraceLine = TraceHeader | SourceEvent;

/** ProcessingStatus values (stable across SDK versions per its .d.ts). */
export const Status = { uninitialized: 0, idle: 1, starting: 2, running: 3, stopping: 4, error: 5 } as const;

/** ValidationCode values (SDK .d.ts). */
export const Code = {
  ok: 0, noFace: 1, multipleFaces: 2, faceNotCentered: 3, faceSizeOutOfRange: 4, tooDark: 5, tooBright: 6,
  chestNotVisible: 7, cameraTuning: 10, frameRateTooLow: 11, excessiveMotion: 12, faceTooClose: 13,
  faceTooFar: 14, faceTooHigh: 15, faceTooLow: 16, faceNotForward: 17,
} as const;

/** SmartSpectraErrorCode values (SDK .d.ts). */
export const ErrorCode = {
  ok: 0, invalidState: 1, authenticationFailed: 2, configurationFailed: 3, creditExhausted: 4, networkError: 5,
  serverError: 6, inputUnavailable: 7, processingFailed: 8, frameConversionFailed: 9, nonMonotonicTimestamp: 10,
  timestampGap: 11, metricNotAuthorized: 13, sustainedLowFrameRate: 14,
} as const;

/** MetricType codes we request (never EXPRESSIONS=14 or EDA_TRACE=10). */
export const MetricType = {
  CHEST_BREATHING: 0, ABDOMEN_BREATHING: 1, BREATHING_RATE: 2, FACE_LANDMARKS: 11, BLINKING: 12, TALKING: 13,
  PULSE_RATE: 15, ARTERIAL_PRESSURE_TRACE: 16, HRV: 17,
} as const;

export function requestedMetrics(mode: 'quick' | 'full'): number[] {
  const face = [MetricType.FACE_LANDMARKS, MetricType.BLINKING, MetricType.TALKING];
  const cardio = [MetricType.PULSE_RATE, MetricType.ARTERIAL_PRESSURE_TRACE, MetricType.HRV];
  const breathing = [MetricType.CHEST_BREATHING, MetricType.ABDOMEN_BREATHING, MetricType.BREATHING_RATE];
  return mode === 'quick' ? [...cardio, ...face] : [...breathing, ...cardio, ...face];
}

export function metricsFor(mode: 'quick' | 'full'): Metric[] {
  return mode === 'quick' ? ['pulse'] : ['pulse', 'breathing', 'hrv'];
}
