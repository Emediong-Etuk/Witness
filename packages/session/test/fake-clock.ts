import type { Clock } from '@witness/sdk-adapter';

/** Manual clock: intervals fire only when advance() is called. */
export class FakeClock implements Clock {
  t = 0;
  private next = 1;
  private readonly timers = new Map<number, { fn: () => void; ms: number; due: number }>();
  now = () => this.t;
  setInterval = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.timers.set(id, { fn, ms, due: this.t + ms });
    return id;
  };
  clearInterval = (h: unknown) => {
    this.timers.delete(h as number);
  };
  advance(ms: number, step = 33): void {
    const end = this.t + ms;
    while (this.t < end) {
      this.t = Math.min(end, this.t + step);
      for (const tm of [...this.timers.values()]) {
        while (tm.due <= this.t && [...this.timers.values()].includes(tm)) {
          tm.due += tm.ms;
          tm.fn();
        }
      }
    }
  }
}
