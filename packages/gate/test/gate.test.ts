import { describe, expect, it } from 'vitest';
import {
  canonical, chainStep, configHash, decide, evaluate, GATE_V1, GateSession, GENESIS, receiptHashOf,
  secondsUntilClean, sha256Hex, type GateConfig, type GateEvent, type Metric, type Receipt,
} from '../src/index.js';
import { lastSample, synth } from './synth.js';

const ctx = { sessionId: 'ses_test', sdkVersion: '3.5.0', prevReceiptHash: GENESIS };
const run = (ev: GateEvent[], m: Metric, atS = Infinity, cfg: GateConfig = GATE_V1) => evaluate(lastSample(ev, m, atS), ev, cfg, ctx);
const failed = (r: Receipt) => r.checks.filter((c) => !c.pass).map((c) => c.id);

describe('canonical JSON + hashing', () => {
  it('sorts keys, rounds floats, drops undefined, normalises -0 and non-finite', () => {
    expect(canonical({ b: 1, a: [1.23456789, -0, NaN, undefined], c: undefined })).toBe('{"a":[1.234568,0,null,null],"b":1}');
    expect(canonical(10n)).toBe('10');
    expect(canonical(() => 1)).toBe('null');
  });
  it('sha256 is stable and prefixed', () => {
    expect(sha256Hex('abc')).toBe('sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('chainStep links lines', () => {
    const h1 = chainStep(GENESIS, { a: 1 });
    expect(chainStep(h1, { b: 2 })).not.toBe(chainStep(GENESIS, { b: 2 }));
  });
  it('config hash is deterministic', () => {
    expect(configHash(GATE_V1)).toBe(configHash(JSON.parse(JSON.stringify(GATE_V1))));
  });
});

describe('clean session', () => {
  const ev = synth({ durS: 75 });
  it.each(['pulse', 'breathing', 'hrv'] as const)('%s is VERIFIED once its window is full', (m) => {
    const r = run(ev, m);
    expect(failed(r)).toEqual([]);
    expect(r.verdict).toBe('VERIFIED');
    expect(r.receiptHash).toBe(receiptHashOf(r));
  });
  it('pulse is WARMING_UP before 12 s', () => {
    const r = run(ev, 'pulse', 8);
    expect(r.verdict).toBe('WARMING_UP');
    expect(r.reasons).toContain('R1_WARMUP');
    expect(secondsUntilClean(r, r.window.endUs)).toBeCloseTo(4, 0);
  });
  it('WARMING_UP tolerates low SDK confidence during warm-up', () => {
    const e2 = ev.map((e) => (e.kind === 'rate' && e.t <= 5e6 ? { ...e, confidence: 0, stable: false } : e));
    expect(run(e2, 'pulse', 5).verdict).toBe('WARMING_UP');
  });
});

describe('start-up camera tuning (stream_ready)', () => {
  // SDK-like start: CAMERA_TUNING 0–2 s, then OK; the mapper emits stream_ready at 2 s.
  const tuned = () => {
    const ev = synth({ durS: 75 }).filter((e) => !(e.kind === 'validation' && e.t === 0));
    ev.push({ kind: 'validation', t: 0, code: 10 }, { kind: 'stream_ready', t: 2e6 }, { kind: 'validation', t: 2e6, code: 0 });
    return ev;
  };
  it('breathing at 20 s is WARMING_UP (not withheld for framing)', () => {
    const r = run(tuned(), 'breathing', 20);
    expect(r.verdict).toBe('WARMING_UP');
    expect(r.checks.find((c) => c.id === 'R1_WARMUP')!.observed).toBe(18);
  });
  it('the window counts from the end of tuning: breathing verifies at 32 s, not 30 s', () => {
    expect(run(tuned(), 'breathing', 31).verdict).toBe('WARMING_UP');
    expect(run(tuned(), 'breathing', 32).verdict).toBe('VERIFIED');
  });
  it('tuning in the middle of a session still counts as non-OK', () => {
    const ev = tuned();
    ev.push({ kind: 'validation', t: 50e6, code: 10 }, { kind: 'validation', t: 52e6, code: 0 });
    expect(failed(run(ev, 'breathing', 60))).toContain('R4_VALIDATION_CLEAN');
  });
});

describe('each rule fires on its contamination', () => {
  const cases: [string, Parameters<typeof synth>[0], Metric, string][] = [
    ['talking → breathing withheld (R7)', { durS: 75, talking: [{ from: 50, to: 60 }] }, 'breathing', 'R7_QUIET'],
    ['motion burst → pulse withheld (R6)', { durS: 40, motion: [{ from: 33, to: 35 }] }, 'pulse', 'R6_STILL'],
    ['chewing → pulse withheld (R10)', { durS: 40, chewing: [{ from: 28, to: 40 }] }, 'pulse', 'R10_NO_CHEWING'],
    ['72/min flicker → pulse withheld (R9)', { durS: 40, values: { pulse: 72 }, flicker: [{ from: 20, to: 40, hz: 1.2, amp: 0.01 }] }, 'pulse', 'R9_STEADY_LIGHT'],
    ['15/min flicker → breathing withheld (R9)', { durS: 75, values: { breathing: 15 }, flicker: [{ from: 30, to: 75, hz: 0.25, amp: 0.01 }] }, 'breathing', 'R9_STEADY_LIGHT'],
    ['second face → withheld (R5)', { durS: 40, multipleFaces: [{ from: 35, to: 36 }] }, 'pulse', 'R5_ONE_CONTINUOUS_FACE'],
    ['landmark reset → withheld (R5)', { durS: 40, resets: [35] }, 'pulse', 'R5_ONE_CONTINUOUS_FACE'],
    ['face not centred 2 s → withheld (R4)', { durS: 40, validationBad: [{ from: 33, to: 35, code: 3 }] }, 'pulse', 'R4_VALIDATION_CLEAN'],
    ['fps drop to 15 → withheld (R8)', { durS: 40, fpsDrop: [{ from: 33, to: 36, fps: 15 }] }, 'pulse', 'R8_FRAME_RATE'],
    ['printed photo → withheld (R11)', { durS: 40, photo: true }, 'pulse', 'R11_LIVE_FACE'],
  ];
  it.each(cases)('%s', (_n, opts, m, rule) => {
    const r = run(synth(opts), m);
    expect(r.verdict).toBe('WITHHELD');
    expect(failed(r)).toContain(rule);
  });

  it('a validation blip shorter than δ and under ε does not kill the window', () => {
    const r = run(synth({ durS: 75, validationBad: [{ from: 40, to: 40.2, code: 3 }] }), 'hrv');
    expect(r.verdict).toBe('VERIFIED');
  });
  it('talking is ignored for pulse', () => {
    expect(run(synth({ durS: 40, talking: [{ from: 30, to: 39 }] }), 'pulse').verdict).toBe('VERIFIED');
  });
  it('flicker at a different rate than the pulse still trips the band ratio', () => {
    const r = run(synth({ durS: 40, values: { pulse: 60 }, flicker: [{ from: 20, to: 40, hz: 1.6, amp: 0.02 }] }), 'pulse');
    expect(failed(r)).toContain('R9_STEADY_LIGHT');
  });
  it('contamination outside the window no longer matters', () => {
    expect(run(synth({ durS: 60, motion: [{ from: 20, to: 22 }] }), 'pulse').verdict).toBe('VERIFIED');
  });
  it('reasons are ordered by actionability (motion before talking before light)', () => {
    const r = run(synth({ durS: 75, motion: [{ from: 70, to: 71 }], talking: [{ from: 60, to: 65 }], values: { breathing: 15 }, flicker: [{ from: 40, to: 75, hz: 0.25, amp: 0.02 }] }), 'breathing');
    expect(r.reasons.slice(0, 3)).toEqual(['R6_STILL', 'R7_QUIET', 'R9_STEADY_LIGHT']);
  });
  it('countdown restarts from the end of the disqualifying event', () => {
    const r = run(synth({ durS: 40, motion: [{ from: 33, to: 35 }] }), 'pulse');
    const left = secondsUntilClean(r, 40e6);
    expect(left).toBeGreaterThan(6);
    expect(left).toBeLessThanOrEqual(12);
  });
});

describe('range handling (R3)', () => {
  it('pulse 125 → OUT_OF_RANGE, no number shown', () => {
    const r = run(synth({ durS: 40, values: { pulse: 125 } }), 'pulse');
    expect(r.verdict).toBe('OUT_OF_RANGE');
  });
  it('HRV is out of range when any pulse in its window is > 110', () => {
    const r = run(synth({ durS: 75, values: { pulse: 120 } }), 'hrv');
    expect(failed(r)).toContain('R3_RANGE');
  });
  it('out-of-range plus contamination → WITHHELD', () => {
    const r = run(synth({ durS: 40, values: { pulse: 125 }, motion: [{ from: 35, to: 36 }] }), 'pulse');
    expect(r.verdict).toBe('WITHHELD');
  });
});

describe('insufficient evidence fails closed', () => {
  it('no face features → R6/R10/R11 fail', () => {
    const ev = synth({ durS: 40 }).filter((e) => e.kind !== 'face_feature');
    const r = run(ev, 'pulse');
    expect(failed(r)).toEqual(expect.arrayContaining(['R6_STILL', 'R10_NO_CHEWING', 'R11_LIVE_FACE']));
  });
  it('no frames → R8/R9 fail', () => {
    const r = run(synth({ durS: 40 }).filter((e) => e.kind !== 'frame'), 'pulse');
    expect(failed(r)).toEqual(expect.arrayContaining(['R8_FRAME_RATE', 'R9_STEADY_LIGHT']));
  });
  it('no validation events → R4 fails (unknown counts as non-OK)', () => {
    const r = run(synth({ durS: 40 }).filter((e) => e.kind !== 'validation'), 'pulse');
    expect(failed(r)).toContain('R4_VALIDATION_CLEAN');
  });
  it('no talking events → breathing fails R7', () => {
    const r = run(synth({ durS: 75 }).filter((e) => e.kind !== 'talking'), 'breathing');
    expect(failed(r)).toContain('R7_QUIET');
  });
  it('no session event → R1 fails', () => {
    const r = run(synth({ durS: 40 }).filter((e) => e.kind !== 'session'), 'pulse');
    expect(failed(r)).toContain('R1_WARMUP');
  });
  it('HRV with no pulse samples fails R3', () => {
    const r = run(synth({ durS: 75 }).filter((e) => !(e.kind === 'rate' && e.metric === 'pulse')), 'hrv');
    expect(failed(r)).toContain('R3_RANGE');
  });
});

describe('decide()', () => {
  const c = (id: string, pass: boolean) => ({ id, pass, observed: null, threshold: null }) as never;
  it('precedence', () => {
    expect(decide([c('R1_WARMUP', true)], GATE_V1).verdict).toBe('VERIFIED');
    expect(decide([c('R1_WARMUP', false)], GATE_V1).verdict).toBe('WARMING_UP');
    expect(decide([c('R3_RANGE', false)], GATE_V1).verdict).toBe('OUT_OF_RANGE');
    expect(decide([c('R2_SDK_STABLE', false)], GATE_V1).verdict).toBe('WITHHELD');
    expect(decide([c('R1_WARMUP', false), c('R6_STILL', false)], GATE_V1).verdict).toBe('WITHHELD');
  });
});

describe('GateSession', () => {
  it('chains receipts and reports the latest verified value', () => {
    const s = new GateSession('ses_x', '3.5.0', GATE_V1);
    const ev = synth({ durS: 75 }).sort((a, b) => a.t - b.t);
    for (const e of ev) s.push(e);
    expect(s.receipts.length).toBe(75 * 3);
    expect(s.receipts[0]!.prevReceiptHash).toBe(GENESIS);
    for (let i = 1; i < s.receipts.length; i++) expect(s.receipts[i]!.prevReceiptHash).toBe(s.receipts[i - 1]!.receiptHash);
    expect(s.chainHead).toBe(s.receipts.at(-1)!.receiptHash);
    expect(s.latestVerified('hrv')).not.toBeNull();
    expect(s.latestVerified('pulse')!.verdict).toBe('VERIFIED');
  });
  it('pruned evaluation equals full-history evaluation (carried-in state survives)', () => {
    const ev = synth({ durS: 150, multipleFaces: [{ from: 10, to: 11 }], talking: [{ from: 5, to: 140 }] }).sort((a, b) => a.t - b.t);
    const s = new GateSession('ses_y', '3.5.0', GATE_V1);
    for (const e of ev) s.push(e);
    const last = s.receipts.at(-1)!;
    const full = evaluate(lastSample(ev, last.metric), ev, GATE_V1, { sessionId: 'ses_y', sdkVersion: '3.5.0', prevReceiptHash: last.prevReceiptHash });
    expect(full).toEqual(last);
  });
});
