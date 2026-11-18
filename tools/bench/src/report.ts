import { configHash, type GateConfig, type Metric, type Receipt, type RuleId } from '@witness/gate';
import type { Condition, ManifestClip } from '@witness/schema';
import type { ClipTrace } from './calibrate.js';
import type { FreezeStatus } from './git.js';
import { isContaminated } from './manifest.js';
import { replayTrace } from './replay.js';
import { clusterBootstrap, mae, mean, quantile, round, share, type Ci } from './stats.js';

export const DEFINITIONS = {
  reading: 'An SDK rate sample (pulse rate, breathing rate or HRV RMSSD) with stable === true.',
  contaminated:
    "The reading's analysis window overlaps a labelled condition interval, or the clip is a whole-clip condition, where the condition is documented to invalidate that metric (tools/bench/src/manifest.ts CONTAMINATES).",
  clean: 'A reading that is not contaminated.',
  sdkFalseTrust: 'contaminated readings / all readings.',
  witnessFAR: 'contaminated readings that Witness VERIFIED / contaminated readings.',
  witnessFRR: 'clean readings that Witness WITHHELD / clean readings.',
  accuracy:
    'Absolute error of the reported value vs the mean ground truth over the same window (fingertip oximeter for pulse; oximeter-free paced-breathing rate or logged breathing for breathing). Share within ±3 bpm (pulse) / ±1 br/min (breathing).',
  ci: '95% cluster-bootstrap interval resampling whole clips (2000 resamples, fixed seed). The corpus is small, so intervals are wide.',
  timeToFirstVerified: 'Seconds from session start to the first VERIFIED receipt per metric, on clean (baseline/paced-breathing) clips.',
  coverage: 'Share of clean-clip seconds (after the first window could have filled) during which a VERIFIED value no older than 30 s is on screen.',
};

const WITHIN: Partial<Record<Metric, number>> = { pulse: 3, breathing: 1 };
const METRICS: Metric[] = ['pulse', 'breathing', 'hrv'];

interface Row {
  clip: ManifestClip;
  metric: Metric;
  r: Receipt;
  contaminated: Condition[];
  gt: number | null;
}

/** Mean ground truth over [fromS, toS], linearly interpolated between logged points. */
export function groundTruth(clip: ManifestClip, metric: Metric, fromS: number, toS: number): number | null {
  if (metric === 'hrv') return null;
  if (metric === 'breathing' && clip.pacedBreathingBrpm && !clip.groundTruth?.breathing?.length) return clip.pacedBreathingBrpm;
  const pts = metric === 'pulse' ? clip.groundTruth?.pulse.map((p) => ({ tS: p.tS, v: p.bpm })) : clip.groundTruth?.breathing?.map((p) => ({ tS: p.tS, v: p.brpm }));
  if (!pts || pts.length === 0) return null;
  pts.sort((a, b) => a.tS - b.tS);
  if (toS < pts[0]!.tS - 5 || fromS > pts[pts.length - 1]!.tS + 5) return null;
  const at = (t: number) => {
    if (t <= pts[0]!.tS) return pts[0]!.v;
    for (let i = 1; i < pts.length; i++) if (t <= pts[i]!.tS) {
      const a = pts[i - 1]!, b = pts[i]!;
      return a.v + ((b.v - a.v) * (t - a.tS)) / (b.tS - a.tS || 1);
    }
    return pts[pts.length - 1]!.v;
  };
  const xs: number[] = [];
  for (let t = fromS; t <= toS + 1e-9; t += 0.5) xs.push(at(t));
  return mean(xs);
}

export interface ReportInput {
  traces: ClipTrace[];
  cfg: GateConfig;
  freeze: FreezeStatus;
  gitHead: string | null;
}

