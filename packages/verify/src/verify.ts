import {
  buildReport, decodeReceipts, decodeTrace, EGRESS_MARKERS, extractBetween, findMarkers, getPath, renderEgress, renderValue,
  replayTrace, TBD_TEXT, type AuditResult, type ClipTrace, type FreezeStatus, type Results,
} from '@witness/bench-core';
import { canonical, configHash, decide, receiptHashOf, type GateConfig, type Receipt } from '@witness/gate';
import { ManifestSchema, ReceiptSchema, TraceLineSchema, type Manifest } from '@witness/schema';
import { firstDiff } from './diff.js';

export type Status = 'pass' | 'fail' | 'skip';
export interface Check {
  id: string;
  status: Status;
  detail: string;
}

export interface GitFacts {
  freeze: FreezeStatus;
  /** Commit of tag m5-heldout, if it exists. */
  heldoutTagCommit: string | null;
  /** Is m4-thresholds-frozen an ancestor of m5-heldout? null if m5 doesn't exist. */
  frozenBeforeHeldout: boolean | null;
}

export interface VerifyInput {
  gateConfig: GateConfig;
  manifestText: string | null;
  /** clipId → trace JSONL text */
  traces: Record<string, string>;
  /** clipId → stored receipts JSONL text */
  receipts: Record<string, string>;
  /** bench/out/results.json text, if present */
  resultsText: string | null;
  /** docs with bench markers: name → text */
  docs: Record<string, string>;
  /** egress: run files (name → JSON text) and docs/EGRESS.md text */
  egress?: { runs: Record<string, string>; doc: string | null };
  git?: GitFacts | null;
  /** Tests only: accept synthetic/stub traces. Never set by the CLI. */
  allowSynthetic?: boolean;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface VerifyReport {
  ok: boolean;
  checks: Check[];
  counts: { clips: number; traces: number; receipts: number; receiptsMatched: number; markers: number };
  summary: string;
}

/**
 * Recompute everything from the published inputs. No API key, no SDK, no
 * credits. Identical in Node and the browser.
 */
export function verifyAll(inp: VerifyInput): VerifyReport {
  const checks: Check[] = [];
  const add = (id: string, status: Status, detail: string) => checks.push({ id, status, detail });
  const counts = { clips: 0, traces: 0, receipts: 0, receiptsMatched: 0, markers: 0 };
  const cfgHash = configHash(inp.gateConfig);
  add('gate.config', 'pass', `gate ${inp.gateConfig.version} · ${inp.gateConfig.calibration.status} · ${cfgHash}`);

  // ---- manifest
  let manifest: Manifest | null = null;
  if (inp.manifestText === null) add('manifest', 'skip', 'no corpus/manifest.json');
  else {
    try {
      manifest = ManifestSchema.parse(JSON.parse(inp.manifestText));
      counts.clips = manifest.clips.length;
      add('manifest', 'pass', `${manifest.clips.length} clips, all with consent attestations`);
    } catch (e) {
      add('manifest', 'fail', `invalid manifest: ${(e as Error).message.slice(0, 300)}`);
    }
  }

  // ---- traces + receipts
  const decoded: ClipTrace[] = [];
  const listed = new Set(manifest?.clips.map((c) => c.id) ?? []);
  for (const id of Object.keys(inp.traces).sort()) if (!listed.has(id)) add(`trace.${id}`, 'fail', 'trace for a clip that is not in the manifest');
  const clips = manifest?.clips ?? [];
  clips.forEach((clip, i) => {
    inp.onProgress?.(i, clips.length, clip.id);
    const text = inp.traces[clip.id];
    if (text === undefined) {
      add(`trace.${clip.id}`, clip.sha256.trace ? 'fail' : 'skip', clip.sha256.trace ? 'manifest pins a trace but the file is missing' : 'not recorded yet');
      return;
    }
    counts.traces++;
    let t;
    try {
      t = decodeTrace(text, clip.id);
    } catch (e) {
      add(`trace.${clip.id}.chain`, 'fail', (e as Error).message);
      return;
    }
    add(`trace.${clip.id}.chain`, 'pass', `${t.lines.length} lines, head ${t.head.slice(0, 23)}…`);
    if (clip.sha256.trace !== t.sha256) add(`trace.${clip.id}.pinned`, 'fail', clip.sha256.trace ? `file ${t.sha256} ≠ manifest ${clip.sha256.trace}` : 'manifest does not pin this trace (sha256.trace is null)');
    else add(`trace.${clip.id}.pinned`, 'pass', t.sha256);
    const bad = t.lines.findIndex((l) => !TraceLineSchema.safeParse(l).success);
    add(`trace.${clip.id}.schema`, bad < 0 ? 'pass' : 'fail', bad < 0 ? 'every line valid; no coordinates, frames or expressions' : `line ${bad + 1} is not a valid trace line (${t.lines[bad]?.type ?? '?'})`);
    const header = t.lines.find((l) => l.type === 'header') as { synthetic?: boolean; source?: string } | undefined;
    const real = !!header && header.synthetic === false && header.source === `corpus:${clip.id}`;
    if (!real && !inp.allowSynthetic) {
      add(`trace.${clip.id}.source`, 'fail', `header source ${header?.source ?? '?'} (synthetic=${header?.synthetic}): only corpus:${clip.id} recordings may be in the corpus`);
      return;
    }
    add(`trace.${clip.id}.source`, 'pass', header?.source ?? '');
    decoded.push({ clip, lines: t.lines, traceSha256: t.sha256 });

    // receipts
    const rtext = inp.receipts[clip.id];
    const rep = replayTrace(t.lines, inp.gateConfig);
    counts.receipts += rep.receipts.length;
    if (rtext === undefined) {
      add(`receipts.${clip.id}`, 'fail', 'no stored receipts (run npm run bench:replay -- --write)');
      return;
    }
    let stored: { header: { traceSha256: string; gateConfigHash: string; count: number; chainHead: string }; receipts: Receipt[] };
    try {
      stored = decodeReceipts(rtext);
    } catch (e) {
      add(`receipts.${clip.id}`, 'fail', (e as Error).message);
      return;
    }
    const problems: string[] = [];
    if (stored.header.traceSha256 !== t.sha256) problems.push('receipts were computed from a different trace');
    if (stored.header.gateConfigHash !== cfgHash) problems.push(`receipts use gate config ${stored.header.gateConfigHash}, current is ${cfgHash}`);
    const selfBad = stored.receipts.findIndex((r, k) => receiptHashOf(r) !== r.receiptHash || (k > 0 && r.prevReceiptHash !== stored.receipts[k - 1]!.receiptHash));
    if (selfBad >= 0) problems.push(`stored receipt ${selfBad} fails its own hash or chain link`);
    if (stored.receipts.length !== rep.receipts.length) problems.push(`${stored.receipts.length} stored vs ${rep.receipts.length} recomputed`);
    let matched = 0;
    for (let k = 0; k < Math.min(stored.receipts.length, rep.receipts.length); k++) {
      if (canonical(stored.receipts[k]) === canonical(rep.receipts[k])) matched++;
      else {
        problems.push(`receipt ${k} differs at ${firstDiff(stored.receipts[k], rep.receipts[k])}`);
        break;
      }
    }
    if (stored.header.chainHead !== rep.chainHead) problems.push('receipt chain head differs');
    counts.receiptsMatched += problems.length ? 0 : matched;
    add(`receipts.${clip.id}`, problems.length ? 'fail' : 'pass', problems.length ? problems.join('; ') : `${matched} receipts recomputed and matched · chain ${rep.chainHead.slice(0, 23)}…`);
  });
  inp.onProgress?.(clips.length, clips.length, 'results');

  // ---- results
  let results: Results | null = null;
  if (inp.resultsText === null) add('results', 'skip', 'no bench/out/results.json yet (held-out run not done)');
  else {
    try {
      results = JSON.parse(inp.resultsText) as Results;
      const p: string[] = [];
      if (results.kind !== 'witness-bench-results') p.push('not a results file');
      if (results.synthetic && !inp.allowSynthetic) p.push('results were computed from synthetic/stub traces');
      if (!results.freeze?.frozen) p.push(`thresholds were not frozen (${results.freeze?.reason ?? '?'})`);
      if (results.gate?.configHash !== cfgHash) p.push(`results use gate config ${results.gate?.configHash}, current is ${cfgHash}`);
      const held = decoded.filter((d) => d.clip.split === 'heldout');
      const re = buildReport({ traces: held, cfg: inp.gateConfig, freeze: results.freeze, gitHead: results.gitHead });
      const d = firstDiff(results, re);
      if (d) p.push(`recomputed results differ at ${d}`);
      add('results', p.length ? 'fail' : 'pass', p.length ? p.join('; ') : `recomputed from ${held.length} held-out traces and matched`);
    } catch (e) {
      add('results', 'fail', `unreadable results: ${(e as Error).message}`);
    }
  }

  // ---- git freeze order (CLI only)
  if (!inp.git) add('git.freeze', 'skip', 'no git information (browser or no repository)');
  else {
    const g = inp.git;
    if (!results) add('git.freeze', g.freeze.frozen ? 'pass' : 'skip', g.freeze.frozen ? `frozen at ${g.freeze.tagCommit?.slice(0, 12)}` : `not frozen yet: ${g.freeze.reason}`);
    else {
      const p: string[] = [];
      if (!g.freeze.frozen) p.push(g.freeze.reason);
      if (results.freeze.tagCommit !== g.freeze.tagCommit) p.push(`results claim freeze commit ${results.freeze.tagCommit}, tag is ${g.freeze.tagCommit}`);
      if (g.heldoutTagCommit && g.frozenBeforeHeldout === false) p.push('m4-thresholds-frozen is not an ancestor of m5-heldout');
      add('git.freeze', p.length ? 'fail' : 'pass', p.length ? p.join('; ') : `thresholds frozen at ${g.freeze.tagCommit?.slice(0, 12)}${g.heldoutTagCommit ? `, before held-out run ${g.heldoutTagCommit.slice(0, 12)}` : ''}`);
    }
  }

  // ---- numbers embedded in docs
  for (const [name, doc] of Object.entries(inp.docs).sort()) {
    const ms = findMarkers(doc);
    counts.markers += ms.length;
    const bad: string[] = [];
    for (const m of ms) {
      const want = results === null ? TBD_TEXT : renderValue(getPath(results, m.path), m.format);
      if (want === null) bad.push(`${m.path}|${m.format}: no such value in results`);
      else if (m.content !== want) bad.push(`${m.path}: doc says "${m.content}", results say "${want}"`);
    }
    add(`docs.${name}`, bad.length ? 'fail' : ms.length ? 'pass' : 'skip', bad.length ? bad.slice(0, 5).join('; ') : ms.length ? `${ms.length} embedded numbers match ${results ? 'results.json' : 'TBD placeholders'}` : 'no embedded numbers');
  }

  // ---- generated egress table
  if (inp.egress) {
    const block = inp.egress.doc ? extractBetween(inp.egress.doc, EGRESS_MARKERS[0], EGRESS_MARKERS[1]) : null;
    if (block === null) add('docs.EGRESS.md', 'skip', 'no egress table markers');
    else {
      try {
        const runs = Object.keys(inp.egress.runs).sort().map((k) => JSON.parse(inp.egress!.runs[k]!) as AuditResult);
        const want = renderEgress(runs);
        add('docs.EGRESS.md', block === want ? 'pass' : 'fail', block === want ? `egress table matches ${runs.length} audit runs` : `egress table differs from ${runs.length} audit runs (run npm run egress:report)`);
      } catch (e) {
        add('docs.EGRESS.md', 'fail', `unreadable egress runs: ${(e as Error).message}`);
      }
    }
  }

  const ok = !checks.some((c) => c.status === 'fail');
  const fails = checks.filter((c) => c.status === 'fail').length;
  const summary = ok
    ? `OK · ${counts.traces} traces, all ${counts.receiptsMatched} receipts recomputed and matched · ${counts.markers} embedded numbers checked${results ? ' · results recomputed' : ' · no held-out results yet'}`
    : `FAILED · ${fails} check${fails === 1 ? '' : 's'} failed`;
  return { ok, checks, counts, summary };
}

/**
 * Verify an exported check-in (one or more saved check-ins with their final
 * receipts). Inputs aren't exported, so this checks each receipt's own hash,
 * that its verdict follows from its checks, and that its gate config is known.
 */
export function verifyCheckins(text: string, knownConfigs: GateConfig[]): VerifyReport {
  const checks: Check[] = [];
  const add = (id: string, status: Status, detail: string) => checks.push({ id, status, detail });
  let n = 0, ok = 0;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    add('file', 'fail', 'not JSON');
    return { ok: false, checks, counts: { clips: 0, traces: 0, receipts: 0, receiptsMatched: 0, markers: 0 }, summary: 'FAILED · not a Witness export' };
  }
  const list = (Array.isArray((data as { checkins?: unknown }).checkins) ? (data as { checkins: unknown[] }).checkins : [data]) as { id?: string; results?: { metric: string; value: number; receipt: unknown }[] }[];
  const byHash = new Map(knownConfigs.map((c) => [configHash(c), c]));
  for (const c of list) {
    for (const res of c.results ?? []) {
      n++;
      const id = `${c.id ?? 'checkin'}.${res.metric}`;
      const parsed = ReceiptSchema.safeParse(res.receipt);
      if (!parsed.success) {
        add(id, 'fail', 'not a valid receipt');
        continue;
      }
      const r = parsed.data as Receipt;
      const p: string[] = [];
      if (receiptHashOf(r) !== r.receiptHash) p.push('receipt hash does not match its contents');
      if (Math.abs(r.value - res.value) > 1e-6) p.push(`shown value ${res.value} ≠ receipt value ${r.value}`);
      const cfg = byHash.get(r.gateConfigHash);
      if (!cfg) p.push(`gate config ${r.gateConfigHash} is not a published Witness config`);
      else {
        const d = decide(r.checks, cfg);
        if (d.verdict !== r.verdict || d.reasons.join() !== r.reasons.join()) p.push(`verdict ${r.verdict} does not follow from its checks (${d.verdict})`);
      }
      if (r.verdict !== 'VERIFIED') p.push(`saved value has verdict ${r.verdict}`);
      if (!p.length) ok++;
      add(id, p.length ? 'fail' : 'pass', p.length ? p.join('; ') : `${r.metric} ${r.value} ${r.unit} · VERIFIED · receipt ${r.receiptHash.slice(7, 15)}…`);
    }
  }
  if (!n) add('file', 'fail', 'no receipts found');
  const allOk = n > 0 && ok === n;
  return {
    ok: allOk,
    checks,
    counts: { clips: 0, traces: 0, receipts: n, receiptsMatched: ok, markers: 0 },
    summary: allOk ? `OK · all ${n} receipts are intact and their verdicts follow from their checks` : `FAILED · ${n - ok} of ${n} receipts failed`,
  };
}
