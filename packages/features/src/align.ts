import { median } from './dsp.js';

/**
 * Running median of (arrival − sourceTimestamp) for one event source, used to
 * map SDK and VideoFrame timestamps onto one monotonic session clock (µs).
 */
export class OffsetEstimator {
  private readonly buf: number[] = [];
  constructor(private readonly size = 101) {}

  add(arrivalUs: number, sourceUs: number): void {
    this.buf.push(arrivalUs - sourceUs);
    if (this.buf.length > this.size) this.buf.shift();
  }

  get offsetUs(): number | null {
    return this.buf.length ? median(this.buf) : null;
  }

  toSession(sourceUs: number, fallbackArrivalUs: number): number {
    const o = this.offsetUs;
    return o === null ? fallbackArrivalUs : sourceUs + o;
  }
}
