import { median } from './dsp.js';

export interface Point {
  x: number;
  y: number;
}

/**
 * MediaPipe Face Mesh indices (478-point topology including irises).
 * Assumption, stated rather than verified: the SDK's landmark stream uses this
 * numbering. It is not yet checked against a real SDK trace; the features that
 * use these points fail closed if the landmarks are missing.
 */
export const LM = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  leftEyeOuter: 263,
  leftEyeInner: 362,
  forehead: 10,
  noseBridge: 6,
  noseBridgeUpper: 168,
  noseTip: 1,
  cheekRight: 234,
  cheekLeft: 454,
  upperLipInner: 13,
  lowerLipInner: 14,
  chin: 152,
} as const;

export const RIGID = [LM.forehead, LM.noseBridge, LM.noseBridgeUpper, LM.noseTip, LM.cheekRight, LM.cheekLeft, LM.rightEyeOuter, LM.rightEyeInner, LM.leftEyeOuter, LM.leftEyeInner] as const;

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function pt(pts: readonly Point[], i: number): Point | null {
  const p = pts[i];
  return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
}

/** Inter-ocular distance (outer eye corners). Scale reference for every landmark feature. */
export function iod(pts: readonly Point[]): number | null {
  const a = pt(pts, LM.rightEyeOuter);
  const b = pt(pts, LM.leftEyeOuter);
  if (!a || !b) return null;
  const d = dist(a, b);
  return d > 0 ? d : null;
}

/** Median displacement of the rigid subset between consecutive frames, in IOD units. */
export function rigidMotion(prev: readonly Point[], cur: readonly Point[]): number | null {
  const scale = iod(cur);
  if (!scale) return null;
  const d: number[] = [];
  for (const i of RIGID) {
    const a = pt(prev, i);
    const b = pt(cur, i);
    if (a && b) d.push(dist(a, b));
  }
  if (d.length < 3) return null;
  return median(d) / scale;
}

export function mouthAperture(pts: readonly Point[]): number | null {
  const s = iod(pts);
  const a = pt(pts, LM.upperLipInner);
  const b = pt(pts, LM.lowerLipInner);
  return s && a && b ? dist(a, b) / s : null;
}

export function jawLength(pts: readonly Point[]): number | null {
  const s = iod(pts);
  const a = pt(pts, LM.chin);
  const b = pt(pts, LM.noseTip);
  return s && a && b ? dist(a, b) / s : null;
}

/** Axis-aligned face box from landmarks, expanded by `expand` around its centre. */
export function faceBox(pts: readonly Point[], expand = 1.6): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  if (!Number.isFinite(x0)) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const w = (x1 - x0) * expand, h = (y1 - y0) * expand;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Maximum over the window of the trailing `winS`-second RMS of `v`.
 * Samples at times `tS` (seconds, ascending).
 */
export function maxRollingRms(tS: ArrayLike<number>, v: ArrayLike<number>, winS: number): number {
  let best = 0;
  let j = 0;
  let sumSq = 0;
  for (let i = 0; i < tS.length; i++) {
    sumSq += v[i]! * v[i]!;
    while (tS[i]! - tS[j]! > winS) {
      sumSq -= v[j]! * v[j]!;
      j++;
    }
    const n = i - j + 1;
    const rms = Math.sqrt(Math.max(0, sumSq) / n);
    if (rms > best) best = rms;
  }
  return best;
}
