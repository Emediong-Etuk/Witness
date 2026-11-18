import type { GateEvent } from '@witness/gate';
import type { SourceEvent } from './events.js';

/**
 * Stateful SourceEvent → GateEvent mapper. Piecewise states (validation code,
 * talking) are emitted only when they change; that's lossless for the gate,
 * which holds each state until the next event.
 */
export class GateEventMapper {
  private lastCode: number | null = null;
  private lastTalking: boolean | null = null;

  constructor(private readonly mode: 'quick' | 'full') {}

  start(t = 0): GateEvent[] {
    this.lastCode = null;
    this.lastTalking = null;
    return [{ kind: 'session', t, mode: this.mode }];
  }

  map(e: SourceEvent): GateEvent[] {
    switch (e.type) {
      case 'validation':
        if (e.code === this.lastCode) return [];
        this.lastCode = e.code;
        return [{ kind: 'validation', t: e.t, code: e.code }];
      case 'rate':
        return [{ kind: 'rate', t: e.t, metric: e.metric, value: e.value, confidence: e.confidence, stable: e.stable }];
      case 'face': {
        const out: GateEvent[] = [];
        if (e.talking !== null && e.talking !== this.lastTalking) {
          this.lastTalking = e.talking;
          out.push({ kind: 'talking', t: e.t, detected: e.talking });
        }
        if (e.blinking) out.push({ kind: 'blink', t: e.t, detected: true });
        if (e.landmarksReset) out.push({ kind: 'landmarks_reset', t: e.t });
        return out;
      }
      case 'face_feature':
        return [{ kind: 'face_feature', t: e.t, motion: e.motion, mouth: e.mouth, jaw: e.jaw }];
      case 'frame':
        return [{ kind: 'frame', t: e.t, bg: e.bg, chest: e.chest, face: e.face }];
      default:
        return [];
    }
  }
}
