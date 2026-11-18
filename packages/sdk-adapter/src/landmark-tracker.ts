import { jawLength, mouthAperture, rigidMotion, type Point } from '@witness/features';
import type { SourceEvent } from './events.js';

/**
 * Turns landmark sets into three scalars per packet (rigid motion, mouth
 * aperture, jaw length; all in IOD units) and keeps only the previous set in
 * memory for the motion difference. Coordinates are never emitted.
 */
export class LandmarkFeatureTracker {
  private prev: Point[] | null = null;

  push(t: number, points: Point[], reset: boolean): Extract<SourceEvent, { type: 'face_feature' }> {
    const motion = this.prev && !reset ? rigidMotion(this.prev, points) : null;
    this.prev = points;
    return { type: 'face_feature', t, motion, mouth: mouthAperture(points), jaw: jawLength(points) };
  }

  reset(): void {
    this.prev = null;
  }
}
