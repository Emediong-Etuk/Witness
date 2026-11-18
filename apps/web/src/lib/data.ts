// Everything the site shows is bundled at build time from the repository.
// Missing files mean "not produced yet"; the UI says so instead of inventing values.
import { configHash, GATE_V1, type GateConfig } from '@witness/gate';
import type { Results } from '@witness/bench-core';
import consentStrings from '../../../desktop/src/renderer/strings/en.json';
import desktopPkg from '../../../desktop/package.json';

const one = (m: Record<string, string>): string | null => Object.values(m)[0] ?? null;
const byName = (m: Record<string, string>, ext: string) =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k.split('/').pop()!.replace(ext, ''), v]));

const manifestRaw = import.meta.glob('../../../../corpus/manifest.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const tracesRaw = import.meta.glob('../../../../corpus/traces/*.jsonl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const receiptsRaw = import.meta.glob('../../../../corpus/receipts/*.jsonl', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const resultsRaw = import.meta.glob('../../../../bench/out/results.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const egressRunsRaw = import.meta.glob(['../../../../bench/out/egress/*.json', '!../../../../bench/out/egress/*.probe.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const readme = import.meta.glob('../../../../README.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const docsRaw = import.meta.glob('../../../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const gateConfig: GateConfig = GATE_V1;
export const gateHash = configHash(GATE_V1);
export const manifestText = one(manifestRaw);
export const traces = byName(tracesRaw, '.jsonl');
export const receipts = byName(receiptsRaw, '.jsonl');
export const resultsText = one(resultsRaw);
export const results: Results | null = resultsText ? (JSON.parse(resultsText) as Results) : null;
export const sdkVersion = (desktopPkg as { dependencies: Record<string, string> }).dependencies['@smartspectra/node-sdk'] ?? 'unknown';
export const consent = consentStrings as Record<string, string>;

const docs = byName(docsRaw, '');
/** Docs whose embedded numbers the in-browser verifier checks (same set as the CLI). */
export const markerDocs: Record<string, string> = {
  ...(one(readme) !== null ? { 'README.md': one(readme)! } : {}),
  ...Object.fromEntries(Object.entries(docs).filter(([k]) => k !== 'EGRESS.md').map(([k, v]) => [`docs/${k}`, v])),
};
export const egress = { runs: byName(egressRunsRaw, ''), doc: docs['EGRESS.md'] ?? null };

export const manifestClips = (manifestText ? (JSON.parse(manifestText) as { clips: { id: string; condition: string; split: string; title: string }[] }).clips : []);
export const recordedCount = Object.keys(traces).length;

export const stage: 'no-clips' | 'recording' | 'calibrated' | 'results' =
  results ? 'results' : gateConfig.calibration.status === 'CALIBRATED' ? 'calibrated' : recordedCount > 0 ? 'recording' : 'no-clips';
