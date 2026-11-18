/** BT.601 luma. The same function is used by the bench (ffmpeg RGB) and the live worker (VideoFrame). */
export function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type PixelLayout = 'RGB' | 'BGR' | 'RGBA' | 'BGRA' | 'RGBX' | 'BGRX';

const LAYOUT: Record<PixelLayout, { bpp: number; r: number; g: number; b: number }> = {
  RGB: { bpp: 3, r: 0, g: 1, b: 2 },
  BGR: { bpp: 3, r: 2, g: 1, b: 0 },
  RGBA: { bpp: 4, r: 0, g: 1, b: 2 },
  RGBX: { bpp: 4, r: 0, g: 1, b: 2 },
  BGRA: { bpp: 4, r: 2, g: 1, b: 0 },
  BGRX: { bpp: 4, r: 2, g: 1, b: 0 },
};

/** Mean luma over a rectangle of a packed frame. `step` subsamples pixels for speed. */
export function roiMeanLuma(
  buf: ArrayLike<number>,
  width: number,
  height: number,
  stride: number,
  layout: PixelLayout,
  rect: Rect,
  step = 1,
): number {
  const L = LAYOUT[layout];
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.floor(rect.x + rect.w));
  const y1 = Math.min(height, Math.floor(rect.y + rect.h));
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y += step) {
    const row = y * stride;
    for (let x = x0; x < x1; x += step) {
      const o = row + x * L.bpp;
      s += luma(buf[o + L.r]!, buf[o + L.g]!, buf[o + L.b]!);
      n++;
    }
  }
  return n > 0 ? s / n : NaN;
}

/** Default ROI layout: two top-corner background patches, 15% × 20% of the frame. */
export function cornerRois(width: number, height: number): [Rect, Rect] {
  const w = Math.round(width * 0.15);
  const h = Math.round(height * 0.2);
  return [
    { x: 0, y: 0, w, h },
    { x: width - w, y: 0, w, h },
  ];
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export interface RoiLayout {
  bg: [Rect, Rect];
  chest: Rect | null;
  face: Rect | null;
  /** Which background layout was used ("corners" or "side-bands"); logged per session. */
  kind: 'corners' | 'side-bands';
}

/**
 * ROI layout shared by the live feature worker and the bench, so both paths
 * measure the same regions. `faceBoxNorm` is the 1.6×-expanded face box in
 * normalised [0,1] frame coordinates (or null before landmarks arrive).
 */
export function roiLayout(width: number, height: number, faceBoxNorm: Rect | null): RoiLayout {
  let [a, b] = cornerRois(width, height);
  let kind: RoiLayout['kind'] = 'corners';
  const fb = faceBoxNorm ? { x: faceBoxNorm.x * width, y: faceBoxNorm.y * height, w: faceBoxNorm.w * width, h: faceBoxNorm.h * height } : null;
  if (fb && (rectsOverlap(a, fb) || rectsOverlap(b, fb))) {
    a = { x: 0, y: height * 0.3, w: width * 0.08, h: height * 0.4 };
    b = { x: width * 0.92, y: height * 0.3, w: width * 0.08, h: height * 0.4 };
    kind = 'side-bands';
  }
  const chest = fb ? { x: fb.x + fb.w * 0.25, y: fb.y + fb.h * 0.95, w: fb.w * 0.5, h: fb.h * 0.25 } : null;
  const face = fb ? { x: fb.x + fb.w * 0.38, y: fb.y + fb.h * 0.3, w: fb.w * 0.24, h: fb.h * 0.12 } : null;
  return { bg: [a, b], chest, face, kind };
}

/** Landmarks may be normalised or in pixels; return a normalised box either way. */
export function normaliseBox(b: Rect, width: number, height: number): Rect {
  const normalised = Math.max(b.x + b.w, b.y + b.h) <= 1.6;
  return normalised ? b : { x: b.x / width, y: b.y / height, w: b.w / width, h: b.h / height };
}
