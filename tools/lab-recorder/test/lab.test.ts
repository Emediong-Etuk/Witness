import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, expect as pw } from '@playwright/test';
import { ManifestSchema } from '@witness/schema';
import { probe } from '../../bench/src/ffmpeg.js';
import { recordClip } from '../../bench/src/record.js';
import type { NodeSdkLike, SdkFactory } from '../../bench/src/sdk-node.js';
import { readTrace } from '../../bench/src/trace-io.js';
import { labelledIntervals, PLAN, REACTION_PAD_S, TEST_TEMPLATE } from '../src/plan.js';
import { startLab, type Lab } from '../src/server.js';

let lab: Lab;
let root: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'witness-lab-'));
  lab = await startLab({ root, test: true, token: 'test-token-123456' });
});
afterAll(() => lab.close());

const call = (path: string, init: RequestInit & { token?: string | null } = {}) => {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.token !== null) headers['X-Lab-Token'] = init.token ?? lab.token;
  return fetch(lab.url.replace(/\/$/, '') + path, { ...init, headers });
};

describe('clip plan', () => {
  it('covers every §13.2 condition with consistent ids, and pads labels for reaction time', () => {
    const ids = PLAN.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => PLAN.find((t) => t.id === id)!.star)).toEqual(['B1', 'B2', 'T1', 'G1', 'M1', 'F1', 'F2', 'F4', 'P1', 'R1', 'R2']);
    expect(new Set(PLAN.map((t) => t.condition)).size).toBe(13);
    const t1 = PLAN.find((t) => t.id === 'T1')!;
    expect(labelledIntervals(t1)).toEqual([{ condition: 'talking', fromS: 25 - REACTION_PAD_S, toS: 45 + REACTION_PAD_S }]);
    for (const t of PLAN) for (const c of t.cues) expect(c.atS).toBeLessThan(t.durationS);
  });
});

describe('lab server', () => {
  it('serves pages, refuses API calls without the token and misdirected hosts', async () => {
    const page = await (await call('/', { token: null })).text();
    expect(page).toContain('lab-token');
    expect((await call('/api/plan', { token: null })).status).toBe(403);
    expect((await call('/api/plan', { token: 'wrong-token-1234567' })).status).toBe(403);
    // DNS rebinding: a request whose Host isn't our loopback name is refused (fetch can't set Host, so use node:http)
    const status = await new Promise<number>((res, rej) => {
      const rq = request({ host: '127.0.0.1', port: lab.port, path: '/', headers: { Host: 'evil.example' } }, (r) => {
        r.resume();
        res(r.statusCode ?? 0);
      });
      rq.on('error', rej);
      rq.end();
    });
    expect(status).toBe(421);
    expect((await call('/api/plan')).status).toBe(200);
  });
  it('refuses uploads without consent or for clips outside the plan, and never overwrites silently', async () => {
    const body = new Uint8Array([1, 2, 3]);
    expect((await call('/api/clip', { method: 'POST', body, headers: { 'X-Clip-Id': 'B1' } })).status).toBe(400);
    expect((await call('/api/clip', { method: 'POST', body, headers: { 'X-Clip-Id': 'Q7', 'X-Consent': 'attested' } })).status).toBe(400);
    const ok = await call('/api/clip', { method: 'POST', body, headers: { 'X-Clip-Id': 'B1', 'X-Consent': 'attested', 'Content-Type': 'video/webm' } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).sha256).toBe('sha256:' + createHash('sha256').update(body).digest('hex'));
    expect((await call('/api/clip', { method: 'POST', body, headers: { 'X-Clip-Id': 'B1', 'X-Consent': 'attested' } })).status).toBe(409);
    expect((await call('/api/clip?replace=1', { method: 'POST', body, headers: { 'X-Clip-Id': 'B1', 'X-Consent': 'attested' } })).status).toBe(200);
  });
  it('validates manifest entries (subject label, clip hash) before writing', async () => {
    const sha = 'sha256:' + createHash('sha256').update(new Uint8Array([1, 2, 3])).digest('hex');
    const base = { id: 'B1', file: 'B1.webm', clipSha256: sha, consentAt: '2026-11-19T10:00:00.000Z', subject: 'S1', fitzpatrick: null, camera: 'c', lighting: 'l', resolution: '1280x720', publishVideo: false, pulse: [], device: 'ox' };
    const post = (b: object) => call('/api/entry', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } });
    expect((await post({ ...base, subject: 'Greg' })).status).toBe(400);
    expect((await post({ ...base, clipSha256: 'sha256:' + '0'.repeat(64) })).status).toBe(400);
    expect((await post(base)).status).toBe(200);
    const m = ManifestSchema.parse(JSON.parse(readFileSync(join(root, 'corpus/manifest.json'), 'utf8')));
    expect(m.clips[0]).toMatchObject({ id: 'B1', condition: 'baseline', split: 'calibration', groundTruth: null, sha256: { clip: sha, trace: null } });
  });
});

