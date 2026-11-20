import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GATE_V1 } from '@witness/gate';
import { ManifestSchema, type ManifestClip } from '@witness/schema';
import { syntheticTrace, type Scenario, type TraceLine } from '@witness/sdk-adapter';
import { calibrate, type ClipTrace } from '../src/calibrate.js';
import { freezeStatus } from '../src/git.js';
import { consentedClip, isContaminated } from '../src/manifest.js';
import { recordClip } from '../src/record.js';
import { buildReport, groundTruth, renderTables, replayTrace } from '@witness/bench-core';
import type { NodeSdkLike, SdkFactory } from '../src/sdk-node.js';
import { ChainError, readTrace, writeTrace } from '../src/trace-io.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'witness-bench-'));

function clip(id: string, condition: ManifestClip['condition'], split: ManifestClip['split'], extra: Partial<ManifestClip> = {}): ManifestClip {
  return {
    id, title: id, condition, split, file: `${id}.mp4`, intervals: [], wholeClip: false,
    groundTruth: { device: 'test', pulse: [{ tS: 0, bpm: 68 }, { tS: 90, bpm: 68 }] },
    consent: { attested: true, subject: 'S1', at: '2026-11-18T12:00:00.000Z', publishVideo: false },
    subject: { fitzpatrick: null }, camera: 'test', lighting: 'test', resolution: '320x180',
    sha256: { clip: null, trace: null }, ...extra,
  };
}

describe('trace I/O', () => {
  it('round-trips and detects tampering', () => {
    const d = tmp();
    const f = join(d, 'x.jsonl');
    const lines = syntheticTrace('clean', { mode: 'quick', durS: 3 });
    const w = writeTrace(f, lines);
    const r = readTrace(f);
    expect(r.head).toBe(w.head);
    expect(r.sha256).toBe(w.sha256);
    expect(r.lines.length).toBe(lines.length);
    const text = readFileSync(f, 'utf8').replace('"status":3', '"status":4');
    writeFileSync(f, text);
    expect(() => readTrace(f)).toThrow(ChainError);
  });
});

describe('manifest consent gate', () => {
  it('only listed clips can be recorded', () => {
    const m = ManifestSchema.parse({ v: 1, clips: [clip('B1', 'baseline', 'calibration')] });
    expect(consentedClip(m, 'B1').id).toBe('B1');
    expect(() => consentedClip(m, 'B9')).toThrow(/not in corpus/);
  });
  it('a clip without consent cannot even be listed', () => {
    const bad = { ...clip('B1', 'baseline', 'calibration'), consent: { attested: false } };
    expect(ManifestSchema.safeParse({ v: 1, clips: [bad] }).success).toBe(false);
  });
  it('contamination follows the documented metric map', () => {
    const t = clip('T1', 'talking', 'heldout', { intervals: [{ condition: 'talking', fromS: 25, toS: 45 }] });
    expect(isContaminated(t, 'breathing', 10, 40).yes).toBe(true);
    expect(isContaminated(t, 'pulse', 10, 40).yes).toBe(false);
    expect(isContaminated(t, 'breathing', 46, 60).yes).toBe(false);
    const p = clip('P1', 'photo', 'heldout', { wholeClip: true });
    expect(isContaminated(p, 'hrv', 0, 60).conditions).toEqual(['photo']);
  });
});

