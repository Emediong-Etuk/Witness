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
