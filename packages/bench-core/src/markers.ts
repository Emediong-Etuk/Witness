/**
 * Numbers in README / TEST_REPORT / the judge site are never typed by hand:
 * they sit between markers and are rendered from bench/out/results.json.
 *
 *   <!-- bench:overall.sdkFalseTrust|ci-pct -->12.3% [5.0–20.1]<!-- /bench -->
 *
 * Before results exist, the only allowed content is TBD_TEXT.
 */
export const TBD_TEXT = 'TBD (run npm run bench:report)';
const RE = /<!-- bench:([A-Za-z0-9_.[\]-]+)\|([a-z0-9-]+) -->([\s\S]*?)<!-- \/bench -->/g;

export interface Marker {
  path: string;
  format: string;
  content: string;
  index: number;
}

export function findMarkers(doc: string): Marker[] {
  return [...doc.matchAll(RE)].map((m) => ({ path: m[1]!, format: m[2]!, content: m[3]!, index: m.index ?? 0 }));
}

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

const isCi = (v: unknown): v is { value: number | null; lo: number | null; hi: number | null } => !!v && typeof v === 'object' && 'value' in v;

/** Render a value in a marker format. Returns null if the value can't be rendered in that format. */
export function renderValue(v: unknown, format: string): string | null {
  const val = isCi(v) ? v.value : v;
  switch (format) {
    case 'int':
      return typeof val === 'number' ? String(Math.round(val)) : null;
    case 'num1':
      return typeof val === 'number' ? val.toFixed(1) : null;
    case 'num2':
      return typeof val === 'number' ? val.toFixed(2) : null;
    case 'pct':
      return typeof val === 'number' ? `${(val * 100).toFixed(1)}%` : val === null ? 'n/a' : null;
    case 'ci-pct':
      if (!isCi(v)) return null;
      if (v.value === null) return 'n/a';
      return v.lo === null || v.hi === null ? `${(v.value * 100).toFixed(1)}%` : `${(v.value * 100).toFixed(1)}% [${(v.lo * 100).toFixed(1)}–${(v.hi * 100).toFixed(1)}]`;
    case 'ci-num1':
      if (!isCi(v)) return null;
      if (v.value === null) return 'n/a';
      return v.lo === null || v.hi === null ? v.value.toFixed(1) : `${v.value.toFixed(1)} [${v.lo.toFixed(1)}–${v.hi.toFixed(1)}]`;
    case 'text':
      return typeof val === 'string' || typeof val === 'number' ? String(val) : null;
    default:
      return null;
  }
}

/** Rewrite every marker from results (or TBD when results are absent). */
export function fillMarkers(doc: string, results: unknown | null): string {
  return doc.replace(RE, (_m, path: string, format: string) => {
    const content = results === null ? TBD_TEXT : renderValue(getPath(results, path), format) ?? `INVALID(${path})`;
    return `<!-- bench:${path}|${format} -->${content}<!-- /bench -->`;
  });
}
