import type { Metric } from '@witness/gate';
import type { Condition, ManifestClip } from '@witness/schema';

/**
 * Which metrics each condition is documented to invalidate (SmartSpectra
 * model cards, "does not work when"). This is the definition of
 * "contaminated" used by the report; it is fixed before the held-out run.
 */
export const CONTAMINATES: Record<Condition, Metric[]> = {
  baseline: [],
  paced_breathing: [],
  exercise: [],
  low_light: [],
  // pulse/HRV: large head/body motion, chewing gum, flickering illumination
  // breathing: talking, large body motion, dark clothing
  talking: ['breathing'],
  chewing: ['pulse', 'hrv'],
  motion: ['pulse', 'breathing', 'hrv'],
  flicker: ['pulse', 'hrv'],
  tv_light: ['pulse', 'hrv'],
  generator_light: ['pulse', 'hrv'],
  dark_clothing: ['breathing'],
  // Not a model-card condition, but a reading from a photo or a second
  // person cannot be the user's: Witness treats these as contaminated.
  photo: ['pulse', 'breathing', 'hrv'],
  second_person: ['pulse', 'breathing', 'hrv'],
};

/** Does [fromS, toS] (clip seconds) contain a documented-invalid condition for this metric? */
export function isContaminated(clip: ManifestClip, metric: Metric, fromS: number, toS: number): { yes: boolean; conditions: Condition[] } {
  const hits = new Set<Condition>();
  if (clip.wholeClip && CONTAMINATES[clip.condition].includes(metric)) hits.add(clip.condition);
  for (const iv of clip.intervals) {
    if (CONTAMINATES[iv.condition].includes(metric) && iv.fromS < toS && iv.toS > fromS) hits.add(iv.condition);
  }
  return { yes: hits.size > 0, conditions: [...hits].sort() };
}
