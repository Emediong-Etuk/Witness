#!/usr/bin/env node
// Witness bench CLI (dev-only). `record` spends Presage credits; everything else is offline.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GATE_V1, type GateConfig } from '@witness/gate';
import { ManifestSchema, type Manifest } from '@witness/schema';
import { buildClipEntry } from './add-clip.js';
import { calibrate, type ClipTrace } from './calibrate.js';
import { probe } from './ffmpeg.js';
import { freezeStatus } from './git.js';
import { consentedClip, loadManifest } from './manifest.js';
import { defaultPaths, REPO } from './paths.js';
import { recordClip } from './record.js';
import { buildReport, encodeReceipts, fillMarkers, renderTables, replayTrace } from '@witness/bench-core';
import { configHash } from '@witness/gate';
import { apiKeyFromEnv, realSdk } from './sdk-node.js';
import { Code } from '@witness/sdk-adapter';
import { readTrace, sha256File } from './trace-io.js';

const P = defaultPaths();
const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

function loadConfig(): GateConfig {
  const f = opt('config');
  return f ? (JSON.parse(readFileSync(f, 'utf8')) as GateConfig) : GATE_V1;
}

export function loadTraces(m: Manifest, tracesDir: string, split: 'calibration' | 'heldout'): ClipTrace[] {
  const out: ClipTrace[] = [];
  for (const clip of m.clips.filter((c) => c.split === split)) {
    const f = join(tracesDir, `${clip.id}.jsonl`);
    if (!existsSync(f)) {
      console.warn(`  ! ${clip.id}: no trace yet (${relative(REPO, f)})`);
      continue;
    }
    const t = readTrace(f);
    if (clip.sha256.trace && clip.sha256.trace !== t.sha256) throw new Error(`${clip.id}: trace hash ${t.sha256} does not match manifest ${clip.sha256.trace}`);
    out.push({ clip, lines: t.lines, traceSha256: t.sha256 });
  }
  return out;
}

const MARKER_DOCS = ['README.md', 'docs/TEST_REPORT.md'];
function fillDocs(results: unknown | null) {
  for (const rel of MARKER_DOCS) {
    const f = join(REPO, rel);
    if (!existsSync(f)) continue;
    const before = readFileSync(f, 'utf8');
    const after = fillMarkers(before, results);
    if (after !== before) writeFileSync(f, after);
    console.log(`  ${rel}: numbers ${results ? 'filled from results.json' : 'set to TBD'}`);
  }
}

function gitHead(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO }).toString().trim();
  } catch {
    return null;
  }
}

