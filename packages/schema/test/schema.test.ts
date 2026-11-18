import { describe, expect, it } from 'vitest';
import { evaluate, GATE_V1, GENESIS } from '@witness/gate';
import { GateEventSchema, ReceiptSchema, SessionLogLineSchema } from '../src/index.js';
import { lastSample, synth } from '../../gate/test/synth.js';

describe('schemas agree with the gate', () => {
  const ev = synth({ durS: 20 });
  it('every synthetic gate event validates', () => {
    for (const e of ev) expect(GateEventSchema.safeParse(e).success).toBe(true);
  });
  it('a receipt validates', () => {
    const r = evaluate(lastSample(ev, 'pulse'), ev, GATE_V1, { sessionId: 'ses_a', sdkVersion: '3.5.0', prevReceiptHash: GENESIS });
    expect(ReceiptSchema.parse(r)).toEqual(r);
  });
  it('rejects landmark coordinates sneaking into a log line (privacy rule)', () => {
    const line = { type: 'sdk_face', h: GENESIS, t: 1, talking: false, blinking: false, landmarksReset: false, landmarks: [{ x: 1, y: 2 }] };
    expect(SessionLogLineSchema.safeParse(line).success).toBe(false);
  });
  it('rejects unknown event kinds and extra fields', () => {
    expect(GateEventSchema.safeParse({ kind: 'expression', t: 0 }).success).toBe(false);
    expect(GateEventSchema.safeParse({ kind: 'blink', t: 0, detected: true, x: 1 }).success).toBe(false);
  });
});

import { syntheticTrace } from '@witness/sdk-adapter';
import { TraceLineSchema } from '../src/index.js';

describe('trace line schema', () => {
  it('accepts every synthetic trace line', () => {
    for (const l of syntheticTrace('talking', { mode: 'full', durS: 5 })) expect(TraceLineSchema.safeParse(l).success).toBe(true);
  });
  it('rejects coordinates or expressions smuggled into a trace', () => {
    expect(TraceLineSchema.safeParse({ type: 'face_feature', t: 1, motion: 0, mouth: 0, jaw: 1, points: [{ x: 1, y: 2 }] }).success).toBe(false);
    expect(TraceLineSchema.safeParse({ type: 'face', t: 1, talking: false, blinking: false, landmarksReset: false, expression: 'happy' }).success).toBe(false);
    expect(TraceLineSchema.safeParse({ type: 'landmarks', t: 1 }).success).toBe(false);
  });
});
