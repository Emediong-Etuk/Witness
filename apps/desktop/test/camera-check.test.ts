import { describe, expect, it } from 'vitest';
import { assessCamera, fpsFromTimestamps, GOOD_FPS, SDK_MIN_FPS } from '../src/renderer/camera-check';

const sample = (fps: number | null, luma: number | null = 120, frames = 90) => ({ fps, luma, width: 1280, height: 720, frames });

describe('fpsFromTimestamps', () => {
  it('counts intervals over the span, in any order', () => {
    const ts = Array.from({ length: 31 }, (_, i) => i * 33_333);
    expect(fpsFromTimestamps(ts)).toBeCloseTo(30, 1);
    expect(fpsFromTimestamps([...ts].reverse())).toBeCloseTo(30, 1);
  });
  it('needs two frames and a non-zero span', () => {
    expect(fpsFromTimestamps([])).toBeNull();
    expect(fpsFromTimestamps([5])).toBeNull();
    expect(fpsFromTimestamps([5, 5])).toBeNull();
  });
});

describe('assessCamera', () => {
  it('passes a healthy camera', () => {
    expect(assessCamera(sample(30))).toMatchObject({ ok: true, level: 'good' });
    expect(assessCamera(sample(GOOD_FPS))).toMatchObject({ ok: true, level: 'good' });
  });
  it('lets a camera just above the SDK floor start, with a warning', () => {
    expect(assessCamera(sample(SDK_MIN_FPS + 0.5))).toMatchObject({ ok: true, level: 'borderline' });
  });
  it('stops a camera below the SDK floor, and says light when the picture is dim', () => {
    const dim = assessCamera(sample(15, 30));
    expect(dim).toMatchObject({ ok: false, level: 'slow' });
    expect(dim.reason).toMatch(/15 fps/);
    expect(dim.reason).toMatch(/window or a lamp/);
    const bright = assessCamera(sample(20, 140));
    expect(bright.reason).toMatch(/low-light compensation/);
  });
  it('flags a black picture before the frame rate (shutter, IR camera)', () => {
    expect(assessCamera(sample(30, 3))).toMatchObject({ ok: false, level: 'black' });
    expect(assessCamera(sample(15, 3)).reason).toMatch(/infrared/);
  });
  it('flags a camera that sends no frames', () => {
    expect(assessCamera(sample(null, null, 0))).toMatchObject({ ok: false, level: 'none' });
    expect(assessCamera(sample(30, 100, 1))).toMatchObject({ ok: false, level: 'none' });
  });
});
