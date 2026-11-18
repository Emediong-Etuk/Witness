import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { canonical, chainStep, GENESIS, type Receipt } from '@witness/gate';
import type { TraceLine } from '@witness/sdk-adapter';

export class ChainError extends Error {}

export const sha256Text = (text: string): string => 'sha256:' + bytesToHex(sha256(utf8ToBytes(text)));
export const sha256Bytes = (b: Uint8Array): string => 'sha256:' + bytesToHex(sha256(b));

/**
 * Traces are JSONL with a running chain hash on every line:
 * h_i = sha256(h_{i-1} ‖ canonical(line_i without h)). The last h is the
 * chain head. No frames, images, landmark coordinates or expressions.
 */
export function encodeTrace(lines: TraceLine[]): { text: string; head: string; sha256: string } {
  let h = GENESIS;
  const out: string[] = [];
  for (const l of lines) {
    h = chainStep(h, l);
    out.push(canonical({ ...l, h }));
  }
  const text = out.join('\n') + '\n';
  return { text, head: h, sha256: sha256Text(text) };
}

export function decodeTrace(text: string, name = 'trace'): { lines: TraceLine[]; head: string; sha256: string } {
  let h = GENESIS;
  const lines: TraceLine[] = [];
  let n = 0;
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    n++;
    let obj: TraceLine & { h?: string };
    try {
      obj = JSON.parse(raw) as TraceLine & { h?: string };
    } catch {
      throw new ChainError(`${name}: line ${n} is not JSON`);
    }
    const { h: got, ...line } = obj;
    h = chainStep(h, line);
    if (got !== h) throw new ChainError(`${name}: hash chain broken at line ${n}`);
    lines.push(line as TraceLine);
  }
  return { lines, head: h, sha256: sha256Text(text) };
}

export interface ReceiptsHeader {
  type: 'receipts_header';
  v: 1;
  clipId: string;
  traceSha256: string;
  gateVersion: string;
  gateConfigHash: string;
  count: number;
  chainHead: string;
}

/** Stored receipts per clip: a header line, then one canonical receipt per line (receipts chain through prevReceiptHash). */
export function encodeReceipts(h: ReceiptsHeader, receipts: Receipt[]): string {
  return [canonical(h), ...receipts.map((r) => canonical(r))].join('\n') + '\n';
}

export function decodeReceipts(text: string): { header: ReceiptsHeader; receipts: Receipt[] } {
  const rows = text.split('\n').filter((l) => l.trim());
  const header = JSON.parse(rows[0] ?? '{}') as ReceiptsHeader;
  if (header.type !== 'receipts_header') throw new Error('receipts file has no header line');
  return { header, receipts: rows.slice(1).map((l) => JSON.parse(l) as Receipt) };
}
