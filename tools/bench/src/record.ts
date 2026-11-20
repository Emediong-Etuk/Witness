import { join } from 'node:path';
import { faceBox, median, normaliseBox, roiMeanLuma, roiLayout, type Point, type Rect } from '@witness/features';
import {
  ErrorCode, LandmarkFeatureTracker, normalizeMetrics, requestedMetrics, Status, type SourceEvent, type TraceHeader, type TraceLine,
} from '@witness/sdk-adapter';
import type { ManifestClip } from '@witness/schema';
import { feedSize, probe, rgbFrames } from './ffmpeg.js';
import type { SdkFactory } from './sdk-node.js';
import { sha256File, writeTrace } from './trace-io.js';

export interface RecordOptions {
  clip: ManifestClip;
  clipsDir: string;
  tracesDir: string;
  apiKey: string;
  createSdk: SdkFactory;
  mode?: 'quick' | 'full';
  /** ≤ 1: feed at or below real time (SDK docs: slower delivery is fine). 0 = as fast as possible (tests only). */
  speed?: number;
  /** Wait this long after the last frame for trailing callbacks. */
  settleMs?: number;
  /** Operator-supplied credit readings (from the Presage portal / MCP usage.get_plan), logged verbatim. */
  creditsBefore?: string;
  creditsAfter?: string;
  /** Label the trace as stub output (tests). */
  stub?: boolean;
  log?: (msg: string) => void;
  now?: () => number;
}

export interface RecordResult {
  file: string;
  head: string;
  sha256: string;
  meta: Record<string, unknown>;
}

const BASE_US = 1_000_000;
const STATUS_NAME: Record<number, string> = Object.fromEntries(Object.entries(Status).map(([k, v]) => [v, k]));
const ERROR_NAME: Record<number, string> = Object.fromEntries(Object.entries(ErrorCode).map(([k, v]) => [v, k]));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Feed one consented corpus clip through the main-process SDK with its own
 * timestamps (useCustomInput + sendFrame), compute the same ROI luminance
 * features the live worker computes, and write a hash-chained trace.
 * SPENDS PRESAGE CREDITS when createSdk is the real SDK.
 */
