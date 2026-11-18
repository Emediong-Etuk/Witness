import { canonical } from '@witness/gate';

/** First path where two values differ after canonical normalisation, or null if equal. */
export function firstDiff(a: unknown, b: unknown): string | null {
  return walk(JSON.parse(canonical(a)), JSON.parse(canonical(b)), '');
}

function walk(a: unknown, b: unknown, path: string): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return path || '(root)';
  if (Array.isArray(a) !== Array.isArray(b)) return path || '(root)';
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return `${path}.length`;
    for (let i = 0; i < a.length; i++) {
      const d = walk(a[i], bb[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  const ao = a as Record<string, unknown>, bo = b as Record<string, unknown>;
  for (const k of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) {
    const d = walk(ao[k], bo[k], path ? `${path}.${k}` : k);
    if (d) return d;
  }
  return null;
}