describe('record (stub SDK, ffmpeg-generated clip, no credits)', () => {
  it('feeds every frame with its own timestamp and writes a privacy-safe trace', async () => {
    const d = tmp();
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '4', '-c:v', 'libx264', '-crf', '12', '-pix_fmt', 'yuv420p', join(d, 'Z1.mp4')]);
    const sentTs: number[] = [];
    const face = Array.from({ length: 478 }, (_, i) => ({ x: 120 + (i % 20) * 4, y: 50 + Math.floor(i / 20) * 3 }));
    const stub: SdkFactory = () => {
      const h: Record<string, (...a: never[]) => void> = {};
      const sdk: NodeSdkLike = {
        on: (ev, cb) => (h[ev] = cb),
        useCustomInput: () => sdk,
        start: () => {},
        sendFrame: (_b, _w, _h, _s, _f, ts) => {
          sentTs.push(ts);
          queueMicrotask(() => {
            (h.validationStatus as unknown as (c: number, t: number, s: string) => void)(0, ts, '');
            (h.frameSentThrough as unknown as (s: boolean, t: number) => void)(true, ts);
            const payload = { face: { landmarks: [{ value: face, timestamp: ts }], talking: [{ detected: false, timestamp: ts }] }, cardio: sentTs.length % 30 === 0 ? { pulseRate: [{ value: 70, confidence: 80, stable: true, timestamp: ts }] } : undefined };
            (h.metrics as unknown as (b: Uint8Array, t: number) => void)(new TextEncoder().encode(JSON.stringify(payload)), ts);
          });
          return true;
        },
        stopAsync: async () => {},
        destroy: async () => {},
      };
      return { sdk, version: 'stub-0', decode: (b) => JSON.parse(new TextDecoder().decode(b)), pixelFormatRGB: 0 };
    };
    const r = await recordClip({ clip: clip('Z1', 'baseline', 'calibration', { file: 'Z1.mp4' }), clipsDir: d, tracesDir: d, apiKey: 'unused', createSdk: stub, speed: 0, settleMs: 10, stub: true });
    expect(r.meta.framesSent).toBe(120);
    expect(r.meta.frames).toBe(120);
    expect(r.meta.tsPassthrough).toBe(1);
    expect(r.meta.offsetMethod).toBe('passthrough');
    expect(new Set(sentTs).size).toBe(120);
    expect(sentTs.every((t, i) => i === 0 || t > sentTs[i - 1]!)).toBe(true);
    const tr = readTrace(r.file);
    const types = (k: string) => tr.lines.filter((l) => l.type === k).length;
    expect(types('frame')).toBe(120);
    expect(types('validation')).toBe(120);
    expect(types('rate')).toBe(4);
    expect(types('face_feature')).toBe(120);
    expect(tr.lines.find((l) => l.type === 'frame')!.t).toBe(0);
    expect(tr.lines[0]).toMatchObject({ type: 'header', source: 'stub:Z1', synthetic: true, sdkVersion: 'stub-0' });
    const text = readFileSync(r.file, 'utf8');
    expect(text).not.toMatch(/"x":/);
    expect(text).not.toMatch(/landmarks"/);
    // replay is deterministic
    expect(replayTrace(tr.lines, GATE_V1).chainHead).toBe(replayTrace(tr.lines, GATE_V1).chainHead);
  });
});

