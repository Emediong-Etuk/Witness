import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { decodeTrace, encodeTrace, sha256Bytes } from '@witness/bench-core';
import type { TraceLine } from '@witness/sdk-adapter';

export { ChainError } from '@witness/bench-core';

/** Node wrappers around the browser-safe codecs in @witness/bench-core. */
export function writeTrace(file: string, lines: TraceLine[]): { head: string; sha256: string } {
  const e = encodeTrace(lines);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, e.text);
  return { head: e.head, sha256: e.sha256 };
}

export function readTrace(file: string): { lines: TraceLine[]; head: string; sha256: string } {
  return decodeTrace(readFileSync(file, 'utf8'), file);
}

export function sha256File(file: string): string {
  return sha256Bytes(readFileSync(file));
}
