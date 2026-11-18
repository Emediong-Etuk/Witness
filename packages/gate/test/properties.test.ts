import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { evaluate, GATE_V1 as V1, GENESIS, type GateConfig, type GateEvent, type Metric } from '../src/index.js';
import { lastSample, synth } from './synth.js';

/**
 * Properties are about the gate's logic, not its thresholds. The uncalibrated
 * v1 placeholders false-reject ~3% of the synthetic generator's clean
 * sessions (chewing autocorrelation and flicker SNR on white noise), so the
 * properties run on a copy with those two thresholds set for the synthetic
 * generator. Real thresholds come from `bench:calibrate`.
 */
const GATE_V1: GateConfig = {
  ...V1,
  chewing: { ...V1.chewing, maxPeak: 0.8 },
  steadyLight: { ...V1.steadyLight, maxCoincidentSnr: 25 },
};

const ctx = { sessionId: 'ses_prop', sdkVersion: '3.5.0', prevReceiptHash: GENESIS };
const metricArb = fc.constantFrom<Metric>('pulse', 'breathing', 'hrv');
const DUR: Record<Metric, number> = { pulse: 20, breathing: 40, hrv: 70 };
const N = { numRuns: 25 };

/** A disqualifying event placed somewhere in the sample's window. */
const contaminationArb = (durS: number, windowS: number) =>
  fc.record({
    kind: fc.constantFrom('validation_bad', 'multiple_faces', 'reset', 'talking', 'motion'),
    at: fc.double({ min: durS - windowS + 0.5, max: durS - 2.5, noNaN: true }),
    len: fc.double({ min: 1.2, max: 2.0, noNaN: true }),
  });

function inject(ev: GateEvent[], c: { kind: string; at: number; len: number }): GateEvent[] {
  const t0 = Math.round(c.at * 1e6);
  const t1 = Math.round((c.at + c.len) * 1e6);
  switch (c.kind) {
    case 'validation_bad':
      return [...ev, { kind: 'validation', t: t0, code: 12 }, { kind: 'validation', t: t1, code: 0 }];
    case 'multiple_faces':
      return [...ev, { kind: 'validation', t: t0, code: 2 }, { kind: 'validation', t: t1, code: 0 }];
    case 'reset':
      return [...ev, { kind: 'landmarks_reset', t: t0 }];
    case 'talking':
      return [...ev, { kind: 'talking', t: t0, detected: true }, { kind: 'talking', t: t1, detected: false }];
    default:
      return ev.map((e) => (e.kind === 'face_feature' && e.t >= t0 && e.t < t1 ? { ...e, motion: 0.08 } : e));
  }
}

describe('gate properties', () => {
  it('determinism: same events → byte-identical receipt', () => {
    fc.assert(
      fc.property(metricArb, fc.integer({ min: 1, max: 1000 }), (m, seed) => {
        const ev = synth({ durS: DUR[m], seed });
        const s = lastSample(ev, m);
        const a = JSON.stringify(evaluate(s, ev, GATE_V1, ctx));
        const b = JSON.stringify(evaluate(s, ev.slice(), GATE_V1, ctx));
        expect(a).toBe(b);
      }),
      N,
    );
  });

  it('monotonicity: adding a disqualifying event never turns a non-VERIFIED verdict into VERIFIED, and turns VERIFIED into non-VERIFIED', () => {
    fc.assert(
      fc.property(
        metricArb.chain((m) => fc.tuple(fc.constant(m), fc.integer({ min: 1, max: 500 }), contaminationArb(DUR[m], GATE_V1.windowsS[m]))),
        ([m, seed, c]) => {
          const ev = synth({ durS: DUR[m], seed });
          const s = lastSample(ev, m);
          const before = evaluate(s, ev, GATE_V1, ctx).verdict;
          const after = evaluate(s, inject(ev, c), GATE_V1, ctx).verdict;
          if (before !== 'VERIFIED') expect(after).not.toBe('VERIFIED');
          // talking only disqualifies breathing
          if (before === 'VERIFIED' && !(c.kind === 'talking' && m !== 'breathing')) expect(after).toBe('WITHHELD');
        },
      ),
      N,
    );
  });

  it('window boundary: an event exactly at t−W is inside the window; just before it is outside', () => {
    fc.assert(
      fc.property(metricArb, (m) => {
        const ev = synth({ durS: DUR[m] + 2 });
        const s = lastSample(ev, m);
        const edge = s.t - GATE_V1.windowsS[m] * 1e6;
        const inside = evaluate(s, [...ev, { kind: 'landmarks_reset', t: edge }], GATE_V1, ctx);
        const outside = evaluate(s, [...ev, { kind: 'landmarks_reset', t: edge - 1 }], GATE_V1, ctx);
        expect(inside.verdict).toBe('WITHHELD');
        expect(outside.verdict).toBe('VERIFIED');
      }),
      { numRuns: 3 },
    );
  });

  it('shuffling events (incl. within the same timestamp) never changes the receipt', () => {
    fc.assert(
      fc.property(metricArb, fc.integer({ min: 1, max: 1000 }), fc.integer(), (m, seed, shuffleSeed) => {
        const ev = synth({ durS: DUR[m], seed, talking: [{ from: 3, to: 4 }], multipleFaces: [{ from: 2, to: 2 }] });
        // two contradictory states at one timestamp
        ev.push({ kind: 'validation', t: 5_000_000, code: 3 }, { kind: 'validation', t: 5_000_000, code: 0 });
        const s = lastSample(ev, m);
        const shuffled = fc.sample(fc.shuffledSubarray(ev, { minLength: ev.length, maxLength: ev.length }), { numRuns: 1, seed: shuffleSeed })[0]!;
        expect(evaluate(s, shuffled, GATE_V1, ctx)).toEqual(evaluate(s, ev, GATE_V1, ctx));
      }),
      { numRuns: 10 },
    );
  });

  it('±150 ms alignment jitter between SDK and frame clocks does not flip clean sessions', () => {
    fc.assert(
      fc.property(metricArb, fc.integer({ min: -150_000, max: 150_000 }), fc.integer({ min: 1, max: 300 }), (m, shift, seed) => {
        const ev = synth({ durS: DUR[m], seed, sdkShiftUs: shift });
        expect(evaluate(lastSample(ev, m), ev, GATE_V1, ctx).verdict).toBe('VERIFIED');
      }),
      N,
    );
  });
});
