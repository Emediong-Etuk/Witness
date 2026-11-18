import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface BenchPaths {
  manifest: string;
  clips: string;
  traces: string;
  receipts: string;
  out: string;
  gateConfig: string;
}

export function defaultPaths(root = REPO): BenchPaths {
  return {
    manifest: join(root, 'corpus/manifest.json'),
    clips: join(root, 'corpus/clips'),
    traces: join(root, 'corpus/traces'),
    receipts: join(root, 'corpus/receipts'),
    out: join(root, 'bench/out'),
    gateConfig: join(root, 'packages/gate/config/gate.v1.json'),
  };
}
