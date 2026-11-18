import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** §10.5 banned patterns (word-boundary, case-insensitive). */
export const BANNED: [string, RegExp][] = [
  ['diagnos*', /\bdiagnos\w*/i],
  ['disease', /\bdiseases?\b/i],
  ['disorder', /\bdisorders?\b/i],
  ['arrhythmia', /\barrhythmi\w*/i],
  ['hypertension', /\bhypertensi\w*/i],
  ['tachycardia', /\btachycardi\w*/i],
  ['bradycardia', /\bbradycardi\w*/i],
  ['treat*', /\btreat(ment|ments|ing|s)?\b/i],
  ['cure', /\bcur(e|es|ed|ing)\b/i],
  ['prescri*', /\bprescri\w*/i],
  ['normal range', /\bnormal range/i],
  ['abnormal', /\babnormal\w*/i],
  ['you have', /\byou have\b/i],
  ['healthy heart', /\bhealthy heart/i],
  ['medical-grade', /\bmedical[- ]grade/i],
  ['clinically', /\bclinical(ly)?\b/i],
];

/** Fixed disclaimers that may contain banned words. Matched text is removed before checking. */
export const ALLOW: RegExp[] = [
  /not (for )?medical use/gi,
  /not a diagnosis/gi,
  /no diagnosis or treatment claims?/gi,
  /diagnosis or treatment claims/gi,
  /if you have any (concerns|questions)/gi,
];

/** Everything a user or judge reads. Code identifiers and comments in logic files are out of scope. */
export const SCOPE = [
  'apps/desktop/src/renderer/strings/en.json',
  'apps/desktop/src/renderer/screens',
  'packages/session/src/strings.ts',
  'packages/ui/src',
  'apps/web/src',
  'apps/web/index.html',
  'tools/lab-recorder/src/plan.ts',
  'tools/lab-recorder/src/page',
  'README.md',
  'corpus/README.md',
  'docs',
];

export interface Hit {
  file: string;
  line: number;
  rule: string;
  text: string;
}

function files(root: string, p: string): string[] {
  const abs = join(root, p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return [abs];
  return readdirSync(abs).flatMap((f) => files(root, join(p, f))).filter((f) => /\.(tsx?|json|md|html)$/.test(f));
}

export function lint(root: string, scope = SCOPE): Hit[] {
  const hits: Hit[] = [];
  for (const f of [...new Set(scope.flatMap((p) => files(root, p)))]) {
    readFileSync(f, 'utf8').split('\n').forEach((raw, i) => {
      let line = raw;
      for (const a of ALLOW) line = line.replace(a, '');
      for (const [rule, re] of BANNED) if (re.test(line)) hits.push({ file: relative(root, f), line: i + 1, rule, text: raw.trim().slice(0, 140) });
    });
  }
  return hits;
}
