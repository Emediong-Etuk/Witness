import { createRequire } from 'node:module';
import type { DecodedMetricsLike } from '@witness/sdk-adapter';

/** The slice of the main-process SmartSpectraSDK the bench uses. */
export interface NodeSdkLike {
  on(event: string, cb: (...args: never[]) => void): unknown;
  useCustomInput(frameTransform?: number): unknown;
  start(): void;
  sendFrame(buf: Uint8Array, width: number, height: number, stride: number, pixelFormat: number, timestampUs: number): boolean;
  stopAsync(): Promise<void>;
  destroy(): Promise<void>;
}

export interface SdkHandle {
  sdk: NodeSdkLike;
  version: string;
  decode: (buf: Uint8Array) => DecodedMetricsLike;
  pixelFormatRGB: number;
}

export interface SdkFactoryOptions {
  apiKey: string;
  requestedMetrics: number[];
  telemetry: boolean;
}

export type SdkFactory = (o: SdkFactoryOptions) => SdkHandle;

/** The real SDK. Spends Presage credits. */
export const realSdk: SdkFactory = (o) => {
  const req = createRequire(import.meta.url);
  const m = req('@smartspectra/node-sdk') as {
    SmartSpectraSDK: (new (opts: object) => NodeSdkLike) & { version: string };
    PixelFormat: { kRGB: number };
    FrameTransform: { kNone: number };
    SmartSpectraLogLevel: { kWarning: number };
  };
  const msgs = req('@smartspectra/node-sdk/messages') as { decodeMetrics: (b: Uint8Array) => DecodedMetricsLike };
  const sdk = new m.SmartSpectraSDK({
    apiKey: o.apiKey,
    requestedMetrics: o.requestedMetrics,
    enableTelemetry: o.telemetry,
    enableAccumulatedOutput: false,
    logLevel: m.SmartSpectraLogLevel.kWarning,
  });
  sdk.useCustomInput(m.FrameTransform.kNone);
  return { sdk, version: m.SmartSpectraSDK.version, decode: msgs.decodeMetrics, pixelFormatRGB: m.PixelFormat.kRGB };
};

/** Read the key from the environment or a local .env. Never printed. */
export function apiKeyFromEnv(root: string): string | null {
  if (process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY;
  try {
    const req = createRequire(import.meta.url);
    const fs = req('node:fs') as typeof import('node:fs');
    const text = fs.readFileSync(`${root}/.env`, 'utf8');
    const m = /^\s*SMARTSPECTRA_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(text);
    return m?.[1]?.trim() || null;
  } catch {
    return null;
  }
}
