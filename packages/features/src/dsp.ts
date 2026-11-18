// Pure DSP helpers. Plain arrays in, plain numbers out. No allocation tricks,
// no dependencies: these run identically in Node (bench, verify), the feature
// worker, and the judge site's in-browser verifier.

export function mean(x: ArrayLike<number>): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i]!;
  return s / x.length;
}

export function quantile(x: ArrayLike<number>, q: number): number {
  if (x.length === 0) return NaN;
  const a = Array.from(x).sort((p, r) => p - r);
  const pos = Math.min(Math.max(q, 0), 1) * (a.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return a[lo]! + (a[hi]! - a[lo]!) * (pos - lo);
}

export function median(x: ArrayLike<number>): number {
  return quantile(x, 0.5);
}

/** Remove the least-squares line. A step or slow drift does not create a spectral peak in-band. */
export function detrend(x: ArrayLike<number>): number[] {
  const n = x.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const mx = (n - 1) / 2;
  let my = 0;
  for (let i = 0; i < n; i++) my += x[i]!;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxy += dx * (x[i]! - my);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = x[i]! - (my + slope * (i - mx));
  return out;
}

export function hann(n: number): number[] {
  if (n <= 1) return n === 1 ? [1] : [];
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** In-place iterative radix-2 complex FFT. Length must be a power of two. */
export function fftInPlace(re: number[], im: number[]): void {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: re/im length mismatch');
  if (n & (n - 1)) throw new Error('fft: length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

export interface Spectrum {
  freqs: number[];
  power: number[];
}

/**
 * One-sided power spectrum of a real signal: linear detrend, Hann window,
 * zero-pad to `padFactor` × next power of two.
 */
export function periodogram(x: ArrayLike<number>, fs: number, padFactor = 4): Spectrum {
  const n = x.length;
  if (n < 2) return { freqs: [], power: [] };
  const d = detrend(x);
  const w = hann(n);
  const nfft = nextPow2(n) * Math.max(1, Math.floor(padFactor));
  const re = new Array<number>(nfft).fill(0);
  const im = new Array<number>(nfft).fill(0);
  let wss = 0;
  for (let i = 0; i < n; i++) {
    re[i] = d[i]! * w[i]!;
    wss += w[i]! * w[i]!;
  }
  fftInPlace(re, im);
  const half = nfft / 2;
  const freqs = new Array<number>(half + 1);
  const power = new Array<number>(half + 1);
  const scale = wss > 0 ? 1 / (fs * wss) : 0;
  for (let k = 0; k <= half; k++) {
    freqs[k] = (k * fs) / nfft;
    const p = (re[k]! * re[k]! + im[k]! * im[k]!) * scale;
    power[k] = k === 0 || k === half ? p : 2 * p;
  }
  return { freqs, power };
}

/** Welch PSD: average of Hann periodograms over segments with fractional overlap. */
export function welch(
  x: ArrayLike<number>,
  fs: number,
  segLen: number,
  overlap = 0.5,
  padFactor = 4,
): Spectrum {
  const n = x.length;
  const seg = Math.max(2, Math.min(Math.floor(segLen), n));
  if (n < 2) return { freqs: [], power: [] };
  const hop = Math.max(1, Math.floor(seg * (1 - overlap)));
  let acc: Spectrum | null = null;
  let count = 0;
  for (let start = 0; start + seg <= n; start += hop) {
    const part = Array.prototype.slice.call(x, start, start + seg) as number[];
    const s = periodogram(part, fs, padFactor);
    if (!acc) acc = { freqs: s.freqs, power: s.power.slice() };
    else for (let k = 0; k < acc.power.length; k++) acc.power[k]! += s.power[k]!;
    count++;
  }
  if (!acc) return periodogram(x, fs, padFactor);
  for (let k = 0; k < acc.power.length; k++) acc.power[k]! /= count;
  return acc;
}

export function bandPower(s: Spectrum, lo: number, hi: number): number {
  let p = 0;
  for (let k = 0; k < s.freqs.length; k++) {
    const f = s.freqs[k]!;
    if (f >= lo && f <= hi) p += s.power[k]!;
  }
  return p;
}

export interface Peak {
  freq: number;
  power: number;
  index: number;
}

/** Highest bin in [lo, hi], refined with parabolic interpolation. */
export function findPeak(s: Spectrum, lo: number, hi: number): Peak | null {
  let best = -1;
  for (let k = 0; k < s.freqs.length; k++) {
    const f = s.freqs[k]!;
    if (f < lo || f > hi) continue;
    if (best < 0 || s.power[k]! > s.power[best]!) best = k;
  }
  if (best < 0) return null;
  let freq = s.freqs[best]!;
  if (best > 0 && best < s.freqs.length - 1) {
    const a = s.power[best - 1]!;
    const b = s.power[best]!;
    const c = s.power[best + 1]!;
    const den = a - 2 * b + c;
    if (den !== 0) {
      const delta = (0.5 * (a - c)) / den;
      if (Math.abs(delta) <= 1) freq += delta * (s.freqs[1]! - s.freqs[0]!);
    }
  }
  return { freq, power: s.power[best]!, index: best };
}

export function medianPowerInBand(s: Spectrum, lo: number, hi: number): number {
  const vals: number[] = [];
  for (let k = 0; k < s.freqs.length; k++) {
    const f = s.freqs[k]!;
    if (f >= lo && f <= hi) vals.push(s.power[k]!);
  }
  return median(vals);
}

/**
 * Linear interpolation of an irregular series (times in seconds) onto a
 * uniform grid at `fs` Hz from the first to the last sample.
 */
export function resampleUniform(tS: ArrayLike<number>, y: ArrayLike<number>, fs: number): number[] {
  const n = tS.length;
  if (n === 0 || n !== y.length) return [];
  if (n === 1) return [y[0]!];
  const t0 = tS[0]!;
  const t1 = tS[n - 1]!;
  const m = Math.floor((t1 - t0) * fs) + 1;
  const out = new Array<number>(m);
  let j = 0;
  for (let i = 0; i < m; i++) {
    const t = t0 + i / fs;
    while (j < n - 2 && tS[j + 1]! < t) j++;
    const ta = tS[j]!;
    const tb = tS[j + 1]!;
    const u = tb === ta ? 0 : Math.min(1, Math.max(0, (t - ta) / (tb - ta)));
    out[i] = y[j]! + u * (y[j + 1]! - y[j]!);
  }
  return out;
}

/** Zero-phase band-pass by FFT masking (brick-wall). Fine for short analysis windows. */
export function bandpassFFT(x: ArrayLike<number>, fs: number, lo: number, hi: number): number[] {
  const n = x.length;
  if (n < 2) return Array.from(x);
  const d = detrend(x);
  const nfft = nextPow2(n);
  const re = new Array<number>(nfft).fill(0);
  const im = new Array<number>(nfft).fill(0);
  for (let i = 0; i < n; i++) re[i] = d[i]!;
  fftInPlace(re, im);
  for (let k = 0; k < nfft; k++) {
    const kk = k <= nfft / 2 ? k : nfft - k;
    const f = (kk * fs) / nfft;
    if (f < lo || f > hi) {
      re[k] = 0;
      im[k] = 0;
    }
  }
  // inverse FFT via conjugation
  for (let k = 0; k < nfft; k++) im[k] = -im[k]!;
  fftInPlace(re, im);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = re[i]! / nfft;
  return out;
}

/** Normalised autocorrelation r[lag] = Σ x[i]x[i+lag] / Σ x[i]^2, lags 0..maxLag. */
export function autocorr(x: ArrayLike<number>, maxLag: number): number[] {
  const n = x.length;
  const m = mean(x);
  let den = 0;
  for (let i = 0; i < n; i++) den += (x[i]! - m) ** 2;
  const L = Math.min(maxLag, n - 1);
  const out = new Array<number>(Math.max(0, L + 1)).fill(0);
  if (den === 0) return out;
  for (let lag = 0; lag <= L; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (x[i]! - m) * (x[i + lag]! - m);
    out[lag] = s / den;
  }
  return out;
}
