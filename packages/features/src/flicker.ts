import { bandPower, findPeak, medianPowerInBand, resampleUniform, welch } from './dsp.js';

export interface FlickerOptions {
  /** Resampling rate for the analysis grid (Hz). */
  fs: number;
  /** The metric's physiological band, Hz (e.g. pulse 0.67–1.83). */
  band: [number, number];
  /** Reference band used as denominator, Hz (spec: 0.05–5). */
  fullBand: [number, number];
  /** Reported value converted to Hz (pulse bpm/60, breathing br/min/60), or null. */
  refHz: number | null;
  /** Coincidence half-width in Hz (±5 bpm = 0.0833 Hz; ±2 br/min = 0.0333 Hz). */
  tolHz: number;
  /** Welch segment length in seconds (segment = whole window when ≥ window). */
  segS: number;
}

export interface FlickerResult {
  /** P(band) / P(fullBand). */
  bandRatio: number;
  /** Strongest in-band peak (Hz) and its SNR (peak / median power in fullBand). */
  peakHz: number | null;
  peakSnr: number;
  /** Strongest peak within refHz ± tolHz, if refHz given. */
  coincidentHz: number | null;
  coincidentSnr: number;
  samples: number;
}

/**
 * Spectral analysis of a background-luminance series. This is Witness's own
 * math (the SDK has no flicker warning code): it tells us whether the room
 * light pulses in the same band — or at the same rate — as the reading.
 */
export function analyzeFlicker(tS: ArrayLike<number>, luma: ArrayLike<number>, o: FlickerOptions): FlickerResult {
  const y = resampleUniform(tS, luma, o.fs);
  const empty: FlickerResult = { bandRatio: 0, peakHz: null, peakSnr: 0, coincidentHz: null, coincidentSnr: 0, samples: y.length };
  if (y.length < Math.max(8, o.fs * 2)) return empty;
  const s = welch(y, o.fs, Math.round(o.segS * o.fs), 0.5, 4);
  const full = bandPower(s, o.fullBand[0], o.fullBand[1]);
  const inBand = bandPower(s, o.band[0], o.band[1]);
  const floor = medianPowerInBand(s, o.fullBand[0], o.fullBand[1]);
  const snr = (p: number) => (floor > 0 ? p / floor : p > 0 ? Infinity : 0);
  const peak = findPeak(s, o.band[0], o.band[1]);
  let coincidentHz: number | null = null;
  let coincidentSnr = 0;
  if (o.refHz !== null && Number.isFinite(o.refHz)) {
    const c = findPeak(s, o.refHz - o.tolHz, o.refHz + o.tolHz);
    if (c) {
      coincidentHz = c.freq;
      coincidentSnr = snr(c.power);
    }
  }
  return {
    bandRatio: full > 0 ? inBand / full : 0,
    peakHz: peak ? peak.freq : null,
    peakSnr: peak ? snr(peak.power) : 0,
    coincidentHz,
    coincidentSnr,
    samples: y.length,
  };
}
