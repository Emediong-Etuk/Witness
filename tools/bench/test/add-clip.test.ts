import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildClipEntry, clipFps, MIN_FPS, parseInterval, type AddClipArgs } from '../src/add-clip.js';
import { probe } from '../src/ffmpeg.js';
import { sha256File } from '../src/trace-io.js';

const empty = { v: 1 as const, clips: [] };
const args = (o: Partial<AddClipArgs> = {}): AddClipArgs => ({
  id: 'B1', file: 'B1.mp4', title: 'Still and quiet (phone)', condition: 'baseline', split: 'calibration', intervals: [],
  wholeClip: false, camera: 'phone front camera', lighting: 'daylight', subject: 'S1', consent: true, publishVideo: false,
  fitzpatrick: null, at: '2026-11-20T18:00:00.000Z', ...o,
});
const facts = (fps: number, seconds: number) => ({ width: 1280, height: 720, sha256: 'sha256:' + 'a'.repeat(64), ptsS: Array.from({ length: Math.round(fps * seconds) }, (_, i) => i / fps) });

function makeClip(dir: string, name: string, fps: number, seconds: number): string {
  const f = join(dir, name);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=320x240:rate=${fps}`, '-t', String(seconds), '-pix_fmt', 'yuv420p', f]);
  return f;
}

describe('bench add-clip', () => {
  it('reads the frame rate from timestamps', () => {
    expect(clipFps(facts(30, 2).ptsS)).toBeCloseTo(30, 5);
    expect(clipFps([0, 0.04, 0.04, 0.08, 0.12])).toBeCloseTo(25, 5);
    expect(clipFps([1])).toBeNull();
  });
  it('parses labelled intervals and rejects malformed ones', () => {
    expect(parseInterval('talking:25-45')).toEqual({ condition: 'talking', fromS: 25, toS: 45 });
    expect(() => parseInterval('talking:45-25')).toThrow(/after start/);
    expect(() => parseInterval('singing:1-2')).toThrow();
    expect(() => parseInterval('talking 25-45')).toThrow(/look like/);
  });
  it('builds a schema-valid, consent-attested entry with the clip hash', () => {
    const { clip, fps, durationS } = buildClipEntry(args({ id: 'T1', condition: 'talking', intervals: ['talking:25-45'] }), facts(30, 60), empty);
    expect(fps).toBeCloseTo(30, 3);
    expect(durationS).toBeGreaterThan(59);
    expect(clip).toMatchObject({ id: 'T1', resolution: '1280x720', groundTruth: null, consent: { attested: true, subject: 'S1', publishVideo: false }, sha256: { trace: null } });
    expect(clip.intervals).toEqual([{ condition: 'talking', fromS: 25, toS: 45 }]);
  });
  it('refuses without consent, below the SDK frame-rate floor, duplicates, and labels past the end', () => {
    expect(() => buildClipEntry(args({ consent: false }), facts(30, 10), empty)).toThrow(/--i-consent/);
    expect(() => buildClipEntry(args(), facts(16, 10), empty)).toThrow(new RegExp(`needs ${MIN_FPS}`));
    const { clip } = buildClipEntry(args(), facts(30, 10), empty);
    expect(() => buildClipEntry(args(), facts(30, 10), { v: 1, clips: [clip] })).toThrow(/already/);
    expect(() => buildClipEntry(args({ intervals: ['talking:5-30'] }), facts(30, 10), empty)).toThrow(/past the end/);
  });
  it('works on real encoded files through probe (30 fps passes, 15 fps is refused)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'witness-clip-'));
    const ok = makeClip(dir, 'B1.mp4', 30, 3);
    const p = probe(ok);
    const r = buildClipEntry(args(), { ...p, sha256: sha256File(ok) }, empty);
    expect(r.fps).toBeCloseTo(30, 1);
    expect(r.clip.resolution).toBe('320x240');
    expect(r.clip.sha256.clip).toMatch(/^sha256:[0-9a-f]{64}$/);
    const slow = makeClip(dir, 'B2.mp4', 15, 3);
    expect(() => buildClipEntry(args({ id: 'B2', file: 'B2.mp4' }), { ...probe(slow), sha256: sha256File(slow) }, empty)).toThrow(/15\.0 fps/);
  });
});
