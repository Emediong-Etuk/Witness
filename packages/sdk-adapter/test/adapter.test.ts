import { describe, expect, it } from 'vitest';
import {
  GateEventMapper, LandmarkFeatureTracker, normalizeMetrics, parseTrace, RealSmartSpectra, requestedMetrics,
  syntheticTrace, toJsonl, TraceReplaySdk, tsToNumber, type SourceEvent,
} from '../src/index.js';

describe('tsToNumber', () => {
  it('handles number, bigint, string, Long-like and junk', () => {
    expect(tsToNumber(5)).toBe(5);
    expect(tsToNumber(5n)).toBe(5);
    expect(tsToNumber('7')).toBe(7);
    expect(tsToNumber({ toNumber: () => 9 })).toBe(9);
    expect(tsToNumber({ low: 1, high: 1, unsigned: false })).toBe(4294967297);
    expect(tsToNumber(null)).toBeNull();
    expect(tsToNumber('x')).toBeNull();
    expect(tsToNumber(NaN)).toBeNull();
  });
});

describe('normalizeMetrics', () => {
  it('maps cardio, breathing, hrv, traces and face detections', () => {
    const n = normalizeMetrics({
      cardio: {
        pulseRate: [{ value: 70, confidence: 80, stable: true, timestamp: { toNumber: () => 1000 } }],
        hrv: [{ rmssd: 40, confidence: 60, stable: true, timestamp: 1500 }],
        arterialPressureTrace: [{ value: 0.3, timestamp: 900 }],
      },
      breathing: { rate: [{ value: 14, confidence: 50, stable: true, timestamp: 1200 }], upperTrace: [{ value: 0.1, timestamp: 950 }] },
      face: {
        talking: [{ detected: true, timestamp: 1100 }],
        blinking: [{ detected: false, timestamp: 1100 }],
        landmarks: [{ value: [{ x: 1, y: 2 }], reset: true, timestamp: 1100 }],
      },
    }, 0);
    const kinds = n.events.map((e) => (e.type === 'rate' ? `rate:${e.metric}` : e.type));
    expect(kinds).toEqual(['trace', 'trace', 'rate:pulse', 'face', 'rate:breathing', 'rate:hrv']);
    const face = n.events.find((e) => e.type === 'face') as Extract<SourceEvent, { type: 'face' }>;
    expect(face).toMatchObject({ talking: true, blinking: false, landmarksReset: true });
    expect(n.landmarks[0]!.points).toEqual([{ x: 1, y: 2 }]);
  });
  it('an empty delta payload produces nothing', () => {
    expect(normalizeMetrics({}, 0)).toEqual({ events: [], landmarks: [] });
  });
  it('events never contain coordinates', () => {
    const n = normalizeMetrics({ face: { landmarks: [{ value: [{ x: 1, y: 2 }], timestamp: 1 }] } }, 0);
    expect(JSON.stringify(n.events)).not.toMatch(/"x"/);
  });
});

describe('LandmarkFeatureTracker', () => {
  it('first frame and post-reset frames have null motion', () => {
    const tr = new LandmarkFeatureTracker();
    const pts = Array.from({ length: 478 }, (_, i) => ({ x: i, y: i % 7 }));
    expect(tr.push(0, pts, false).motion).toBeNull();
    expect(tr.push(1, pts, false).motion).toBe(0);
    expect(tr.push(2, pts, true).motion).toBeNull();
  });
});

describe('GateEventMapper', () => {
  it('emits piecewise states only on change', () => {
    const m = new GateEventMapper('full');
    expect(m.start()).toEqual([{ kind: 'session', t: 0, mode: 'full' }]);
    expect(m.map({ type: 'validation', t: 0, code: 10, hint: 'tuning' })).toEqual([{ kind: 'validation', t: 0, code: 10 }]);
    expect(m.map({ type: 'validation', t: 1, code: 0, hint: '' })).toEqual([{ kind: 'stream_ready', t: 1 }, { kind: 'validation', t: 1, code: 0 }]);
    expect(m.map({ type: 'validation', t: 1.5, code: 10, hint: '' })).toEqual([{ kind: 'validation', t: 1.5, code: 10 }]);
    m.map({ type: 'validation', t: 1.7, code: 0, hint: '' });
    expect(m.map({ type: 'validation', t: 2, code: 0, hint: '' })).toHaveLength(0);
    expect(m.map({ type: 'face', t: 3, talking: false, blinking: true, landmarksReset: true }).map((e) => e.kind)).toEqual(['talking', 'blink', 'landmarks_reset']);
    expect(m.map({ type: 'face', t: 4, talking: false, blinking: false, landmarksReset: false })).toHaveLength(0);
    expect(m.map({ type: 'trace', t: 5, kind: 'pulse', value: 1 })).toHaveLength(0);
  });
});

