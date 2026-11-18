import type { Metric, RuleId } from './types.js';
import { canonical, sha256Hex } from './canonical.js';
import v1 from '../config/gate.v1.json' with { type: 'json' };

type PerMetric<T> = Record<Metric, T>;

export interface GateConfig {
  version: string;
  calibration: { status: string; note?: string; calibratedKeys: string[]; [k: string]: unknown };
  windowsS: PerMetric<number>;
  minEvidenceHz: number;
  sdkConfidenceMin: PerMetric<number>;
  range: { pulse: [number, number]; breathing: [number, number]; hrvPulse: [number, number] };
  validation: { maxNonOkShare: number; maxEpisodeMs: number; unknownCountsAsNonOk: boolean; faceCountCodes: number[] };
  still: { rmsWindowS: number; maxRms: number };
  quiet: { maxTalkingS: number };
  frameRate: { minFps: number; binS: number };
  steadyLight: {
    fs: number;
    fullBandHz: [number, number];
    bandHz: PerMetric<[number, number]>;
    tolHz: PerMetric<number>;
    segS: PerMetric<number>;
    maxBandRatio: PerMetric<number>;
    maxCoincidentSnr: number;
  };
  chewing: { fs: number; winS: number; hopS: number; loHz: number; hiHz: number; sustain: number; maxPeak: number };
  liveFace: { blinkWindowS: number; minBlinks: number; minMeanMotion: number };
  appliesTo: Record<RuleId, Metric[]>;
  reasonOrder: RuleId[];
}

export const GATE_V1 = v1 as unknown as GateConfig;

export function configHash(cfg: GateConfig): string {
  return sha256Hex(canonical(cfg));
}
