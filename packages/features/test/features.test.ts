import { describe, expect, it } from 'vitest';
import {
  analyzeFlicker, chewingScore, cornerRois, faceBox, iod, jawLength, LM, luma, maxRollingRms,
  mouthAperture, OffsetEstimator, rectsOverlap, rigidMotion, roiMeanLuma, type Point,
} from '../src/index.js';

// Deterministic PRNG so tests are reproducible.
function rng(seed: number) {
  // mulberry32: small, well-mixed, deterministic
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
}

const PULSE = { band: [0.67, 1.83] as [number, number], fullBand: [0.05, 5] as [number, number], fs: 30, segS: 12 };

describe('flicker (R9 math)', () => {
  it('1.2 Hz sinusoid at 0.5% amplitude + noise → coincident with 72 ± 2 bpm', () => {
    const r = rng(1);
    const t = Array.from({ length: 360 }, (_, i) => i / 30);
    const y = t.map((s) => 120 * (1 + 0.005 * Math.sin(2 * Math.PI * 1.2 * s)) + 0.05 * gauss(r));
    const res = analyzeFlicker(t, y, { ...PULSE, refHz: 72 / 60, tolHz: 5 / 60 });
    expect(res.coincidentHz! * 60).toBeGreaterThan(70);
    expect(res.coincidentHz! * 60).toBeLessThan(74);
    expect(res.coincidentSnr).toBeGreaterThan(20);
    expect(res.bandRatio).toBeGreaterThan(0.5);
  });
  it('white noise → small band ratio and low coincident SNR', () => {
    const r = rng(2);
    const t = Array.from({ length: 360 }, (_, i) => i / 30);
    const y = t.map(() => 120 + 0.3 * gauss(r));
    const res = analyzeFlicker(t, y, { ...PULSE, refHz: 72 / 60, tolHz: 5 / 60 });
    // band covers ~24% of 0.05–5 Hz; noise should not concentrate there
    expect(res.bandRatio).toBeLessThan(0.4);
    expect(res.coincidentSnr).toBeLessThan(10);
  });
  it('too few samples returns an empty result', () => {
    const res = analyzeFlicker([0, 0.1], [1, 2], { ...PULSE, refHz: null, tolHz: 0.08 });
    expect(res.samples).toBeLessThan(8);
    expect(res.bandRatio).toBe(0);
  });
});

/** A synthetic 478-point face: rigid points + parametric mouth and jaw. */
function face(dx = 0, dy = 0, mouth = 0.05, jaw = 1.0): Point[] {
  const pts: Point[] = Array.from({ length: 478 }, (_, i) => ({ x: 300 + (i % 20) + dx, y: 200 + Math.floor(i / 20) + dy }));
  const set = (i: number, x: number, y: number) => (pts[i] = { x: x + dx, y: y + dy });
  set(LM.rightEyeOuter, 250, 200);
  set(LM.leftEyeOuter, 350, 200);
  set(LM.rightEyeInner, 280, 200);
  set(LM.leftEyeInner, 320, 200);
  set(LM.forehead, 300, 140);
  set(LM.noseBridge, 300, 205);
  set(LM.noseBridgeUpper, 300, 195);
  set(LM.noseTip, 300, 250);
  set(LM.cheekRight, 230, 240);
  set(LM.cheekLeft, 370, 240);
  set(LM.upperLipInner, 300, 280);
  set(LM.lowerLipInner, 300, 280 + mouth * 100);
  set(LM.chin, 300, 250 + jaw * 100);
  return pts;
}