export function buildReport({ traces, cfg, freeze, gitHead }: ReportInput) {
  const held = traces.filter((t) => t.clip.split === 'heldout');
  if (traces.some((t) => t.clip.split !== 'heldout')) throw new Error('report must only see the held-out split');
  const perClip = held.map((t) => ({ t, rep: replayTrace(t.lines, cfg) }));
  const rows: Row[] = [];
  for (const { t, rep } of perClip) {
    for (const r of rep.receipts) {
      if (!r.sdk.stable) continue;
      const fromS = r.window.startUs / 1e6, toS = r.window.endUs / 1e6;
      rows.push({ clip: t.clip, metric: r.metric, r, contaminated: isContaminated(t.clip, r.metric, fromS, toS).conditions, gt: groundTruth(t.clip, r.metric, Math.max(0, fromS), toS) });
    }
  }
  const byClip = (rs: Row[]) => held.map((t) => rs.filter((x) => x.clip.id === t.clip.id));
  const ci = (rs: Row[], f: (xs: Row[]) => number | null): Ci => clusterBootstrap(byClip(rs), f);
  const rate = (pred: (x: Row) => boolean) => (xs: Row[]) => share(xs.map(pred));

  const scope = (rs: Row[]) => {
    const cont = rs.filter((x) => x.contaminated.length);
    const clean = rs.filter((x) => !x.contaminated.length);
    return {
      readings: rs.length,
      contaminated: cont.length,
      clean: clean.length,
      sdkFalseTrust: ci(rs, rate((x) => x.contaminated.length > 0)),
      witnessFAR: ci(cont, rate((x) => x.r.verdict === 'VERIFIED')),
      witnessFRR: ci(clean, rate((x) => x.r.verdict === 'WITHHELD')),
      cleanVerified: ci(clean, rate((x) => x.r.verdict === 'VERIFIED')),
    };
  };

  const overall = scope(rows);
  const perMetric = Object.fromEntries(METRICS.map((m) => [m, scope(rows.filter((x) => x.metric === m))]));
  const conditions = [...new Set(rows.flatMap((x) => x.contaminated))].sort();
  const perCondition = Object.fromEntries(
    conditions.map((c) => {
      const rs = rows.filter((x) => x.contaminated.includes(c));
      return [c, { readings: rs.length, witnessFAR: ci(rs, rate((x) => x.r.verdict === 'VERIFIED')), byMetric: Object.fromEntries(METRICS.map((m) => [m, rs.filter((x) => x.metric === m).length])) }];
    }),
  );

  // accuracy vs ground truth
  const accuracy = Object.fromEntries(
    (['pulse', 'breathing'] as Metric[]).map((m) => {
      const withGt = rows.filter((x) => x.metric === m && x.gt !== null);
      const groups = {
        sdkStableClean: withGt.filter((x) => !x.contaminated.length),
        sdkStableContaminated: withGt.filter((x) => x.contaminated.length),
        witnessVerified: withGt.filter((x) => x.r.verdict === 'VERIFIED'),
      };
      return [m, Object.fromEntries(Object.entries(groups).map(([k, g]) => [k, {
        mae: ci(g, (xs) => mae(xs.map((x) => x.r.value - x.gt!))),
        within: ci(g, rate((x) => Math.abs(x.r.value - x.gt!) <= WITHIN[m]!)),
      }]))];
    }),
  );

  // per-rule attribution: which rules fired on each condition's readings (and on clean readings)
  const ruleIds = [...new Set(rows.flatMap((x) => x.r.checks.map((c) => c.id)))].sort() as RuleId[];
  const fired = (rs: Row[]) => Object.fromEntries(ruleIds.map((id) => [id, rs.filter((x) => x.r.checks.some((c) => c.id === id && !c.pass)).length]));
  const attribution = {
    rules: ruleIds,
    clean: { n: rows.filter((x) => !x.contaminated.length).length, fired: fired(rows.filter((x) => !x.contaminated.length)) },
    byCondition: Object.fromEntries(conditions.map((c) => {
      const rs = rows.filter((x) => x.contaminated.includes(c));
      return [c, { n: rs.length, fired: fired(rs) }];
    })),
  };

  // friction: time to first verified + coverage on clean clips
  const cleanClips = perClip.filter(({ t }) => t.clip.condition === 'baseline' || t.clip.condition === 'paced_breathing');
  const friction = Object.fromEntries(METRICS.map((m) => {
    const firsts: number[] = [];
    const cov: number[] = [];
    for (const { rep } of cleanClips) {
      const rs = rep.receipts.filter((r) => r.metric === m);
      const v = rs.filter((r) => r.verdict === 'VERIFIED');
      if (v[0]) firsts.push(v[0].window.endUs / 1e6);
      const W = cfg.windowsS[m];
      const end = Math.floor(rep.durationS);
      let on = 0, total = 0;
      for (let s = Math.ceil(W); s <= end; s++) {
        total++;
        const last = [...v].reverse().find((r) => r.window.endUs / 1e6 <= s);
        if (last && s - last.window.endUs / 1e6 <= 30) on++;
      }
      if (total) cov.push(on / total);
    }
    return [m, {
      clips: cleanClips.length,
      verifiedIn: firsts.length,
      firstVerifiedS: { median: round(firsts.length ? quantile(firsts, 0.5) : null, 2), p90: round(firsts.length ? quantile(firsts, 0.9) : null, 2) },
      coverage: round(cov.length ? mean(cov) : null),
    }];
  }));

  // flicker hero metric: distance of the SDK pulse from the flicker rate, inside vs outside the flicker interval
  const flicker = held.filter((t) => t.clip.condition === 'flicker' && t.clip.flickerHz && t.clip.flickerHz * 60 >= 40).map((t) => {
    const rate = t.clip.flickerHz! * 60;
    const rs = rows.filter((x) => x.clip.id === t.clip.id && x.metric === 'pulse');
    const inside = rs.filter((x) => x.contaminated.includes('flicker'));
    const outside = rs.filter((x) => !x.contaminated.length);
    return {
      clip: t.clip.id,
      flickerPerMin: rate,
      meanDistanceInside: round(inside.length ? mean(inside.map((x) => Math.abs(x.r.value - rate))) : null, 2),
      meanDistanceOutside: round(outside.length ? mean(outside.map((x) => Math.abs(x.r.value - rate))) : null, 2),
      gtMaeInside: round(mae(inside.filter((x) => x.gt !== null).map((x) => x.r.value - x.gt!)), 2),
      witnessVerifiedInside: inside.filter((x) => x.r.verdict === 'VERIFIED').length,
      series: rs.map((x) => ({ tS: round(x.r.window.endUs / 1e6, 2), sdk: round(x.r.value, 2), gt: round(x.gt, 2), verdict: x.r.verdict })),
    };
  });

  return {
    v: 1,
    kind: 'witness-bench-results',
    gate: { version: cfg.version, configHash: configHash(cfg), calibration: cfg.calibration.status },
    freeze,
    gitHead,
    synthetic: held.some((t) => (t.lines[0] as { synthetic?: boolean }).synthetic),
    clips: held.map((t) => ({ id: t.clip.id, condition: t.clip.condition, traceSha256: t.traceSha256, sdkVersion: (t.lines.find((l) => l.type === 'header') as { sdkVersion?: string } | undefined)?.sdkVersion ?? null })),
    definitions: DEFINITIONS,
    overall,
    perMetric,
    perCondition,
    accuracy,
    attribution,
    friction,
    flicker,
  };
}

