import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeTrace, TBD_TEXT } from '@witness/bench-core';
import { syntheticTrace } from '@witness/sdk-adapter';
import { verifyAll } from '@witness/verify';
import { loadInput, resolveRoot } from '../src/load.js';

const REPO = resolve(__dirname, '../../..');

function repo(withTrace: boolean) {
  const d = mkdtempSync(join(tmpdir(), 'witness-verify-'));
  mkdirSync(join(d, 'packages/gate/config'), { recursive: true });
  copyFileSync(join(REPO, 'packages/gate/config/gate.v1.json'), join(d, 'packages/gate/config/gate.v1.json'));
  mkdirSync(join(d, 'corpus/traces'), { recursive: true });
  const clips = [];
  if (withTrace) {
    const e = encodeTrace(syntheticTrace('clean', { mode: 'quick', durS: 15 }));
    writeFileSync(join(d, 'corpus/traces/B1.jsonl'), e.text);
    clips.push({
      id: 'B1', title: 'B1', condition: 'baseline', split: 'calibration', file: 'B1.mp4', intervals: [], wholeClip: false, groundTruth: null,
      consent: { attested: true, subject: 'S1', at: '2026-11-18T12:00:00.000Z', publishVideo: false }, subject: { fitzpatrick: null },
      camera: 't', lighting: 't', resolution: '320x180', sha256: { clip: null, trace: e.sha256 },
    });
  }
  writeFileSync(join(d, 'corpus/manifest.json'), JSON.stringify({ v: 1, clips }));
  writeFileSync(join(d, 'README.md'), `x <!-- bench:overall.witnessFRR|pct -->${TBD_TEXT}<!-- /bench -->\n`);
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  g('init', '-q');
  g('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return d;
}

describe('verify CLI loader', () => {
  it('an empty corpus with TBD placeholders verifies', () => {
    const r = verifyAll(loadInput(repo(false)));
    expect(r.ok).toBe(true);
    expect(r.checks.find((c) => c.id === 'git.freeze')!.status).toBe('skip');
  });
  it('the CLI path never accepts synthetic traces in the corpus', () => {
    const r = verifyAll(loadInput(repo(true)));
    expect(r.ok).toBe(false);
    expect(r.checks.find((c) => c.id === 'trace.B1.source')!.status).toBe('fail');
  });
  it('accepts the repo root or its corpus/ directory', () => {
    const d = repo(false);
    expect(resolveRoot(join(d, 'corpus'), '/x')).toBe(d);
    expect(resolveRoot(d, '/x')).toBe(d);
    expect(resolveRoot(undefined, '/x')).toBe('/x');
  });
  it('npx witness-verify corpus/ on this repository exits 0', () => {
    const out = execFileSync(process.execPath, [join(REPO, 'tools/verify/bin/witness-verify.mjs'), 'corpus/'], { cwd: REPO }).toString();
    expect(out).toMatch(/^OK · /m);
  }, 60_000);
});
