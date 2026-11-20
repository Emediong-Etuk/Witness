import { describe, expect, it } from 'vitest';
import {
  buildReport, decodeTrace, encodeReceipts, encodeTrace, EGRESS_MARKERS, fillMarkers, renderEgress, replayTrace, TBD_TEXT, type FreezeStatus,
} from '@witness/bench-core';
import { configHash, GATE_V1, type GateConfig } from '@witness/gate';
import type { ManifestClip } from '@witness/schema';
import { syntheticTrace, type Scenario } from '@witness/sdk-adapter';
import { verifyAll, verifyCheckins, type VerifyInput } from '../src/index.js';

const FREEZE: FreezeStatus = { frozen: true, reason: 'ok', tag: 'm4-thresholds-frozen', tagCommit: 'a'.repeat(40), head: 'b'.repeat(40) };
const DOC = `Headline: <!-- bench:overall.sdkFalseTrust|ci-pct -->X<!-- /bench --> over <!-- bench:clips.length|int -->X<!-- /bench --> clips; FRR <!-- bench:overall.witnessFRR|pct -->X<!-- /bench -->.\n`;

function clip(id: string, condition: ManifestClip['condition'], split: ManifestClip['split'], extra: Partial<ManifestClip> = {}): ManifestClip {
  return {
    id, title: id, condition, split, file: `${id}.mp4`, intervals: [], wholeClip: false,
    groundTruth: { device: 'test', pulse: [{ tS: 0, bpm: 68 }, { tS: 90, bpm: 68 }] },
    consent: { attested: true, subject: 'S1', at: '2026-11-18T12:00:00.000Z', publishVideo: false },
    subject: { fitzpatrick: null }, camera: 'test', lighting: 'test', resolution: '320x180', sha256: { clip: null, trace: null }, ...extra,
  };
}

/** A complete, internally consistent corpus built from labelled SYNTHETIC traces (tests only: allowSynthetic). */
function fixture(cfg: GateConfig = GATE_V1, withResults = true): VerifyInput {
  const spec: [ManifestClip, Scenario, number][] = [
    [clip('B1', 'baseline', 'calibration'), 'clean', 1],
    [clip('B2', 'baseline', 'heldout'), 'clean', 2],
    [clip('T2', 'talking', 'heldout', { intervals: [{ condition: 'talking', fromS: 35, toS: 50 }] }), 'talking', 3],
  ];
  const traces: Record<string, string> = {};
  const receipts: Record<string, string> = {};
  const held = [];
  for (const [c, s, seed] of spec) {
    // Like the real pipeline: receipts and results are computed from the published (decoded) trace,
    // whose floats are canonicalised to 6 decimals, never from in-memory lines.
    const e = encodeTrace(syntheticTrace(s, { mode: 'full', seed, durS: 55 }));
    const lines = decodeTrace(e.text).lines;
    c.sha256.trace = e.sha256;
    traces[c.id] = e.text;
    const rep = replayTrace(lines, cfg);
    receipts[c.id] = encodeReceipts({ type: 'receipts_header', v: 1, clipId: c.id, traceSha256: e.sha256, gateVersion: cfg.version, gateConfigHash: configHash(cfg), count: rep.receipts.length, chainHead: rep.chainHead }, rep.receipts);
    if (c.split === 'heldout') held.push({ clip: c, lines, traceSha256: e.sha256 });
  }
  const results = withResults ? buildReport({ traces: held, cfg, freeze: FREEZE, gitHead: 'c'.repeat(40) }) : null;
  return {
    gateConfig: cfg,
    manifestText: JSON.stringify({ v: 1, clips: spec.map((x) => x[0]) }),
    traces, receipts,
    resultsText: results ? JSON.stringify(results) : null,
    docs: { 'README.md': fillMarkers(DOC, results) },
    egress: { runs: {}, doc: `# Egress\n${EGRESS_MARKERS[0]}\n${renderEgress([])}${EGRESS_MARKERS[1]}\n` },
    git: { freeze: FREEZE, heldoutTagCommit: 'd'.repeat(40), frozenBeforeHeldout: true },
    allowSynthetic: true,
  };
}

const fails = (inp: VerifyInput) => verifyAll(inp).checks.filter((c) => c.status === 'fail');

