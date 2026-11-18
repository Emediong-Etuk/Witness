// Feature worker: reads only small regions of each camera frame, turns them
// into a few luminance numbers, and closes the frame immediately. No pixels,
// images or landmark coordinates leave this worker.
import { cornerRois, luma, rectsOverlap, type Rect } from '@witness/features';

interface FaceBox { x: number; y: number; w: number; h: number }
type In =
  | { type: 'start'; readable: ReadableStream<VideoFrame> }
  | { type: 'face'; box: FaceBox | null }
  | { type: 'stop' };

const W = 320;
const H = 180;
let face: FaceBox | null = null;
let running = false;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function meanLuma(img: ImageData, r: Rect): number | null {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.floor(r.x + r.w)), y1 = Math.min(img.height, Math.floor(r.y + r.h));
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4;
      s += luma(img.data[o]!, img.data[o + 1]!, img.data[o + 2]!);
      n++;
    }
  }
  return n ? s / n : null;
}

function layout(): { bg: [Rect, Rect]; chest: Rect | null; face: Rect | null; roi: string } {
  let [a, b] = cornerRois(W, H);
  let roi = 'corners';
  const fb = face ? { x: face.x * W, y: face.y * H, w: face.w * W, h: face.h * H } : null;
  if (fb && (rectsOverlap(a, fb) || rectsOverlap(b, fb))) {
    a = { x: 0, y: H * 0.3, w: W * 0.08, h: H * 0.4 };
    b = { x: W * 0.92, y: H * 0.3, w: W * 0.08, h: H * 0.4 };
    roi = 'side-bands';
  }
  // face box here is the 1.6× expanded box; derive chest and forehead/cheek patches from it
  const chest = fb ? { x: fb.x + fb.w * 0.25, y: fb.y + fb.h * 0.95, w: fb.w * 0.5, h: fb.h * 0.25 } : null;
  const fc = fb ? { x: fb.x + fb.w * 0.38, y: fb.y + fb.h * 0.3, w: fb.w * 0.24, h: fb.h * 0.12 } : null;
  return { bg: [a, b], chest, face: fc, roi };
}

async function pump(readable: ReadableStream<VideoFrame>): Promise<void> {
  const reader = readable.getReader();
  canvas = new OffscreenCanvas(W, H);
  ctx = canvas.getContext('2d', { willReadFrequently: true });
  running = true;
  let lastRoi = '';
  while (running) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) break;
    const ts = frame.timestamp;
    const arrival = (performance.timeOrigin + performance.now()) * 1000;
    try {
      ctx!.drawImage(frame, 0, 0, W, H);
    } finally {
      frame.close();
    }
    const t0 = performance.now();
    const img = ctx!.getImageData(0, 0, W, H);
    const L = layout();
    const bgA = meanLuma(img, L.bg[0]) ?? 0;
    const bgB = meanLuma(img, L.bg[1]) ?? 0;
    const msg = {
      type: 'frame' as const,
      ts,
      arrival,
      bg: [bgA, bgB] as [number, number],
      chest: L.chest ? meanLuma(img, L.chest) : null,
      face: L.face ? meanLuma(img, L.face) : null,
      workMs: performance.now() - t0,
      roi: L.roi !== lastRoi ? L.roi : undefined,
    };
    lastRoi = L.roi;
    (self as unknown as Worker).postMessage(msg);
  }
  reader.releaseLock();
}

self.onmessage = (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === 'start') void pump(m.readable);
  else if (m.type === 'face') face = m.box;
  else if (m.type === 'stop') running = false;
};
