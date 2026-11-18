import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical, chainStep, GENESIS } from '@witness/gate';
import type { TraceLine } from '@witness/sdk-adapter';

/**
 * Traces are JSONL with a running chain hash on every line:
 * h_i = sha256(h_{i-1} ‖ canonical(line_i without h)). The last h is the
 * chain head. No frames, images, landmark coordinates or expressions.
 */
export function writeTrace(file: string, lines: TraceLine[]): { head: string; sha256: string } {
  let h = GENESIS;
  const out: string[] = [];
  for (const l of lines) {
    h = chainStep(h, l);
    out.push(canonical({ ...l, h }));
  }
  const text = out.join('\n') + '\n';
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { head: h, sha256: 'sha256:' + createHash('sha256').update(text).digest('hex') };
}

export class ChainError extends Error {}

export function readTrace(file: string): { lines: TraceLine[]; head: string; sha256: string } {
  const text = readFileSync(file, 'utf8');
  let h = GENESIS;
  const lines: TraceLine[] = [];
  let n = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    n++;
    const obj = JSON.parse(raw) as TraceLine & { h?: string };
    const { h: got, ...line } = obj;
    h = chainStep(h, line);
    if (got !== h) throw new ChainError(`${file}: hash chain broken at line ${n}`);
    lines.push(line as TraceLine);
  }
  return { lines, head: h, sha256: 'sha256:' + createHash('sha256').update(text).digest('hex') };
}

export function sha256File(file: string): string {
  return 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex');
}