describe('landmark features', () => {
  it('iod / mouth / jaw are scale-normalised', () => {
    const f = face();
    expect(iod(f)).toBe(100);
    expect(mouthAperture(f)).toBeCloseTo(0.05);
    expect(jawLength(f)).toBeCloseTo(1.0);
    expect(iod([])).toBeNull();
    expect(mouthAperture([])).toBeNull();
    expect(jawLength([])).toBeNull();
  });
  it('rigid motion: static face → 0; shifted face → shift/IOD', () => {
    expect(rigidMotion(face(), face())).toBe(0);
    expect(rigidMotion(face(), face(2, 0))).toBeCloseTo(0.02);
    expect(rigidMotion([], face())).toBeNull();
    expect(rigidMotion(face(), [])).toBeNull();
  });
  it('a static landmark array has zero micro-motion (R11 input fails)', () => {
    const frames = Array.from({ length: 90 }, () => face());
    const m = frames.slice(1).map((f, i) => rigidMotion(frames[i]!, f)!);
    expect(Math.max(...m)).toBe(0);
  });
  it('faceBox expands around the centre', () => {
    const b = faceBox([{ x: 0, y: 0 }, { x: 10, y: 10 }], 2)!;
    expect(b).toEqual({ x: -5, y: -5, w: 20, h: 20 });
    expect(faceBox([])).toBeNull();
  });
  it('maxRollingRms finds a burst', () => {
    const t = Array.from({ length: 300 }, (_, i) => i / 30);
    const v = t.map((s) => (s > 4 && s < 5 ? 0.05 : 0.001));
    expect(maxRollingRms(t, v, 1)).toBeGreaterThan(0.04);
    expect(maxRollingRms(t, t.map(() => 0.001), 1)).toBeCloseTo(0.001);
  });
});

describe('chewing (R10 math)', () => {
  const t = Array.from({ length: 300 }, (_, i) => i / 30);
  it('a 1.5 Hz jaw oscillation with talking=false fires', () => {
    const v = t.map((s) => 1 + 0.03 * Math.sin(2 * Math.PI * 1.5 * s));
    const res = chewingScore(t, v, t.map(() => false));
    expect(res.peak).toBeGreaterThan(0.5);
    expect(res.lagS!).toBeCloseTo(1 / 1.5, 1);
  });
  it('the same oscillation while talking is ignored', () => {
    const v = t.map((s) => 1 + 0.03 * Math.sin(2 * Math.PI * 1.5 * s));
    expect(chewingScore(t, v, t.map(() => true)).windows).toBe(0);
  });
  it('noise stays low', () => {
    const r = rng(3);
    const v = t.map(() => 1 + 0.01 * gauss(r));
    expect(chewingScore(t, v, t.map(() => false)).peak).toBeLessThan(0.5);
  });
});

describe('luma + ROIs', () => {
  it('BT.601 weights', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255);
    expect(luma(255, 0, 0)).toBeCloseTo(76.245);
  });
  it('roiMeanLuma over RGB and BGRA buffers agrees', () => {
    const w = 4, h = 2;
    const rgb = new Uint8Array(w * h * 3);
    const bgra = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgb.set([200, 100, 50], i * 3);
      bgra.set([50, 100, 200, 255], i * 4);
    }
    const a = roiMeanLuma(rgb, w, h, w * 3, 'RGB', { x: 0, y: 0, w: 2, h: 2 });
    const b = roiMeanLuma(bgra, w, h, w * 4, 'BGRA', { x: 0, y: 0, w: 2, h: 2 });
    expect(a).toBeCloseTo(b);
    expect(Number.isNaN(roiMeanLuma(rgb, w, h, w * 3, 'RGB', { x: 10, y: 10, w: 1, h: 1 }))).toBe(true);
  });
  it('corner ROIs and overlap', () => {
    const [l, r] = cornerRois(1280, 720);
    expect(l).toEqual({ x: 0, y: 0, w: 192, h: 144 });
    expect(r.x).toBe(1088);
    expect(rectsOverlap(l, r)).toBe(false);
    expect(rectsOverlap(l, { x: 100, y: 100, w: 10, h: 10 })).toBe(true);
  });
});

describe('OffsetEstimator', () => {
  it('tracks the median offset and ignores outliers', () => {
    const e = new OffsetEstimator(5);
    expect(e.offsetUs).toBeNull();
    expect(e.toSession(10, 99)).toBe(99);
    for (const o of [1000, 1001, 999, 50_000, 1000, 1002]) e.add(o + 5, 5);
    expect(e.offsetUs).toBe(1001);
    expect(e.toSession(10, 0)).toBe(1011);
  });
});
