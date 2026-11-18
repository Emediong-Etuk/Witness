import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Canonical JSON: object keys sorted, numbers rounded to 6 decimals, -0 → 0,
 * non-finite numbers → null, undefined properties dropped. Identical bytes in
 * Node and the browser, so hashes are reproducible anywhere.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(normalise(value));
}

export function round6(n: number): number {
  const r = Math.round(n * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

function normalise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? round6(v) : null;
  if (typeof v === 'boolean' || typeof v === 'string') return v;
  if (typeof v === 'bigint') return Number(v);
  if (Array.isArray(v)) return v.map((x) => normalise(x));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined) continue;
      out[k] = normalise(x);
    }
    return out;
  }
  return null;
}

export function sha256Hex(s: string): string {
  return 'sha256:' + bytesToHex(sha256(utf8ToBytes(s)));
}

export const GENESIS = 'sha256:' + '0'.repeat(64);

/** Hash-chain step for session logs: h_i = sha256(h_{i-1} ‖ canonical(line_i)). */
export function chainStep(prev: string, line: unknown): string {
  return sha256Hex(prev + canonical(line));
}
