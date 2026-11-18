import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { GateConfig } from '@witness/gate';
import type { GitFacts, VerifyInput } from '@witness/verify';
import { freezeStatus } from '../../bench/src/git.js';

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
const jsonl = (dir: string) => {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) if (f.endsWith('.jsonl')) out[f.slice(0, -6)] = readFileSync(join(dir, f), 'utf8');
  return out;
};

/** Accepts the repo root or its corpus/ directory (`npx witness-verify corpus/`). */
export function resolveRoot(arg: string | undefined, fallback: string): string {
  if (!arg) return fallback;
  const p = resolve(arg);
  return basename(p) === 'corpus' && statSync(p).isDirectory() ? resolve(p, '..') : p;
}

/** Docs that may carry embedded bench numbers: README.md and docs/*.md (EGRESS.md is checked separately). */
function markerDocs(root: string): Record<string, string> {
  const docs: Record<string, string> = {};
  const r = read(join(root, 'README.md'));
  if (r !== null) docs['README.md'] = r;
  const d = join(root, 'docs');
  if (existsSync(d)) for (const f of readdirSync(d)) if (f.endsWith('.md') && f !== 'EGRESS.md') docs[`docs/${f}`] = readFileSync(join(d, f), 'utf8');
  return docs;
}

export function gitFacts(root: string): GitFacts | null {
  try {
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: 'ignore' });
  } catch {
    return null;
  }
  const freeze = freezeStatus(root);
  let heldoutTagCommit: string | null = null;
  let frozenBeforeHeldout: boolean | null = null;
  try {
    heldoutTagCommit = execFileSync('git', ['rev-list', '-n', '1', 'm5-heldout'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (freeze.tagCommit) {
      try {
        execFileSync('git', ['merge-base', '--is-ancestor', freeze.tagCommit, heldoutTagCommit], { cwd: root, stdio: 'ignore' });
        frozenBeforeHeldout = true;
      } catch {
        frozenBeforeHeldout = false;
      }
    } else frozenBeforeHeldout = false;
  } catch {
    /* no m5 tag yet */
  }
  return { freeze, heldoutTagCommit, frozenBeforeHeldout };
}

export function loadInput(root: string): VerifyInput {
  const egressDir = join(root, 'bench/out/egress');
  const runs: Record<string, string> = {};
  if (existsSync(egressDir)) for (const f of readdirSync(egressDir)) if (f.endsWith('.json') && !f.endsWith('.probe.json')) runs[f] = readFileSync(join(egressDir, f), 'utf8');
  return {
    gateConfig: JSON.parse(readFileSync(join(root, 'packages/gate/config/gate.v1.json'), 'utf8')) as GateConfig,
    manifestText: read(join(root, 'corpus/manifest.json')),
    traces: jsonl(join(root, 'corpus/traces')),
    receipts: jsonl(join(root, 'corpus/receipts')),
    resultsText: read(join(root, 'bench/out/results.json')),
    docs: markerDocs(root),
    egress: { runs, doc: read(join(root, 'docs/EGRESS.md')) },
    git: gitFacts(root),
  };
}