describe('requestedMetrics', () => {
  it('never requests EXPRESSIONS (14) or EDA (10)', () => {
    for (const mode of ['quick', 'full'] as const) {
      expect(requestedMetrics(mode)).not.toContain(14);
      expect(requestedMetrics(mode)).not.toContain(10);
    }
    expect(requestedMetrics('quick')).not.toContain(2);
  });
});

describe('TraceReplaySdk', () => {
  it('round-trips JSONL and replays with timing', async () => {
    let t = 0;
    const clock = { now: () => t, setInterval: () => 1, clearInterval: () => {} };
    const src = new TraceReplaySdk(parseTrace(toJsonl(syntheticTrace('clean', { mode: 'quick', durS: 3 }))), { clock });
    const got: SourceEvent[] = [];
    src.on((e) => got.push(e));
    await src.start();
    t = 1000;
    src.tick();
    const n1 = got.length;
    expect(got.every((e) => e.t <= 1e6)).toBe(true);
    t = 10_000;
    src.tick();
    expect(got.length).toBeGreaterThan(n1);
    expect(got.at(-1)!.type).toBe('end');
    expect(src.label).toBe('Replay · synthetic:clean');
    await src.stop();
    expect(src.nowUs()).toBe(10_000_000);
    src.destroy();
  });
  it('rejects a trace with no header', () => {
    expect(() => new TraceReplaySdk([])).toThrow();
  });
  it('synthetic traces are labelled as synthetic', () => {
    const [h] = syntheticTrace('photo');
    expect(h).toMatchObject({ type: 'header', synthetic: true, sdkVersion: 'synthetic' });
  });
});

describe('RealSmartSpectra (with a stub SDK)', () => {
  it('maps SDK callbacks onto the session clock and derives face features', async () => {
    const handlers: Record<string, (...a: never[]) => void> = {};
    let now = 1_000_000_000;
    const stub = {
      start: async () => {}, stop: async () => {}, destroy: () => {},
      on: (ev: string, cb: (...a: never[]) => void) => { handlers[ev] = cb; },
    };
    const src = new RealSmartSpectra({
      create: () => stub,
      decode: () => ({ cardio: { pulseRate: [{ value: 66, confidence: 70, stable: true, timestamp: 5_000_000 }] }, face: { landmarks: [{ value: Array.from({ length: 478 }, () => ({ x: 1, y: 1 })), timestamp: 5_000_000 }] } }),
      mode: 'quick', sdkVersion: '3.5.0', clockUs: () => now,
    });
    const got: SourceEvent[] = [];
    src.on((e) => got.push(e));
    await src.start();
    now += 100_000;
    (handlers.validationStatus as unknown as (c: number, ts: number, h: string) => void)(0, 4_900_000, '');
    (handlers.metrics as unknown as (b: Uint8Array, ts: number) => void)(new Uint8Array(), 5_000_000);
    const rate = got.find((e) => e.type === 'rate')!;
    expect(rate.t).toBe(200_000); // 100 ms after the validation tick, on the session clock
    expect(got.some((e) => e.type === 'face_feature')).toBe(true);
    (handlers.error as unknown as (c: number, m: string, r: boolean) => void)(4, 'credits', false);
    expect(got.at(-1)).toMatchObject({ type: 'error', code: 4 });
    await src.stop();
    src.destroy();
  });
  it('a host stream goes to useMediaStream before start, then out through onStream', async () => {
    const calls: string[] = [];
    const host = { id: 'host-stream' } as unknown as MediaStream;
    const stub = {
      start: async () => void calls.push('start'), stop: async () => {}, destroy: () => {},
      on: () => {},
      useMediaStream: (s: MediaStream) => void calls.push(`use:${(s as unknown as { id: string }).id}`),
    };
    const src = new RealSmartSpectra({ create: () => stub, decode: () => ({}), mode: 'quick', sdkVersion: '3.5.0', hostStream: host });
    const seen: MediaStream[] = [];
    src.onStream((s) => seen.push(s));
    await src.start();
    expect(calls).toEqual(['use:host-stream', 'start']);
    expect(seen).toEqual([host]);
    src.destroy();
  });
  it('refuses a host stream when the SDK build has no useMediaStream', async () => {
    const stub = { start: async () => {}, stop: async () => {}, destroy: () => {}, on: () => {} };
    const src = new RealSmartSpectra({ create: () => stub, decode: () => ({}), mode: 'quick', sdkVersion: '3.5.0', hostStream: {} as MediaStream });
    await expect(src.start()).rejects.toThrow(/host stream/);
  });
});