export type Results = ReturnType<typeof buildReport>;

const pct = (c: Ci) => (c.value === null ? 'n/a' : `${(c.value * 100).toFixed(1)}%${c.lo !== null ? ` [${(c.lo * 100).toFixed(1)}–${(c.hi! * 100).toFixed(1)}]` : ''}`);
const num = (c: Ci, d = 2) => (c.value === null ? 'n/a' : `${c.value.toFixed(d)}${c.lo !== null ? ` [${c.lo.toFixed(d)}–${c.hi!.toFixed(d)}]` : ''}`);

/** Markdown tables generated from results.json. Prose is never generated here. */
export function renderTables(r: Results): string {
  const L: string[] = [];
  L.push(`<!-- generated by npm run bench:report from bench/out/results.json; do not edit -->`);
  if (r.synthetic) L.push(`> **SYNTHETIC/STUB DATA — NOT A RESULT.**`);
  if (!r.freeze.frozen) L.push(`> **UNFROZEN THRESHOLDS (${r.freeze.reason}) — NOT A HELD-OUT RESULT.**`);
  L.push('', `Gate ${r.gate.version} · config \`${r.gate.configHash}\` · ${r.gate.calibration} · ${r.clips.length} held-out clips`, '');
  L.push('| Scope | Readings | Contaminated | SDK false-trust | Witness FAR | Witness FRR |', '| --- | --- | --- | --- | --- | --- |');
  const line = (name: string, s: Results['overall']) => L.push(`| ${name} | ${s.readings} | ${s.contaminated} | ${pct(s.sdkFalseTrust)} | ${pct(s.witnessFAR)} | ${pct(s.witnessFRR)} |`);
  line('All', r.overall);
  for (const [m, s] of Object.entries(r.perMetric)) line(m, s);
  L.push('', '| Condition | Contaminated readings | Witness FAR |', '| --- | --- | --- |');
  for (const [c, s] of Object.entries(r.perCondition)) L.push(`| ${c} | ${s.readings} | ${pct(s.witnessFAR)} |`);
  L.push('', '| Accuracy | Group | MAE | Within tolerance |', '| --- | --- | --- | --- |');
  for (const [m, g] of Object.entries(r.accuracy)) for (const [k, v] of Object.entries(g)) L.push(`| ${m} | ${k} (n=${v.mae.n}, clips=${v.mae.clusters}) | ${num(v.mae)} | ${pct(v.within)} |`);
  L.push('', `| Rule fired on → | n | ${r.attribution.rules.join(' | ')} |`, `| --- | --- | ${r.attribution.rules.map(() => '---').join(' | ')} |`);
  L.push(`| clean | ${r.attribution.clean.n} | ${r.attribution.rules.map((id) => r.attribution.clean.fired[id] ?? 0).join(' | ')} |`);
  for (const [c, a] of Object.entries(r.attribution.byCondition)) L.push(`| ${c} | ${a.n} | ${r.attribution.rules.map((id) => a.fired[id] ?? 0).join(' | ')} |`);
  L.push('', '| Metric | First verified (median / p90 s) | Coverage | Clean clips verified |', '| --- | --- | --- | --- |');
  for (const [m, f] of Object.entries(r.friction)) L.push(`| ${m} | ${f.firstVerifiedS.median ?? 'n/a'} / ${f.firstVerifiedS.p90 ?? 'n/a'} | ${f.coverage === null ? 'n/a' : (f.coverage * 100).toFixed(1) + '%'} | ${f.verifiedIn}/${f.clips} |`);
  if (r.flicker.length) {
    L.push('', '| Flicker clip | Rate (/min) | Mean |SDK − rate| inside | outside | GT MAE inside | Verified inside |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of r.flicker) L.push(`| ${f.clip} | ${f.flickerPerMin} | ${f.meanDistanceInside ?? 'n/a'} | ${f.meanDistanceOutside ?? 'n/a'} | ${f.gtMaeInside ?? 'n/a'} | ${f.witnessVerifiedInside} |`);
  }
  return L.join('\n') + '\n';
}
