import { ConditionSchema, ManifestClipSchema, type Condition, type Manifest, type ManifestClip } from '@witness/schema';

/** SmartSpectra stops a session that stays below this; a clip under it can't produce readings. */
export const MIN_FPS = 25;

export interface AddClipArgs {
  id: string;
  file: string;
  title: string;
  condition: Condition;
  split: 'calibration' | 'heldout';
  /** "talking:25-45" style labels, seconds from the start of the clip. */
  intervals: string[];
  wholeClip: boolean;
  camera: string;
  lighting: string;
  subject: string;
  /** The subject agreed to this clip being recorded and processed. Required. */
  consent: boolean;
  publishVideo: boolean;
  fitzpatrick: number | null;
  notes?: string;
  at: string;
}

export interface ClipFacts {
  width: number;
  height: number;
  ptsS: number[];
  sha256: string;
}

/** Median frame rate from presentation times (robust to a few duplicated or dropped frames). */
export function clipFps(ptsS: number[]): number | null {
  const d: number[] = [];
  for (let i = 1; i < ptsS.length; i++) {
    const x = ptsS[i]! - ptsS[i - 1]!;
    if (x > 0) d.push(x);
  }
  if (!d.length) return null;
  d.sort((a, b) => a - b);
  const mid = d[Math.floor(d.length / 2)]!;
  return 1 / mid;
}

export function parseInterval(s: string): { condition: Condition; fromS: number; toS: number } {
  const m = /^([a-z_]+):([0-9.]+)-([0-9.]+)$/.exec(s);
  if (!m) throw new Error(`interval "${s}" must look like talking:25-45`);
  const condition = ConditionSchema.parse(m[1]);
  const fromS = Number(m[2]);
  const toS = Number(m[3]);
  if (!(toS > fromS)) throw new Error(`interval "${s}": end must be after start`);
  return { condition, fromS, toS };
}

/**
 * Pure: builds and validates a manifest entry for a clip recorded elsewhere
 * (e.g. on a phone), refusing anything the bench can't honestly use.
 */
export function buildClipEntry(a: AddClipArgs, f: ClipFacts, m: Manifest): { clip: ManifestClip; fps: number; durationS: number } {
  if (!a.consent) throw new Error('refusing: pass --i-consent to attest that the person in this clip agreed to it being recorded and processed');
  if (m.clips.some((c) => c.id === a.id)) throw new Error(`clip ${a.id} is already in the manifest`);
  const fps = clipFps(f.ptsS);
  if (fps === null) throw new Error(`${a.file}: no frame timestamps`);
  if (fps < MIN_FPS) throw new Error(`${a.file}: ${fps.toFixed(1)} fps; SmartSpectra needs ${MIN_FPS} or more, so this clip can't produce readings`);
  const durationS = (f.ptsS.at(-1) ?? 0) - (f.ptsS[0] ?? 0);
  const intervals = a.intervals.map(parseInterval);
  for (const iv of intervals) {
    if (iv.toS > durationS + 0.5) throw new Error(`interval ${iv.condition}:${iv.fromS}-${iv.toS} runs past the end of the clip (${durationS.toFixed(1)} s)`);
  }
  const clip = ManifestClipSchema.parse({
    id: a.id,
    title: a.title,
    condition: a.condition,
    split: a.split,
    file: a.file,
    intervals,
    wholeClip: a.wholeClip,
    groundTruth: null,
    consent: { attested: true, subject: a.subject, at: a.at, publishVideo: a.publishVideo },
    subject: { fitzpatrick: a.fitzpatrick },
    camera: a.camera,
    lighting: a.lighting,
    resolution: `${f.width}x${f.height}`,
    ...(a.notes ? { notes: a.notes } : {}),
    sha256: { clip: f.sha256, trace: null },
  });
  return { clip, fps, durationS };
}
