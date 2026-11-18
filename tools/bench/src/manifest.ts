import { readFileSync } from 'node:fs';
import { ManifestSchema, type Manifest, type ManifestClip } from '@witness/schema';

export function loadManifest(file: string): Manifest {
  return ManifestSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * The consent gate. Only clips listed in the manifest, with a consent
 * attestation, can ever be fed to the SDK (BUILD_PROMPT §4.3).
 */
export function consentedClip(m: Manifest, id: string): ManifestClip {
  const c = m.clips.find((x) => x.id === id);
  if (!c) throw new Error(`clip ${id} is not in corpus/manifest.json; the bench only processes consented, listed clips`);
  if (c.consent.attested !== true) throw new Error(`clip ${id} has no consent attestation`);
  return c;
}

export { CONTAMINATES, isContaminated } from '@witness/bench-core';
