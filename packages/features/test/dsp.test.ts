import { describe, expect, it } from 'vitest';
import {
  autocorr, bandPower, bandpassFFT, detrend, fftInPlace, findPeak, hann, mean, median, nextPow2,
  periodogram, quantile, resampleUniform, welch,
} from '../src/index.js';

const sine = (f: number, fs: number, n: number, a = 1, ph = 0) =>
  Array.from({ length: n }, (_, i) => a * Math.sin(2 * Math.PI * f * (i / fs) + ph));

describe('basic stats', () => {
  it('mean/median/quantile', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([5, 1, 3])).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(Number.isNaN(mean([]))).toBe(true);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
  });
});

describe('detrend', () => {
  it('removes a line exactly', () => {
    const d = detrend(Array.from({ length: 50 }, (_, i) => 3 + 0.5 * i));
    for (const v of d) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
  it('handles tiny inputs', () => {
    expect(detrend([])).toEqual([]);
    expect(detrend([7])).toEqual([0]);
  });
});

describe('fft', () => {
  it('matches a known DFT (impulse → flat spectrum)', () => {
    const re = [1, 0, 0, 0, 0, 0, 0, 0];
    const im = new Array(8).fill(0);
    fftInPlace(re, im);
    for (let k = 0; k < 8; k++) {
      expect(re[k]).toBeCloseTo(1, 12);
      expect(im[k]).toBeCloseTo(0, 12);
    }
  });
  it('a cosine at bin 2 of 16 puts N/2 in bins 2 and 14', () => {
    const n = 16;
    const re = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 2 * i) / n));
    const im = new Array(n).fill(0);
    fftInPlace(re, im);
    expect(re[2]).toBeCloseTo(8, 9);
    expect(re[14]).toBeCloseTo(8, 9);
    expect(Math.abs(re[3]!)).toBeLessThan(1e-9);
  });
  it('rejects non power-of-two', () => {
    expect(() => fftInPlace([1, 2, 3], [0, 0, 0])).toThrow();
    expect(() => fftInPlace([1, 2], [0])).toThrow();
  });
  it('nextPow2 / hann', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(17)).toBe(32);
    expect(hann(1)).toEqual([1]);
    expect(hann(0)).toEqual([]);
    const w = hann(5);
    expect(w[0]).toBeCloseTo(0);
    expect(w[2]).toBeCloseTo(1);
  });
});

describe('spectra', () => {
  it('periodogram peak lands on a 1.2 Hz sinusoid', () => {
    const s = periodogram(sine(1.2, 30, 360), 30);
    const p = findPeak(s, 0.5, 3)!;
    expect(p.freq).toBeCloseTo(1.2, 1);
  });
  it('Parseval-ish: band power of a sinusoid concentrates in-band', () => {
    const s = welch(sine(1.2, 30, 900), 30, 360);
    expect(bandPower(s, 1.0, 1.4) / bandPower(s, 0.05, 5)).toBeGreaterThan(0.95);
  });
  it('a luminance step does not create an in-band peak after detrend', () => {
    const x = Array.from({ length: 360 }, (_, i) => (i < 180 ? 100 : 101));
    const s = periodogram(x, 30);
    const r = bandPower(s, 0.67, 1.83) / bandPower(s, 0.05, 5);
    expect(r).toBeLessThan(0.2);
  });
  it('edge cases', () => {
    expect(periodogram([1], 30).freqs).toEqual([]);
    expect(welch([1], 30, 10).freqs).toEqual([]);
    expect(findPeak({ freqs: [0, 1], power: [1, 2] }, 5, 6)).toBeNull();
  });
});

describe('resample / bandpass / autocorr', () => {
  it('resamples linearly', () => {
    const y = resampleUniform([0, 1, 2], [0, 10, 20], 2);
    expect(y).toEqual([0, 5, 10, 15, 20]);
    expect(resampleUniform([], [], 30)).toEqual([]);
    expect(resampleUniform([0], [4], 30)).toEqual([4]);
  });
  it('bandpass keeps 1.5 Hz and removes 0.2 Hz', () => {
    const x = sine(1.5, 30, 256).map((v, i) => v + 5 * Math.sin(2 * Math.PI * 0.2 * (i / 30)));
    const y = bandpassFFT(x, 30, 0.7, 2.5);
    const s = periodogram(y, 30);
    expect(findPeak(s, 0.05, 5)!.freq).toBeCloseTo(1.5, 0);
  });
  it('autocorr of a periodic signal peaks at the period', () => {
    const r = autocorr(sine(1.5, 30, 90), 40);
    expect(r[0]).toBeCloseTo(1);
    expect(r[20]!).toBeGreaterThan(0.5);
    expect(autocorr([1, 1, 1], 2)).toEqual([0, 0, 0]);
  });
});