export async function recordClip(o: RecordOptions): Promise<RecordResult> {
  const log = o.log ?? (() => {});
  const now = o.now ?? (() => performance.now());
  const file = join(o.clipsDir, o.clip.file);
  const clipSha = sha256File(file);
  if (o.clip.sha256.clip && o.clip.sha256.clip !== clipSha) throw new Error(`${o.clip.id}: clip hash ${clipSha} does not match manifest ${o.clip.sha256.clip}`);
  const pr = probe(file);
  const { width: W, height: H } = feedSize(pr.width, pr.height);
  const scaled = W !== pr.width || H !== pr.height;
  if (scaled) log(`${o.clip.id}: ${pr.width}x${pr.height} scaled to ${W}x${H} for the SDK`);
  const mode = o.mode ?? 'full';
  const h = o.createSdk({ apiKey: o.apiKey, requestedMetrics: requestedMetrics(mode), telemetry: false });
  const { sdk } = h;

  const events: SourceEvent[] = [];
  const rawSdk: { kind: 'validation' | 'metrics'; ts: number; lastSent: number; code?: number; hint?: string; buf?: Uint8Array }[] = [];
  const errors: { code: number; message: string; retryable: boolean }[] = [];
  let lastSent = -1;
  let framesDropped = 0;
  let framesThrough = 0;
  sdk.on('validationStatus', ((code: number, ts: number, hint: string) => rawSdk.push({ kind: 'validation', ts: Number(ts), lastSent, code, hint })) as never);
  sdk.on('metrics', ((buf: Uint8Array, ts: number) => rawSdk.push({ kind: 'metrics', ts: Number(ts), lastSent, buf: Uint8Array.from(buf) })) as never);
  sdk.on('frameSentThrough', ((sent: boolean) => (sent ? framesThrough++ : framesDropped++)) as never);
  let terminal: { code: number; message: string } | null = null;
  sdk.on('processingStatus', ((status: number) => {
    events.push({ type: 'status', t: Math.max(0, lastSent - BASE_US), status });
    log(`${o.clip.id}: SDK status ${STATUS_NAME[status] ?? status}`);
  }) as never);
  sdk.on('error', ((code: number, message: string, retryable: boolean) => {
    errors.push({ code, message: String(message), retryable: !!retryable });
    log(`${o.clip.id}: SDK error ${code} (${ERROR_NAME[code] ?? 'unknown'}): ${String(message)}${retryable ? ' [retryable]' : ''}`);
    if (!terminal) terminal = { code, message: String(message) };
  }) as never);

  // Face box for ROI placement: from the latest landmarks seen so far (decoded on arrival).
  let box: Rect | null = null;
  const sent = new Set<number>();
  const frameEvents: SourceEvent[] = [];
  const roiKinds = new Set<string>();
  let rejected = 0;

  const startedAt = new Date().toISOString();
  const wall0 = now();
  sdk.start();
  let k = 0;
  const pts0 = pr.ptsS[0] ?? 0;
  let prevTs = 0;
  let decoded = 0;
  for await (const frame of rgbFrames(file, W, H, scaled)) {
    // The SDK reported a terminal error: stop feeding (it would only throw "not in a valid state").
    if (terminal) break;
    const pts = pr.ptsS[k] ?? pts0 + k / 30;
    let ts = BASE_US + Math.round((pts - pts0) * 1e6);
    if (ts <= prevTs) ts = prevTs + 1; // strictly increasing, as the SDK requires
    prevTs = ts;
    if (o.speed && o.speed > 0) {
      const due = wall0 + ((ts - BASE_US) / 1000) / o.speed;
      const wait = due - now();
      if (wait > 1) await sleep(wait);
    }
    // update the face box from landmarks that arrived since the last frame
    for (; decoded < rawSdk.length; decoded++) {
      const r = rawSdk[decoded]!;
      if (r.kind !== 'metrics' || !r.buf) continue;
      try {
        const n = normalizeMetrics(h.decode(r.buf), r.ts);
        const lm = n.landmarks.at(-1);
        const b = lm ? faceBox(lm.points, 1.6) : null;
        if (b) box = normaliseBox(b, W, H);
      } catch {
        /* undecodable packet: ignored for ROI placement, logged below */
      }
    }
    const L = roiLayout(W, H, box);
    roiKinds.add(L.kind);
    const step = 2;
    frameEvents.push({
      type: 'frame',
      t: ts - BASE_US,
      bg: [roiMeanLuma(frame, W, H, W * 3, 'RGB', L.bg[0], step), roiMeanLuma(frame, W, H, W * 3, 'RGB', L.bg[1], step)],
      chest: L.chest ? nullIfNaN(roiMeanLuma(frame, W, H, W * 3, 'RGB', L.chest, step)) : null,
      face: L.face ? nullIfNaN(roiMeanLuma(frame, W, H, W * 3, 'RGB', L.face, step)) : null,
    });
    let ok = false;
    try {
      ok = sdk.sendFrame(frame, W, H, W * 3, h.pixelFormatRGB, ts);
    } catch (e) {
      // Usually a consequence of an earlier SDK error; give its callback a moment to arrive.
      await sleep(200);
      if (!terminal) terminal = { code: -1, message: (e as Error).message };
      break;
    }
    if (!ok) rejected++;
    sent.add(ts);
    lastSent = ts;
    k++;
    if (k % 300 === 0) log(`${o.clip.id}: ${k}/${pr.ptsS.length} frames`);
  }
  await sleep(o.settleMs ?? 2500);
  await sdk.stopAsync().catch(() => undefined);
  await sdk.destroy();
  if (terminal) {
    const t = terminal as { code: number; message: string };
    const first = errors[0];
    throw new Error(
      `${o.clip.id}: SmartSpectra stopped after ${k} of ${pr.ptsS.length} frames. ` +
        (first ? `First SDK error: ${first.code} (${ERROR_NAME[first.code] ?? 'unknown'}): ${first.message}. ` : `sendFrame threw: ${t.message}. `) +
        'No trace was written.',
    );
  }
  const wallS = (now() - wall0) / 1000;

  // Timestamp domain: do SDK timestamps equal the ones we passed in?
  const vals = rawSdk.filter((r) => r.kind === 'validation');
  const passthrough = vals.length ? vals.filter((r) => sent.has(r.ts)).length / vals.length : 0;
  let offset = 0;
  let offsetMethod = 'passthrough';
  if (passthrough < 0.9) {
    // fall back: offset between our latest sent timestamp at arrival and the SDK's timestamp
    const diffs = rawSdk.filter((r) => r.lastSent > 0).map((r) => r.lastSent - r.ts);
    offset = diffs.length ? median(diffs) : 0;
    offsetMethod = 'arrival-median';
  }
  const toT = (ts: number) => ts + offset - BASE_US;

  const tracker = new LandmarkFeatureTracker();
  let undecodable = 0;
  for (const r of rawSdk) {
    if (r.kind === 'validation') {
      events.push({ type: 'validation', t: toT(r.ts), code: r.code!, hint: String(r.hint ?? '').slice(0, 256) });
      continue;
    }
    let n;
    try {
      n = normalizeMetrics(h.decode(r.buf!), r.ts);
    } catch {
      undecodable++;
      continue;
    }
    for (const e of n.events) events.push({ ...e, t: toT(e.t) } as SourceEvent);
    for (const l of n.landmarks) events.push(tracker.push(toT(l.t), l.points as Point[], l.reset));
  }
  for (const e of errors) events.push({ type: 'error', t: Math.max(0, lastSent - BASE_US), ...e });
  const all = [...events, ...frameEvents].sort((a, b) => a.t - b.t);

  const meta = {
    clipId: o.clip.id,
    clipSha256: clipSha,
    width: W,
    height: H,
    frames: pr.ptsS.length,
    framesSent: k,
    sendRejected: rejected,
    framesThrough,
    framesDropped,
    tsPassthrough: Number(passthrough.toFixed(4)),
    offsetMethod,
    offsetUs: offset,
    undecodablePackets: undecodable,
    errors: errors.length,
    roiKinds: [...roiKinds].sort(),
    wallS: Number(wallS.toFixed(2)),
    clipS: Number(((prevTs - BASE_US) / 1e6).toFixed(2)),
    speed: o.speed ?? 0,
    startedAt,
    creditsBefore: o.creditsBefore ?? null,
    creditsAfter: o.creditsAfter ?? null,
  };
  const header: TraceHeader = {
    type: 'header',
    v: 1,
    source: `${o.stub ? 'stub' : 'corpus'}:${o.clip.id}`,
    synthetic: !!o.stub,
    sdkVersion: h.version,
    mode,
    note: o.stub ? 'STUB SDK output for pipeline tests. Not SmartSpectra output.' : 'Recorded through the SmartSpectra SDK with useCustomInput + sendFrame and the clip’s own timestamps.',
    meta,
  };
  const lines: TraceLine[] = [header, ...all];
  const outFile = join(o.tracesDir, `${o.clip.id}.jsonl`);
  const w = writeTrace(outFile, lines);
  log(`${o.clip.id}: wrote ${outFile} (${all.length} events, chain ${w.head.slice(7, 15)}…, passthrough ${meta.tsPassthrough})`);
  return { file: outFile, ...w, meta };
}

function nullIfNaN(x: number): number | null {
  return Number.isFinite(x) ? x : null;
}
