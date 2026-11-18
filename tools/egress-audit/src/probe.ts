#!/usr/bin/env node
// Headless SDK probe for the egress audit (§7.6 tests a–c, §13.7 matrix).
// SPENDS PRESAGE CREDITS. It measures the person at the camera, so it refuses
// to run without --i-am-the-subject. It never prints the API key and never
// stores insight text: only counts, request ids and byte sizes.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestedMetrics } from '@witness/sdk-adapter';

const argv = process.argv.slice(2);
const opt = (n: string, d?: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const flag = (n: string) => argv.includes(`--${n}`);

async function main() {
  if (!flag('i-am-the-subject')) {
    console.error('probe: measures whoever is in front of the camera. Re-run with --i-am-the-subject to confirm it is you.');
    process.exit(2);
  }
  const mode = (opt('mode', 'full') as 'quick' | 'full');
  const telemetry = opt('telemetry', 'off') === 'on';
  const listener = opt('insight-listener', 'on') === 'on';
  const durationS = Number(opt('duration', '180'));
  const key = process.env.SMARTSPECTRA_API_KEY ?? keyFromDotEnv();
  if (!key) {
    console.error('probe: no SMARTSPECTRA_API_KEY in the environment or .env');
    process.exit(2);
  }
  const req = createRequire(import.meta.url);
  const m = req('@smartspectra/node-sdk') as {
    SmartSpectraSDK: (new (o: object) => {
      on(ev: string, cb: (...a: never[]) => void): unknown;
      useCamera(sel: unknown): unknown;
      start(): void;
      stopAsync(): Promise<void>;
      destroy(): Promise<void>;
    }) & { version: string };
    CameraSelection: { default: unknown };
  };
  const sdk = new m.SmartSpectraSDK({ apiKey: key, requestedMetrics: requestedMetrics(mode), enableTelemetry: telemetry, enableAccumulatedOutput: false });
  const t0 = Date.now();
  const s = { metricsPackets: 0, validation: 0, errors: [] as { code: number; message: string }[], insights: [] as { tS: number; requestId: number; bytes: number }[], statuses: [] as { tS: number; status: number }[] };
  sdk.on('metrics', (() => s.metricsPackets++) as never);
  sdk.on('validationStatus', (() => s.validation++) as never);
  sdk.on('processingStatus', ((st: number) => s.statuses.push({ tS: (Date.now() - t0) / 1000, status: st })) as never);
  sdk.on('error', ((code: number, message: string) => s.errors.push({ code, message: String(message).slice(0, 200) })) as never);
  if (listener) sdk.on('insight', ((buf: Uint8Array, requestId: number) => s.insights.push({ tS: (Date.now() - t0) / 1000, requestId, bytes: buf?.length ?? 0 })) as never);
  sdk.useCamera(m.CameraSelection.default);
  sdk.start();
  await new Promise((r) => setTimeout(r, durationS * 1000));
  await sdk.stopAsync();
  await sdk.destroy();
  const summary = {
    sdkVersion: m.SmartSpectraSDK.version, mode, telemetry, insightListener: listener, durationS,
    metricsPackets: s.metricsPackets, validationEvents: s.validation, errors: s.errors, statuses: s.statuses,
    // Witness never calls requestInsight in the probe, so every insight received was dispatched by the SDK on its own.
    insightsReceived: listener ? s.insights.length : null,
    insightsUnrequested: listener ? s.insights.length : null,
    insights: s.insights,
  };
  const out = process.env.WITNESS_PROBE_OUT;
  if (out) writeFileSync(out, JSON.stringify(summary, null, 2));
  console.log(`probe: ${mode}, telemetry ${telemetry ? 'on' : 'off'}, listener ${listener ? 'on' : 'off'}: ${s.metricsPackets} metrics packets, ${listener ? s.insights.length : 'n/a'} insights, ${s.errors.length} errors`);
}

function keyFromDotEnv(): string | undefined {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
    const m = /^\s*SMARTSPECTRA_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(join(root, '.env'), 'utf8'));
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

main().catch((e: Error) => {
  console.error(`probe: ${e.message}`);
  process.exit(1);
});
