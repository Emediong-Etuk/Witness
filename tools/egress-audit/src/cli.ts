#!/usr/bin/env node
// Witness egress audit CLI (dev-only).
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAudit, type AuditResult } from './audit.js';
import { MATRIX, renderEgress, replaceBetween } from './report.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = join(REPO, 'bench/out/egress');
const argv = process.argv.slice(2);
const sep = argv.indexOf('--');
const head = sep >= 0 ? argv.slice(0, sep) : argv;
const command = sep >= 0 ? argv.slice(sep + 1) : [];
const opt = (n: string) => {
  const i = head.indexOf(`--${n}`);
  return i >= 0 ? head[i + 1] : undefined;
};
const flag = (n: string) => head.includes(`--${n}`);
const MARK = ['<!-- egress:table:start -->', '<!-- egress:table:end -->'] as const;

async function main() {
  const cmd = head[0];
  if (cmd === 'run' || cmd === 'attach') {
    const label = opt('label');
    if (!label || !/^[a-z0-9-]+$/.test(label)) throw new Error('--label <lowercase-with-dashes> is required');
    mkdirSync(OUT, { recursive: true });
    const probeOut = join(OUT, `${label}.probe.json`);
    const res = await runAudit({
      label,
      config: { note: opt('note') ?? null, command: cmd === 'run' ? command.map((a) => (a.includes('KEY') ? '<redacted>' : a)) : null, pid: opt('pid') ?? null },
      command: cmd === 'run' ? command : undefined,
      pid: cmd === 'attach' ? Number(opt('pid')) : undefined,
      durationS: opt('duration') ? Number(opt('duration')) : cmd === 'attach' ? 180 : undefined,
      intervalMs: Number(opt('interval-ms') ?? 500),
      proxy: flag('proxy'),
      upstreamProxy: opt('upstream-proxy') ?? null,
      includeLoopback: flag('include-loopback'),
      probeOut,
      log: (s) => console.log(`egress: ${s}`),
    });
    writeFileSync(join(OUT, `${label}.json`), JSON.stringify(res, null, 2) + '\n');
    console.log(`egress: ${res.samples} samples, ${res.remotes.length} remote endpoints, ${res.proxy.connects.length} proxy targets → bench/out/egress/${label}.json`);
    return;
  }
  if (cmd === 'matrix') {
    console.log('The §7.6/§13.7 matrix. Each run measures YOU at the camera for 180 s and spends credits (5 runs ≈ 15 credit-minutes).');
    console.log('Check remaining credits first, then run each line from the repo root with SMARTSPECTRA_API_KEY in the environment:\n');
    for (const m of MATRIX) {
      console.log(`# ${m.purpose}`);
      console.log(`npm run egress -- run --label ${m.label} --proxy -- npx tsx tools/egress-audit/src/probe.ts --i-am-the-subject --mode ${m.mode} --telemetry ${m.telemetry} --insight-listener ${m.listener} --duration 180\n`);
    }
    console.log('# The real app (pid of the Electron main process), during a normal Full check-in:');
    console.log('npm run egress -- attach --pid <electron-main-pid> --label app-full-checkin --duration 120');
    return;
  }
  if (cmd === 'report') {
    let files: string[] = [];
    try {
      files = readdirSync(OUT).filter((f) => f.endsWith('.json') && !f.endsWith('.probe.json'));
    } catch {
      /* none yet */
    }
    const results = files.sort().map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')) as AuditResult);
    const doc = join(REPO, 'docs/EGRESS.md');
    writeFileSync(doc, replaceBetween(readFileSync(doc, 'utf8'), MARK[0], MARK[1], renderEgress(results)));
    console.log(`egress: wrote ${results.length} runs into docs/EGRESS.md`);
    return;
  }
  console.log('usage: egress <run|attach|matrix|report> …   (see tools/egress-audit/README.md)');
  process.exitCode = 1;
}

main().catch((e: Error) => {
  console.error(`egress: ${e.message}`);
  process.exitCode = 1;
});