async function main() {
  const m = loadManifest(P.manifest);
  switch (cmd) {
    case 'add-clip': {
      // A clip recorded elsewhere (e.g. a phone), copied into corpus/clips/. Offline: no SDK, no credits.
      const id = opt('id');
      const file = opt('file');
      if (!id || !file) {
        throw new Error('usage: bench add-clip --id B1 --file B1.mp4 --condition baseline --split calibration --i-consent [--interval talking:25-45] [--title ...] [--camera ...] [--lighting ...] [--subject S1] [--whole-clip] [--publish-video] [--fitzpatrick 1-6]');
      }
      const path = join(P.clips, file);
      if (!existsSync(path)) throw new Error(`${relative(REPO, path)} not found: copy the video into corpus/clips/ first`);
      const pr = probe(path);
      const intervals: string[] = [];
      argv.forEach((a, i) => a === '--interval' && argv[i + 1] && intervals.push(argv[i + 1]!));
      const fz = opt('fitzpatrick');
      const { clip, fps, durationS } = buildClipEntry({
        id, file,
        title: opt('title') ?? `${opt('condition') ?? 'baseline'} (phone)`,
        condition: (opt('condition') ?? 'baseline') as never,
        split: (opt('split') ?? 'calibration') as 'calibration' | 'heldout',
        intervals,
        wholeClip: flag('whole-clip'),
        camera: opt('camera') ?? 'phone front camera',
        lighting: opt('lighting') ?? 'not recorded',
        subject: opt('subject') ?? 'S1',
        consent: flag('i-consent'),
        publishVideo: flag('publish-video'),
        fitzpatrick: fz ? Number(fz) : null,
        notes: opt('notes'),
        at: new Date().toISOString(),
      }, { ...pr, sha256: sha256File(path) }, m);
      m.clips.push(clip);
      writeFileSync(P.manifest, JSON.stringify(ManifestSchema.parse(m), null, 2) + '\n');
      console.log(`  ${clip.id}: ${clip.condition}, ${clip.split}, ${durationS.toFixed(1)} s at ${fps.toFixed(1)} fps, ${clip.resolution}, sha256 ${clip.sha256.clip!.slice(0, 19)}…`);
      console.log(`  Added to corpus/manifest.json. The video itself stays in corpus/clips/ (gitignored); publishVideo=${clip.consent.publishVideo}.`);
      console.log(`  Next: npm run bench:estimate -- --clip ${clip.id}`);
      return;
    }
    case 'summary': {
      // Offline: what is inside a recorded trace (no SDK, no credits).
      const ids = (opt('clip') ?? m.clips.map((c) => c.id).join(',')).split(',').filter(Boolean);
      const codeName: Record<number, string> = Object.fromEntries(Object.entries(Code).map(([k, v]) => [v, k]));
      for (const id of ids) {
        const f = join(P.traces, `${id}.jsonl`);
        if (!existsSync(f)) { console.log(`  ${id}: no trace`); continue; }
        const t = readTrace(f);
        const head = t.lines[0] as { meta?: Record<string, unknown> };
        const count = (k: string) => t.lines.filter((l) => l.type === k).length;
        const codes = new Map<string, number>();
        const rates = new Map<string, number>();
        let stable = 0;
        for (const l of t.lines as { type: string; code?: number; metric?: string; stable?: boolean }[]) {
          if (l.type === 'validation') codes.set(codeName[l.code!] ?? String(l.code), (codes.get(codeName[l.code!] ?? String(l.code)) ?? 0) + 1);
          if (l.type === 'rate') { rates.set(l.metric!, (rates.get(l.metric!) ?? 0) + 1); if (l.stable) stable++; }
        }
        const meta = head.meta ?? {};
        console.log(`  ${id}: ${meta.width}x${meta.height}${meta.rotation ? ` (rotation ${meta.rotation}°)` : ''}, frames sent ${meta.framesSent}, SDK errors ${meta.errors}`);
        console.log(`    events: validation ${count('validation')}, rate ${count('rate')} (stable ${stable}), face ${count('face')}, face_feature ${count('face_feature')}, frame ${count('frame')}, status ${count('status')}, error ${count('error')}`);
        console.log(`    readings by metric: ${[...rates].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
        console.log(`    validation codes: ${[...codes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
      }
      return;
    }
    case 'estimate':
    case 'record': {
      const ids = flag('all') ? m.clips.map((c) => c.id) : (opt('clip') ?? '').split(',').filter(Boolean);
      if (!ids.length) throw new Error('usage: bench record --clip B1[,T1] | --all  [--speed 1] [--yes]');
      const clips = ids.map((id) => consentedClip(m, id));
      let totalS = 0;
      for (const c of clips) {
        const pr = probe(join(P.clips, c.file));
        const d = (pr.ptsS.at(-1) ?? 0) - (pr.ptsS[0] ?? 0);
        totalS += d;
        console.log(`  ${c.id}  ${c.condition.padEnd(16)} ${d.toFixed(1)} s  ${pr.width}x${pr.height}`);
      }
      console.log(`Estimated SDK time: ${(totalS / 60).toFixed(2)} min of video (credits are metered by Presage; check usage before and after).`);
      if (cmd === 'estimate') return;
      if (!flag('yes')) {
        console.log('Not recording: re-run with --yes after checking remaining credits (BUILD_PROMPT rule 0.3).');
        process.exitCode = 2;
        return;
      }
      const key = apiKeyFromEnv(REPO);
      if (!key) throw new Error('No SMARTSPECTRA_API_KEY in the environment or .env');
      const speed = Number(opt('speed') ?? '1');
      if (!(speed > 0 && speed <= 1)) throw new Error('--speed must be in (0, 1]: frames are fed at or below real time');
      for (const c of clips) {
        const r = await recordClip({
          clip: c, clipsDir: P.clips, tracesDir: P.traces, apiKey: key, createSdk: realSdk, speed,
          mode: (opt('mode') as 'quick' | 'full') ?? 'full', creditsBefore: opt('credits-before'), creditsAfter: opt('credits-after'),
          log: (s) => console.log(`  ${s}`),
        });
        c.sha256.clip = r.meta.clipSha256 as string;
        c.sha256.trace = r.sha256;
        console.log(`  ${c.id}: frames ${r.meta.framesSent}, dropped ${r.meta.framesDropped}, passthrough ${r.meta.tsPassthrough}, wall ${r.meta.wallS}s`);
      }
      writeFileSync(P.manifest, JSON.stringify(ManifestSchema.parse(m), null, 2) + '\n');
      return;
    }
    case 'replay': {
      const cfg = loadConfig();
      const out: Record<string, unknown>[] = [];
      const write = flag('write');
      for (const split of ['calibration', 'heldout'] as const) {
        for (const t of loadTraces(m, P.traces, split)) {
          const rep = replayTrace(t.lines, cfg);
          if (write) {
            mkdirSync(P.receipts, { recursive: true });
            const header = { type: 'receipts_header' as const, v: 1 as const, clipId: t.clip.id, traceSha256: t.traceSha256, gateVersion: cfg.version, gateConfigHash: configHash(cfg), count: rep.receipts.length, chainHead: rep.chainHead };
            writeFileSync(join(P.receipts, `${t.clip.id}.jsonl`), encodeReceipts(header, rep.receipts));
          }
          const v = (k: string) => rep.receipts.filter((r) => r.verdict === k).length;
          out.push({ id: t.clip.id, split, receipts: rep.receipts.length, verified: v('VERIFIED'), withheld: v('WITHHELD'), warming: v('WARMING_UP'), outOfRange: v('OUT_OF_RANGE'), chainHead: rep.chainHead });
        }
      }
      console.table(out);
      if (write) console.log(`Wrote receipts to ${relative(REPO, P.receipts)}/`);
      return;
    }
    case 'docs': {
      // Refill every embedded number from bench/out/results.json (or TBD placeholders if absent).
      const f = join(P.out, 'results.json');
      const results = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
      fillDocs(results);
      return;
    }
    case 'calibrate': {
      const traces = loadTraces(m, P.traces, 'calibration');
      if (!traces.length) throw new Error('no calibration-split traces');
      const res = calibrate(traces, loadConfig());
      mkdirSync(P.out, { recursive: true });
      writeFileSync(join(P.out, 'calibration.json'), JSON.stringify({ stats: res.stats, curves: res.curves, uncalibrated: res.uncalibratedKeys, config: res.config }, null, 2) + '\n');
      console.table(res.stats);
      for (const u of res.uncalibratedKeys) console.log(`  ! not calibrated: ${u.key} (${u.reason})`);
      if (flag('write')) {
        writeFileSync(P.gateConfig, JSON.stringify(res.config, null, 2) + '\n');
        console.log(`Wrote ${relative(REPO, P.gateConfig)}. Commit it, then: git tag m4-thresholds-frozen`);
      } else console.log('Dry run. Re-run with --write to update the gate config.');
      return;
    }
    case 'report': {
      const freeze = freezeStatus(REPO);
      const unfrozen = flag('unfrozen');
      if (!freeze.frozen && !unfrozen) throw new Error(`thresholds are not frozen: ${freeze.reason}. Refusing to run the held-out report (use --unfrozen for a labelled dry run).`);
      const traces = loadTraces(m, P.traces, 'heldout');
      if (!traces.length) throw new Error('no held-out traces');
      const results = buildReport({ traces, cfg: loadConfig(), freeze, gitHead: gitHead() });
      const dir = unfrozen && !freeze.frozen ? join(P.out, 'unfrozen') : P.out;
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2) + '\n');
      writeFileSync(join(dir, 'tables.md'), renderTables(results));
      console.log(renderTables(results));
      if (dir === P.out) fillDocs(results);
      console.log(`Wrote ${relative(REPO, join(dir, 'results.json'))}`);
      return;
    }
    default:
      console.log('usage: bench <add-clip|summary|estimate|record|replay [--write]|calibrate [--write]|report|docs> [options]');
      process.exitCode = 1;
  }
}

main().catch((e: Error) => {
  console.error(`bench: ${e.message}`);
  process.exitCode = 1;
});
