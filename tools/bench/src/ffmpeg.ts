import { execFileSync, spawn } from 'node:child_process';

export interface Probe {
  /** Frame size as ffmpeg decodes it, i.e. after applying the rotation flag (phones store portrait video sideways). */
  width: number;
  height: number;
  /** Size as stored in the file, before rotation. */
  storedWidth: number;
  storedHeight: number;
  /** Display rotation in degrees (0, 90, 180, 270). */
  rotation: number;
  /** Per-frame presentation times in seconds, in decode order. */
  ptsS: number[];
}

export function probe(file: string): Probe {
  const json = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_side_data=rotation:stream_tags=rotate', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file],
    { maxBuffer: 256 * 1024 * 1024 },
  ).toString('utf8');
  const d = JSON.parse(json) as {
    streams: { width: number; height: number; side_data_list?: { rotation?: number }[]; tags?: { rotate?: string } }[];
    frames: { best_effort_timestamp_time?: string }[];
  };
  const s = d.streams[0];
  if (!s) throw new Error(`${file}: no video stream`);
  const ptsS = d.frames.map((f) => Number(f.best_effort_timestamp_time));
  if (ptsS.some((x) => !Number.isFinite(x))) throw new Error(`${file}: frame without a timestamp`);
  const rotation = normaliseRotation(s.side_data_list?.find((x) => typeof x.rotation === 'number')?.rotation ?? Number(s.tags?.rotate ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return { width: swap ? s.height : s.width, height: swap ? s.width : s.height, storedWidth: s.width, storedHeight: s.height, rotation, ptsS };
}

export function normaliseRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/** The SDK's pipeline is tuned for 1280×720; larger clips are scaled so their long side is at most this. */
export const MAX_FEED_SIDE = 1280;

/** Output size for feeding: long side at most MAX_FEED_SIDE, aspect kept, even dimensions. */
export function feedSize(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= MAX_FEED_SIDE) return { width, height };
  const k = MAX_FEED_SIDE / long;
  const even = (x: number) => Math.max(2, Math.round((x * k) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * Decode to packed RGB24 frames, one Buffer per frame, in presentation order
 * (no frame-rate conversion). With a size different from the source, frames
 * are scaled to it.
 */
export async function* rgbFrames(file: string, width: number, height: number, scale = false): AsyncGenerator<Buffer> {
  const size = width * height * 3;
  const vf = scale ? ['-vf', `scale=${width}:${height}:flags=bicubic`] : [];
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', ...vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', '-'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let err = '';
  ff.stderr.on('data', (d: Buffer) => (err += d.toString()));
  let pending: Buffer = Buffer.alloc(0);
  for await (const chunk of ff.stdout as AsyncIterable<Buffer>) {
    pending = pending.length ? Buffer.concat([pending, chunk]) : Buffer.from(chunk);
    while (pending.length >= size) {
      yield Buffer.from(pending.subarray(0, size));
      pending = pending.subarray(size);
    }
  }
  const code: number = await new Promise((r) => (ff.exitCode !== null ? r(ff.exitCode) : ff.on('close', (c) => r(c ?? 0))));
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.trim()}`);
}