describe('end to end: recorder page → clip → bench (fake camera, stub SDK, no credits)', () => {
  it('records the 4-s test clip with cues, saves the entry, and the bench can read and record it', async () => {
    const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(lab.url);
    await page.locator('button[data-id="Z1"]').click();
    await page.locator('#cam').filter({ hasText: '@' }).waitFor({ timeout: 15_000 });
    await pw(page.locator('#go')).toBeDisabled();
    await page.locator('#c1').check();
    await page.locator('#go').click();
    await page.locator('#cue.start').waitFor({ timeout: 10_000 }); // "Start reading." at 1 s
    await page.locator('#cue.stop').waitFor({ timeout: 10_000 }); // "Stop." at 3 s
    await page.locator('#subject').waitFor({ timeout: 30_000 });
    await page.locator('#pulse').fill('1 70\n3 71');
    await page.locator('#save').click();
    await page.getByText('Z1 is in the manifest').waitFor({ timeout: 10_000 });
    await browser.close();
    expect(errors).toEqual([]);

    const m = ManifestSchema.parse(JSON.parse(readFileSync(join(root, 'corpus/manifest.json'), 'utf8')));
    const z = m.clips.find((c) => c.id === 'Z1')!;
    expect(z.intervals).toEqual(labelledIntervals(TEST_TEMPLATE));
    expect(z.groundTruth!.pulse).toEqual([{ tS: 1, bpm: 70 }, { tS: 3, bpm: 71 }]);
    expect(z.consent).toMatchObject({ attested: true, subject: 'S1', publishVideo: false });
    const file = join(root, 'corpus/clips', z.file);
    expect(existsSync(file)).toBe(true);

    // the bench reads the recording frame by frame with per-frame timestamps
    const pr = probe(file);
    expect(pr.ptsS.length).toBeGreaterThan(60);
    expect(pr.ptsS.at(-1)! - pr.ptsS[0]!).toBeGreaterThan(3);
    // and records it through a stub SDK into a valid trace
    const stub: SdkFactory = () => {
      const h: Record<string, (...a: never[]) => void> = {};
      const sdk: NodeSdkLike = {
        on: (ev, cb) => (h[ev] = cb), useCustomInput: () => sdk, start: () => {},
        sendFrame: (_b, _w, _h, _s, _f, ts) => {
          queueMicrotask(() => (h.validationStatus as unknown as (c: number, t: number, s: string) => void)(0, ts, ''));
          return true;
        },
        stopAsync: async () => {}, destroy: async () => {},
      };
      return { sdk, version: 'stub-0', decode: () => ({}), pixelFormatRGB: 0 };
    };
    const r = await recordClip({ clip: z, clipsDir: join(root, 'corpus/clips'), tracesDir: join(root, 'corpus/traces'), apiKey: 'unused', createSdk: stub, speed: 0, settleMs: 10, stub: true });
    expect(r.meta.framesSent).toBe(pr.ptsS.length);
    expect(r.meta.tsPassthrough).toBe(1);
    expect(readTrace(r.file).lines.filter((l) => l.type === 'frame')).toHaveLength(pr.ptsS.length);
  }, 120_000);
});
