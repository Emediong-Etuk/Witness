// A small, fully consistent DEMO corpus built from labelled synthetic traces,
// used only by the tamper playground. Verified with allowSynthetic: true,
// and never presented as results.
import { buildReport, decodeTrace, encodeReceipts, encodeTrace, EGRESS_MARKERS, fillMarkers, renderEgress, replayTrace, type FreezeStatus } from '@witness/bench-core';
import { configHash, type GateConfig } from '@witness/gate';
import type { ManifestClip } from '@witness/schema';
import { syntheticTrace, type Scenario } from '@witness/sdk-adapter';
import type { VerifyInput } from '@witness/verify';

export type Tamper = 'none' | 'trace' | 'receipt' | 'threshold' | 'doc' | 'result';
export const TAMPERS: { id: Tamper; label: string; expect: string }[] = [
  { id: 'none', label: 'Nothing (honest corpus)', expect: 'every check passes' },
  { id: 'trace', label: 'Edit one line of a recorded trace', expect: 'trace.B2.chain' },
  { id: 'receipt', label: 'Flip a stored receipt to VERIFIED', expect: 'receipts.T2' },
  { id: 'threshold', label: 'Quietly loosen the motion threshold', expect: 'receipts.* and results' },
  { id: 'doc', label: 'Type a nicer number into the README', expect: 'docs.README.md' },
  { id: 'result', label: 'Improve a number in results.json', expect: 'results' },
];

const FREEZE: FreezeStatus = { frozen: true, reason: 'demo', tag: 'm4-thresholds-frozen', tagCommit: 'demo'.padEnd(40, '0'), head: null };
const DOC = 'Withheld <!-- bench:overall.witnessWithheldContaminated|ci-pct -->X<!-- /bench --> of contaminated readings; false rejections <!-- bench:overall.witnessFRR|pct -->X<!-- /bench -->.\n';

function clip(id: string, condition: ManifestClip['condition'], split: ManifestClip['split'], intervals: ManifestClip['intervals'] = []): ManifestClip {
  return {
    id, title: `demo ${id}`, condition, split, file: `${id}.webm`, intervals, wholeClip: false,
    groundTruth: { device: 'demo', pulse: [{ tS: 0, bpm: 68 }, { tS: 90, bpm: 68 }] },
    consent: { attested: true, subject: 'S1', at: '2026-11-18T12:00:00.000Z', publishVideo: false },
    subject: { fitzpatrick: null }, camera: 'demo', lighting: 'demo', resolution: '1280x720', sha256: { clip: null, trace: null },
  };
}

export function demoCorpus(cfg: GateConfig, tamper: Tamper): VerifyInput {
  const spec: [ManifestClip, Scenario, number][] = [
    [clip('B1', 'baseline', 'calibration'), 'clean', 1],
    [clip('B2', 'baseline', 'heldout'), 'clean', 2],
    [clip('T2', 'talking', 'heldout', [{ condition: 'talking', fromS: 35, toS: 50 }]), 'talking', 3],
  ];
  const traces: Record<string, string> = {};
  const receipts: Record<string, string> = {};
  const held = [];
  for (const [c, s, seed] of spec) {
    const e = encodeTrace(syntheticTrace(s, { mode: 'full', seed, durS: 48 }));
    const lines = decodeTrace(e.text).lines;
    c.sha256.trace = e.sha256;
    traces[c.id] = e.text;
    const rep = replayTrace(lines, cfg);
    receipts[c.id] = encodeReceipts({ type: 'receipts_header', v: 1, clipId: c.id, traceSha256: e.sha256, gateVersion: cfg.version, gateConfigHash: configHash(cfg), count: rep.receipts.length, chainHead: rep.chainHead }, rep.receipts);
    if (c.split === 'heldout') held.push({ clip: c, lines, traceSha256: e.sha256 });
  }
  const results = buildReport({ traces: held, cfg, freeze: FREEZE, gitHead: null });
  let resultsText = JSON.stringify(results);
  let readme = fillMarkers(DOC, results);
  let gateConfig = cfg;
  switch (tamper) {
    case 'trace':
      traces.B2 = traces.B2!.replace('"status":3', '"status":4');
      break;
    case 'receipt': {
      const rows = receipts.T2!.split('\n');
      const i = rows.findIndex((r) => r.includes('"verdict":"WITHHELD"'));
      rows[i] = rows[i]!.replace('"verdict":"WITHHELD"', '"verdict":"VERIFIED"');
      receipts.T2 = rows.join('\n');
      break;
    }
    case 'threshold':
      gateConfig = { ...cfg, still: { ...cfg.still, maxRms: cfg.still.maxRms * 3 } };
      break;
    case 'doc':
      readme = readme.replace(/(witnessFRR\|pct -->)[^<]+/, '$10.0%').replace(/(witnessWithheldContaminated\|ci-pct -->)[^<]+/, '$199.9%');
      break;
    case 'result': {
      const r = JSON.parse(resultsText);
      r.overall.witnessFRR.value = 0;
      resultsText = JSON.stringify(r);
      break;
    }
  }
  return {
    gateConfig,
    manifestText: JSON.stringify({ v: 1, clips: spec.map((x) => x[0]) }),
    traces,
    receipts,
    resultsText,
    docs: { 'README.md': readme },
    egress: { runs: {}, doc: `${EGRESS_MARKERS[0]}\n${renderEgress([])}${EGRESS_MARKERS[1]}` },
    git: null,
    allowSynthetic: true,
  };
}
