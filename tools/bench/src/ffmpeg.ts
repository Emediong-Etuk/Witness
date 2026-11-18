import { execFileSync, spawn } from 'node:child_process';

export interface Probe {
  width: number;
  height: number;
  /** Per-frame presentation times in seconds, in decode order. */
  ptsS: number[];
}

export function probe(file: string): Probe {
  const json = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', file],
    { maxBuffer: 256 * 1024 * 1024 },
  ).toString('utf8');
  const d = JSON.parse(json) as { streams: { width: number; height: number }[]; frames: { best_effort_timestamp_time?: string }[] };
  const s = d.streams[0];
  if (!s) throw new Error(`${file}: no video stream`);
  const ptsS = d.frames.map((f) => Number(f.best_effort_timestamp_time));
  if (ptsS.some((x) => !Number.isFinite(x))) throw new Error(`${file}: frame without a timestamp`);
  return { width: s.width, height: s.height, ptsS };
}

/** Decode to packed RGB24 frames, one Buffer per frame, in decode order (no frame-rate conversion). */
export async function* rgbFrames(file: string, width: number, height: number): AsyncGenerator<Buffer> {
  const size = width * height * 3;
  const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-fps_mode', 'passthrough', '-'], {
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
