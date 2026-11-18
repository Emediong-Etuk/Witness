import type { GateConfig, Metric, Receipt, RuleId } from '@witness/gate';
import type { Condition } from '@witness/schema';
import { isContaminated, quantile, replayTrace, round, type ClipTrace } from '@witness/bench-core';

export type { ClipTrace };

/** Methods fixed before any data is seen (BUILD_PROMPT §5.1). */
export const METHOD = {
  multiplier: 1.5,
  percentile: 0.99,
  liveFloorPercentile: 0.01,
  minCleanReadings: 30,
  caps: { autocorrPeak: 0.98, bandRatio: 0.95, nonOkShare: 0.1, episodeMs: 2000 },
  floors: { nonOkShare: 0.03, episodeMs: 500, talkingS: 1 },
  cleanConditions: ['baseline', 'paced_breathing'] as Condition[],
};

const TARGETS: Partial<Record<RuleId, Condition[]>> = {
  R6_STILL: ['motion'],
  R7_QUIET: ['talking'],
  R9_STEADY_LIGHT: ['flicker', 'tv_light', 'generator_light'],
  R10_NO_CHEWING: ['chewing'],
  R11_LIVE_FACE: ['photo'],
};

type Obs = Record<string, unknown> | number | null;
const obs = (r: Receipt, id: RuleId): Obs => (r.checks.find((c) => c.id === id)?.observed as Obs) ?? null;
const num = (o: Obs, k?: string): number | null => {
  const v = k ? (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : null) : o;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

interface Reading {
  clip: string;
  metric: Metric;
  receipt: Receipt;
  contaminated: Condition[];
}

/** Stable SDK readings whose window is fully elapsed, labelled clean/contaminated from the manifest. */
export function readings(traces: ClipTrace[], cfg: GateConfig): Reading[] {
  const out: Reading[] = [];
  for (const t of traces) {
    const rep = replayTrace(t.lines, cfg);
    for (const r of rep.receipts) {
      if (!r.sdk.stable) continue;
      if (!r.checks.find((c) => c.id === 'R1_WARMUP')?.pass) continue;
      const c = isContaminated(t.clip, r.metric, r.window.startUs / 1e6, r.window.endUs / 1e6);
      out.push({ clip: t.clip.id, metric: r.metric, receipt: r, contaminated: c.conditions });
    }
  }
  return out;
}

export interface CalibrationResult {
  config: GateConfig;
  calibratedKeys: string[];
  uncalibratedKeys: { key: string; reason: string }[];
  stats: Record<string, { n: number; p01?: number | null; p99?: number | null; proposed: number | null }>;
  curves: { rule: RuleId; field: string; points: { threshold: number; cleanRejectRate: number | null; targetDetectRate: number | null; nClean: number; nTarget: number }[] }[];
}

export function calibrate(traces: ClipTrace[], base: GateConfig, now = new Date()): CalibrationResult {
  const cal = traces.filter((t) => t.clip.split === 'calibration');
  if (traces.some((t) => t.clip.split !== 'calibration')) throw new Error('calibrate() was given held-out clips; it must only see the calibration split');
  const all = readings(cal, base);
  const cleanClipIds = new Set(cal.filter((t) => METHOD.cleanConditions.includes(t.clip.condition)).map((t) => t.clip.id));
  const clean = all.filter((r) => cleanClipIds.has(r.clip) && r.contaminated.length === 0);
  const cfg: GateConfig = JSON.parse(JSON.stringify(base));
  const stats: CalibrationResult['stats'] = {};
  const calibrated: string[] = [];
  const uncal: CalibrationResult['uncalibratedKeys'] = [];

  const p = (xs: number[], q: number) => (xs.length ? quantile(xs, q) : null);
  const propose = (key: string, values: number[], f: (p99: number | null, p01: number | null) => number | null, apply: (v: number) => void) => {
    const p99 = p(values, METHOD.percentile);
    const p01 = p(values, METHOD.liveFloorPercentile);
    const v = values.length >= METHOD.minCleanReadings ? f(p99, p01) : null;
    stats[key] = { n: values.length, p01: round(p01, 6), p99: round(p99, 6), proposed: round(v, 6) };
    if (v === null) uncal.push({ key, reason: `only ${values.length} clean readings (need ${METHOD.minCleanReadings})` });
    else {
      apply(v);
      calibrated.push(key);
    }
  };
  const vals = (rs: Reading[], id: RuleId, k?: string) => rs.map((r) => num(obs(r.receipt, id), k)).filter((x): x is number => x !== null);
  const M = METHOD.multiplier;

  propose('still.maxRms', vals(clean, 'R6_STILL'), (p99) => (p99 === null ? null : p99 * M), (v) => (cfg.still.maxRms = v));
  for (const m of ['pulse', 'breathing', 'hrv'] as Metric[]) {
    propose(`steadyLight.maxBandRatio.${m}`, vals(clean.filter((r) => r.metric === m), 'R9_STEADY_LIGHT', 'bandRatio'),
      (p99) => (p99 === null ? null : Math.min(METHOD.caps.bandRatio, p99 * M)), (v) => (cfg.steadyLight.maxBandRatio[m] = v));
  }
  propose('steadyLight.maxCoincidentSnr', vals(clean, 'R9_STEADY_LIGHT', 'coincidentSnr'), (p99) => (p99 === null ? null : p99 * M), (v) => (cfg.steadyLight.maxCoincidentSnr = v));
  propose('chewing.maxPeak', vals(clean.filter((r) => r.metric !== 'breathing'), 'R10_NO_CHEWING', 'autocorrPeak'),
    (p99) => (p99 === null ? null : Math.min(METHOD.caps.autocorrPeak, p99 * M)), (v) => (cfg.chewing.maxPeak = v));
  propose('liveFace.minMeanMotion', vals(clean, 'R11_LIVE_FACE', 'meanMotion'), (_p99, p01) => p01, (v) => (cfg.liveFace.minMeanMotion = v));
  propose('validation.maxNonOkShare', vals(clean, 'R4_VALIDATION_CLEAN', 'nonOkShare'),
    (p99) => (p99 === null ? null : Math.min(METHOD.caps.nonOkShare, Math.max(METHOD.floors.nonOkShare, p99 * M))), (v) => (cfg.validation.maxNonOkShare = v));
  propose('validation.maxEpisodeMs', vals(clean, 'R4_VALIDATION_CLEAN', 'longestEpisodeMs'),
    (p99) => (p99 === null ? null : Math.min(METHOD.caps.episodeMs, Math.max(METHOD.floors.episodeMs, p99 * M))), (v) => (cfg.validation.maxEpisodeMs = v));
  propose('quiet.maxTalkingS', vals(clean.filter((r) => r.metric === 'breathing'), 'R7_QUIET', 'talkingS'),
    (p99) => (p99 === null ? null : Math.max(METHOD.floors.talkingS, p99 * M)), (v) => (cfg.quiet.maxTalkingS = v));

  // FAR/FRR curves on the calibration split: clean rejection vs target-condition detection.
  const curves: CalibrationResult['curves'] = [];
  const curve = (rule: RuleId, field: string | undefined, fails: (x: number, thr: number) => boolean, base: number | null, metrics?: Metric[]) => {
    if (base === null || !Number.isFinite(base)) return;
    const inM = (r: Reading) => !metrics || metrics.includes(r.metric);
    const c = clean.filter(inM).map((r) => num(obs(r.receipt, rule), field)).filter((x): x is number => x !== null);
    const targets = TARGETS[rule] ?? [];
    const tg = all.filter((r) => inM(r) && r.contaminated.some((k) => targets.includes(k))).map((r) => num(obs(r.receipt, rule), field)).filter((x): x is number => x !== null);
    const points = [0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((f) => {
      const thr = base * f;
      return {
        threshold: round(thr, 6)!,
        cleanRejectRate: c.length ? round(c.filter((x) => fails(x, thr)).length / c.length) : null,
        targetDetectRate: tg.length ? round(tg.filter((x) => fails(x, thr)).length / tg.length) : null,
        nClean: c.length,
        nTarget: tg.length,
      };
    });
    curves.push({ rule, field: field ?? 'value', points });
  };
  const gt = (x: number, t: number) => x > t;
  curve('R6_STILL', undefined, gt, stats['still.maxRms']?.p99 ?? null);
  curve('R9_STEADY_LIGHT', 'coincidentSnr', gt, stats['steadyLight.maxCoincidentSnr']?.p99 ?? null, ['pulse', 'hrv']);
  curve('R9_STEADY_LIGHT', 'bandRatio', (x, t) => x >= t, stats['steadyLight.maxBandRatio.pulse']?.p99 ?? null, ['pulse']);
  curve('R10_NO_CHEWING', 'autocorrPeak', gt, stats['chewing.maxPeak']?.p99 ?? null, ['pulse', 'hrv']);
  curve('R11_LIVE_FACE', 'meanMotion', (x, t) => x < t, stats['liveFace.minMeanMotion']?.p01 ?? null);
  curve('R7_QUIET', 'talkingS', (x, t) => x >= t, Math.max(METHOD.floors.talkingS, stats['quiet.maxTalkingS']?.p99 ?? 0), ['breathing']);

  cfg.calibration = {
    status: uncal.length === 0 ? 'CALIBRATED' : calibrated.length ? 'PARTIALLY_CALIBRATED' : 'UNCALIBRATED',
    note: 'Thresholds computed by `npm run bench:calibrate` from the calibration split only (p99 × 1.5 of clean baseline readings; live-motion floor at p1). Frozen at tag m4-thresholds-frozen before the held-out run.',
    calibratedKeys: calibrated,
    uncalibratedKeys: uncal.map((u) => u.key),
    at: now.toISOString(),
    method: METHOD,
    clips: cal.map((t) => ({ id: t.clip.id, condition: t.clip.condition, traceSha256: t.traceSha256 })),
    cleanReadings: clean.length,
  };
  return { config: cfg, calibratedKeys: calibrated, uncalibratedKeys: uncal, stats, curves };
}