describe('record: SDK failures and large clips', () => {
  const mk = (d: string, name: string, size: string, secs: number) =>
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`, '-t', String(secs), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(d, name)]);
  const baseStub = (onSend: (h: Record<string, (...a: never[]) => void>, n: number, w: number, hgt: number) => boolean): SdkFactory => () => {
    const h: Record<string, (...a: never[]) => void> = {};
    let n = 0;
    const sdk: NodeSdkLike = {
      on: (ev, cb) => (h[ev] = cb), useCustomInput: () => sdk, start: () => {},
      sendFrame: (_b, w, hgt) => onSend(h, ++n, w, hgt),
      stopAsync: async () => {}, destroy: async () => {},
    };
    return { sdk, version: 'stub-0', decode: () => ({}), pixelFormatRGB: 0 };
  };
  it('stops at the first SDK error, names it, and writes no trace', async () => {
    const d = tmp();
    mk(d, 'Z2.mp4', '320x180', 3);
    let sends = 0;
    const logs: string[] = [];
    const stub = baseStub((h, n) => {
      sends = n;
      if (n === 10) (h.error as unknown as (c: number, m: string, r: boolean) => void)(5, 'network unreachable', true);
      if (n > 10) throw new Error('SmartSpectra is not in a valid state for this operation');
      return true;
    });
    await expect(recordClip({ clip: clip('Z2', 'baseline', 'calibration', { file: 'Z2.mp4' }), clipsDir: d, tracesDir: d, apiKey: 'x', createSdk: stub, speed: 0, settleMs: 5, stub: true, log: (s) => logs.push(s) }))
      .rejects.toThrow(/after 10 of 90 frames\. First SDK error: 5 \(networkError\): network unreachable\. No trace was written/);
    expect(sends).toBe(10);
    expect(logs.some((l) => l.includes('SDK error 5 (networkError)'))).toBe(true);
    expect(() => readFileSync(join(d, 'Z2.jsonl'))).toThrow();
  });
  it('scales clips wider than 1280 to 1280-wide frames before sending', async () => {
    const d = tmp();
    mk(d, 'Z3.mp4', '1920x1080', 1);
    const sizes = new Set<string>();
    const r = await recordClip({ clip: clip('Z3', 'baseline', 'calibration', { file: 'Z3.mp4' }), clipsDir: d, tracesDir: d, apiKey: 'x', createSdk: baseStub((_h, _n, w, hgt) => (sizes.add(`${w}x${hgt}`), true)), speed: 0, settleMs: 5, stub: true });
    expect([...sizes]).toEqual(['1280x720']);
    expect(r.meta).toMatchObject({ width: 1280, height: 720, framesSent: 30 });
  });
});

describe('calibrate → report on labelled SYNTHETIC traces (pipeline test, not a result)', { timeout: 120_000 }, () => {
  const mk = (id: string, s: Scenario, c: ManifestClip, seed: number): ClipTrace => {
    const lines = syntheticTrace(s, { mode: 'full', seed }) as TraceLine[];
    return { clip: c, lines, traceSha256: 'sha256:' + '0'.repeat(64) };
  };
  const cal = [
    mk('B1', 'clean', clip('B1', 'baseline', 'calibration'), 1),
    mk('B3', 'clean', clip('B3', 'baseline', 'calibration'), 3),
    mk('T1', 'talking', clip('T1', 'talking', 'calibration', { intervals: [{ condition: 'talking', fromS: 35, toS: 50 }] }), 4),
  ];
  const held = [
    mk('B2', 'clean', clip('B2', 'baseline', 'heldout'), 2),
    mk('T2', 'talking', clip('T2', 'talking', 'heldout', { intervals: [{ condition: 'talking', fromS: 35, toS: 50 }] }), 5),
    mk('F1', 'flicker72', clip('F1', 'flicker', 'heldout', { flickerHz: 1.2, intervals: [{ condition: 'flicker', fromS: 3, toS: 80 }] }), 6),
    mk('G1', 'chewing', clip('G1', 'chewing', 'heldout', { intervals: [{ condition: 'chewing', fromS: 10, toS: 32 }] }), 7),
  ];
  it('calibrate refuses held-out clips', () => {
    expect(() => calibrate([...cal, held[0]!], GATE_V1)).toThrow(/held-out/);
  });
  let calibrated: ReturnType<typeof calibrate>;
  it('calibrate computes thresholds from clean calibration readings only', () => {
    const res = (calibrated = calibrate(cal, GATE_V1, new Date('2026-11-20T00:00:00Z')));
    expect(res.calibratedKeys).toContain('still.maxRms');
    expect(res.config.calibration.status).not.toBe('UNCALIBRATED');
    expect(res.config.still.maxRms).toBeCloseTo(res.stats['still.maxRms']!.p99! * 1.5, 5);
    expect((res.config.calibration as unknown as { clips: { id: string }[] }).clips.map((c) => c.id)).toEqual(['B1', 'B3', 'T1']);
    expect(res.curves.find((c) => c.rule === 'R7_QUIET')!.points.some((p) => (p.targetDetectRate ?? 0) > 0)).toBe(true);
  });
  it('report applies the fixed definitions and labels synthetic/unfrozen output', () => {
    const cfg = calibrated.config;
    const r = buildReport({ traces: held, cfg, freeze: { frozen: false, reason: 'test', tag: 'm4', tagCommit: null, head: null }, gitHead: null });
    expect(r.synthetic).toBe(true);
    expect(r.overall.readings).toBeGreaterThan(0);
    expect(r.perCondition.talking!.readings).toBeGreaterThan(0);
    expect(r.perCondition.talking!.witnessFAR.value).toBe(0);
    expect(r.overall.sdkFalseTrust.value).toBeGreaterThan(0);
    expect(r.overall.sdkFalseTrust.clusters).toBe(4);
    expect(r.flicker[0]!.flickerPerMin).toBe(72);
    expect(r.friction.pulse!.verifiedIn).toBe(1);
    const md = renderTables(r);
    expect(md).toMatch(/SYNTHETIC\/STUB DATA/);
    expect(md).toMatch(/UNFROZEN THRESHOLDS/);
    expect(() => buildReport({ traces: cal, cfg, freeze: { frozen: true, reason: 'ok', tag: 'm4', tagCommit: null, head: null }, gitHead: null })).toThrow(/held-out/);
  });
  it('ground truth: window mean from oximeter points, paced breathing rate, no HRV truth', () => {
    const c = clip('R1', 'paced_breathing', 'heldout', { pacedBreathingBrpm: 6, groundTruth: { device: 'ox', pulse: [{ tS: 0, bpm: 60 }, { tS: 20, bpm: 80 }] } });
    expect(groundTruth(c, 'pulse', 0, 20)).toBeCloseTo(70, 5);
    expect(groundTruth(c, 'breathing', 0, 30)).toBe(6);
    expect(groundTruth(c, 'hrv', 0, 60)).toBeNull();
  });
});

describe('freeze check', () => {
  it('requires the tag, ancestry, and an unchanged config', () => {
    const d = tmp();
    const g = (...a: string[]) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
    g('init', '-q');
    g('config', 'user.email', 't@example.invalid');
    g('config', 'user.name', 't');
    execFileSync('mkdir', ['-p', join(d, 'packages/gate/config')]);
    writeFileSync(join(d, 'packages/gate/config/gate.v1.json'), '{"a":1}');
    g('add', '.');
    g('commit', '-qm', 'c1');
    expect(freezeStatus(d).frozen).toBe(false);
    g('tag', 'm4-thresholds-frozen');
    expect(freezeStatus(d)).toMatchObject({ frozen: true });
    writeFileSync(join(d, 'packages/gate/config/gate.v1.json'), '{"a":2}');
    expect(freezeStatus(d).reason).toMatch(/changed/);
  });
});
