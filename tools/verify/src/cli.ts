// npm run verify  ·  npx witness-verify [corpus/]  ·  npm run verify -- checkin <export.json>
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GateConfig } from '@witness/gate';
import { verifyAll, verifyCheckins, type VerifyReport } from '@witness/verify';
import { loadInput, resolveRoot } from './load.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const pos = args.filter((a) => !a.startsWith('--'));
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const ICON = { pass: c('32', '✓'), fail: c('31', '✗'), skip: c('2', '–') };

function print(r: VerifyReport) {
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  for (const ch of r.checks) console.log(`${ICON[ch.status]} ${ch.id.padEnd(34)} ${ch.status === 'skip' ? c('2', ch.detail) : ch.detail}`);
  console.log('');
  console.log(r.ok ? c('32', r.summary) : c('31', r.summary));
}

let report: VerifyReport;
if (pos[0] === 'checkin') {
  if (!pos[1]) throw new Error('usage: verify checkin <exported-checkins.json>');
  const cfg = JSON.parse(readFileSync(join(REPO, 'packages/gate/config/gate.v1.json'), 'utf8')) as GateConfig;
  report = verifyCheckins(readFileSync(pos[1], 'utf8'), [cfg]);
} else {
  report = verifyAll(loadInput(resolveRoot(pos[0], REPO)));
}
print(report);
process.exitCode = report.ok ? 0 : 1;
