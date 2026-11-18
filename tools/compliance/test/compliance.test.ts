import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOW, BANNED, lint } from '../lint.js';

const ROOT = resolve(__dirname, '../../..');

describe('compliance lint (§10.5)', () => {
  it('no diagnosis/treatment wording in UI strings, the site, the README or the docs', () => {
    const hits = lint(ROOT);
    expect(hits.map((h) => `${h.file}:${h.line} [${h.rule}] ${h.text}`)).toEqual([]);
  });
  it('catches the banned patterns and lets the fixed disclaimers through', () => {
    const fake = (s: string) => {
      let line = s;
      for (const a of ALLOW) line = line.replace(a, '');
      return BANNED.filter(([, re]) => re.test(line)).map(([r]) => r);
    };
    expect(fake('Your pulse suggests tachycardia.')).toEqual(['tachycardia']);
    expect(fake('This is in the normal range.')).toEqual(['normal range']);
    expect(fake('You have a healthy heart')).toEqual(['you have', 'healthy heart']);
    expect(fake('Clinically validated, medical-grade readings')).toEqual(['medical-grade', 'clinically']);
    expect(fake('General wellness only, not medical advice. Not a diagnosis.')).toEqual([]);
    expect(fake('A secure, accurate procedure')).toEqual([]);
  });
});
