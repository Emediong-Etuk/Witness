import { autocorr, bandpassFFT, resampleUniform } from './dsp.js';

export interface ChewingOptions {
  fs: number;
  winS: number;
  hopS: number;
  lo: number;
  hi: number;
  /** Periodicity must persist across this many consecutive windows (hop-spaced). */
  sustain: number;
}

export const DEFAULT_CHEWING: ChewingOptions = { fs: 30, winS: 3, hopS: 1, lo: 0.7, hi: 2.5, sustain: 3 };

export interface ChewingResult {
  /**
   * Sustained periodicity score: over every run of `sustain` consecutive
   * windows, take the weakest window's autocorrelation peak (lag in
   * [1/hi, 1/lo]); report the strongest such run. Single noisy windows can't
   * trigger it.
   */
  peak: number;
  /** Strongest single-window peak (diagnostic only). */
  maxWindowPeak: number;
  lagS: number | null;
  windows: number;
}

/**
 * Periodic jaw/mouth motion detector. Only spans where the SDK says the person
 * is NOT talking (and that last ≥ winS) are analysed, so speech isn't mistaken
 * for chewing. Samples: times (s, ascending), value, talking flag per sample.
 */
export function chewingScore(
  tS: ArrayLike<number>,
  v: ArrayLike<number>,
  talking: ArrayLike<boolean>,
  o: ChewingOptions = DEFAULT_CHEWING,
): ChewingResult {
  let peak = 0;
  let lagS: number | null = null;
  let maxWindowPeak = 0;
  let windows = 0;
  const n = tS.length;
  let i = 0;
  while (i < n) {
    while (i < n && talking[i]) i++;
    let j = i;
    while (j < n && !talking[j]) j++;
    if (j - i >= 2 && tS[j - 1]! - tS[i]! >= o.winS) {
      const ts = Array.prototype.slice.call(tS, i, j) as number[];
      const vs = Array.prototype.slice.call(v, i, j) as number[];
      const y = resampleUniform(ts, vs, o.fs);
      const seg = Math.round(o.winS * o.fs);
      const hop = Math.max(1, Math.round(o.hopS * o.fs));
      const minLag = Math.max(1, Math.floor(o.fs / o.hi));
      const maxLag = Math.ceil(o.fs / o.lo);
      const run: { p: number; lag: number | null }[] = [];
      for (let s = 0; s + seg <= y.length; s += hop) {
        const bp = bandpassFFT(y.slice(s, s + seg), o.fs, o.lo, o.hi);
        const r = autocorr(bp, maxLag);
        windows++;
        let wp = 0;
        let wl: number | null = null;
        for (let lag = minLag; lag <= Math.min(maxLag, r.length - 2); lag++) {
          const c = r[lag]!;
          if (c > r[lag - 1]! && c >= r[lag + 1]! && c > wp) {
            wp = c;
            wl = lag / o.fs;
          }
        }
        maxWindowPeak = Math.max(maxWindowPeak, wp);
        run.push({ p: wp, lag: wl });
        const k = Math.max(1, o.sustain);
        if (run.length >= k) {
          const last = run.slice(-k);
          let weakest = last[0]!;
          for (const w of last) if (w.p < weakest.p) weakest = w;
          if (weakest.p > peak) {
            peak = weakest.p;
            lagS = weakest.lag;
          }
        }
      }
    }
    i = j;
  }
  return { peak, lagS, maxWindowPeak, windows };
}