describe('verifyAll', { timeout: 60_000 }, () => {
  const good = fixture();
  it('passes on a consistent corpus and says so', () => {
    const r = verifyAll(good);
    expect(r.checks.filter((c) => c.status === 'fail')).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.counts.traces).toBe(3);
    expect(r.counts.receiptsMatched).toBe(r.counts.receipts);
    expect(r.counts.receipts).toBeGreaterThan(100);
    expect(r.counts.markers).toBe(3);
    expect(r.summary).toMatch(/all \d+ receipts recomputed and matched/);
  });
  it('rejects synthetic/stub traces unless explicitly allowed (tests only)', () => {
    const f = fails({ ...good, allowSynthetic: false });
    expect(f.some((c) => c.id === 'trace.B1.source')).toBe(true);
    expect(f.some((c) => c.id === 'results' && /synthetic/.test(c.detail))).toBe(true);
  });
  it('detects a tampered trace line (hash chain)', () => {
    const t = good.traces.B2!.replace('"status":3', '"status":4');
    expect(fails({ ...good, traces: { ...good.traces, B2: t } }).map((c) => c.id)).toContain('trace.B2.chain');
  });
  it('detects a trace that is not the one pinned in the manifest', () => {
    const m = JSON.parse(good.manifestText!);
    m.clips[0].sha256.trace = 'sha256:' + 'f'.repeat(64);
    expect(fails({ ...good, manifestText: JSON.stringify(m) }).map((c) => c.id)).toContain('trace.B1.pinned');
  });
  it('detects a tampered stored receipt', () => {
    const lines = good.receipts.T2!.split('\n');
    lines[20] = lines[20]!.replace(/"verdict":"[A-Z_]+"/, '"verdict":"VERIFIED"').replace(/"value":[0-9.]+/, '"value":99');
    const f = fails({ ...good, receipts: { ...good.receipts, T2: lines.join('\n') } });
    expect(f.find((c) => c.id === 'receipts.T2')!.detail).toMatch(/fails its own hash|differs/);
  });
  it('detects a changed threshold (receipts and results no longer recompute)', () => {
    const cfg = { ...GATE_V1, still: { ...GATE_V1.still, maxRms: 0.02 } };
    const ids = fails({ ...good, gateConfig: cfg }).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['receipts.B1', 'receipts.B2', 'receipts.T2', 'results']));
  });
  it('detects an edited result number', () => {
    const r = JSON.parse(good.resultsText!);
    r.overall.witnessFRR.value = 0.001;
    const f = fails({ ...good, resultsText: JSON.stringify(r) });
    expect(f.find((c) => c.id === 'results')!.detail).toMatch(/overall\.witnessFRR\.value/);
  });
  it('detects a hand-edited number in a doc', () => {
    const doc = good.docs['README.md']!.replace(/(witnessFRR\|pct -->)[^<]+/, '$112.3%');
    expect(fails({ ...good, docs: { 'README.md': doc } }).map((c) => c.id)).toContain('docs.README.md');
  });
  it('without results, every embedded number must be the TBD placeholder', () => {
    const noRes = fixture(GATE_V1, false);
    expect(fails(noRes)).toEqual([]);
    expect(noRes.docs['README.md']).toContain(TBD_TEXT);
    const typed = noRes.docs['README.md']!.replace(TBD_TEXT, '42%');
    expect(fails({ ...noRes, docs: { 'README.md': typed } }).map((c) => c.id)).toContain('docs.README.md');
  });
  it('unknown marker paths fail', () => {
    const doc = good.docs['README.md'] + '<!-- bench:overall.madeUp|pct -->1%<!-- /bench -->';
    expect(fails({ ...good, docs: { 'README.md': doc } })[0]!.detail).toMatch(/no such value/);
  });
  it('results from unfrozen thresholds, or frozen after the held-out run, fail', () => {
    const r = JSON.parse(good.resultsText!);
    r.freeze = { ...r.freeze, frozen: false, reason: 'tag missing' };
    expect(fails({ ...good, resultsText: JSON.stringify(r) }).some((c) => c.id === 'results' && /not frozen/.test(c.detail))).toBe(true);
    const g = { ...good.git!, frozenBeforeHeldout: false };
    expect(fails({ ...good, git: g }).map((c) => c.id)).toContain('git.freeze');
  });
  it('a trace for an unlisted clip, a missing pinned trace and a missing receipts file all fail', () => {
    expect(fails({ ...good, traces: { ...good.traces, Z9: good.traces.B1! } }).map((c) => c.id)).toContain('trace.Z9');
    const { B2: _b, ...rest } = good.traces;
    expect(fails({ ...good, traces: rest }).map((c) => c.id)).toContain('trace.B2');
    const { T2: _t, ...rr } = good.receipts;
    expect(fails({ ...good, receipts: rr }).map((c) => c.id)).toContain('receipts.T2');
  });
  it('a CRLF checkout of EGRESS.md (Windows) still matches', () => {
    const doc = good.egress!.doc!.replace(/\n/g, '\r\n');
    const r = verifyAll({ ...good, egress: { ...good.egress!, doc } });
    expect(r.checks.find((c) => c.id === 'docs.EGRESS.md')?.status).toBe('pass');
  });
  it('a hand-edited egress table fails', () => {
    const doc = good.egress!.doc!.replace('_No audit runs yet._', '_Nothing leaves your device._');
    expect(fails({ ...good, egress: { runs: {}, doc } }).map((c) => c.id)).toContain('docs.EGRESS.md');
  });
  it('reports progress', () => {
    const seen: string[] = [];
    verifyAll({ ...good, onProgress: (_d, _t, label) => seen.push(label) });
    expect(seen).toEqual(['B1', 'B2', 'T2', 'results']);
  });
});

describe('verifyCheckins (exported check-ins)', () => {
  const lines = syntheticTrace('clean', { mode: 'quick', durS: 20 });
  const rep = replayTrace(lines, GATE_V1);
  const v = rep.receipts.filter((r) => r.verdict === 'VERIFIED').at(-1)!;
  const exp = { checkins: [{ id: 'ses_x', results: [{ metric: 'pulse', value: v.value, receipt: v }] }] };
  it('passes an intact export', () => {
    const r = verifyCheckins(JSON.stringify(exp), [GATE_V1]);
    expect(r.ok).toBe(true);
    expect(r.summary).toMatch(/all 1 receipts are intact/);
  });
  it('fails a changed value, a forged verdict and an unknown config', () => {
    const bump = structuredClone(exp);
    bump.checkins[0]!.results[0]!.value = v.value + 5;
    expect(verifyCheckins(JSON.stringify(bump), [GATE_V1]).checks[0]!.detail).toMatch(/shown value/);
    const forged = structuredClone(exp);
    forged.checkins[0]!.results[0]!.receipt.value = 99;
    expect(verifyCheckins(JSON.stringify(forged), [GATE_V1]).checks[0]!.detail).toMatch(/hash does not match/);
    const other = { ...GATE_V1, version: '9.9.9' };
    expect(verifyCheckins(JSON.stringify(exp), [other]).checks[0]!.detail).toMatch(/not a published Witness config/);
    expect(verifyCheckins('nope', [GATE_V1]).ok).toBe(false);
  });
});
