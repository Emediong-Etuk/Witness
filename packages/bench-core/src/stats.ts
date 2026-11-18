import { mean, quantile } from '@witness/features';

export { mean, quantile };

/** Deterministic PRNG (mulberry32) so bootstrap CIs are reproducible by `npm run verify`. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const round = (x: number | null, d = 4): number | null => (x === null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export interface Ci {
  value: number | null;
  lo: number | null;
  hi: number | null;
  n: number;
  clusters: number;
}

/**
 * Cluster bootstrap (resample whole clips, not readings): readings 1 s apart
 * share most of their window, so a reading-level bootstrap would overstate
 * certainty. 95% percentile interval, 2000 resamples, fixed seed.
 */
export function clusterBootstrap<T>(clusters: T[][], stat: (xs: T[]) => number | null, seed = 20261122, B = 2000): Ci {
  const all = clusters.flat();
  const value = all.length ? stat(all) : null;
  const nonEmpty = clusters.filter((c) => c.length);
  if (nonEmpty.length < 2 || value === null) return { value: round(value), lo: null, hi: null, n: all.length, clusters: nonEmpty.length };
  const r = rng(seed);
  const vals: number[] = [];
  for (let b = 0; b < B; b++) {
    const pick: T[] = [];
    for (let i = 0; i < nonEmpty.length; i++) pick.push(...nonEmpty[Math.floor(r() * nonEmpty.length)]!);
    const v = stat(pick);
    if (v !== null && Number.isFinite(v)) vals.push(v);
  }
  return { value: round(value), lo: round(quantile(vals, 0.025)), hi: round(quantile(vals, 0.975)), n: all.length, clusters: nonEmpty.length };
}

export const share = (xs: boolean[]): number | null => (xs.length ? xs.filter(Boolean).length / xs.length : null);
export const mae = (errs: number[]): number | null => (errs.length ? mean(errs.map(Math.abs)) : null);
