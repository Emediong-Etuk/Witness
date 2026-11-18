import type { GateEvent, Metric } from '../src/index.js';

export function rng(seed: number) {
  // mulberry32: small, well-mixed, deterministic
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

export interface Interval {
  from: number;
  to: number;
}

export interface SynthOptions {
  durS: number;
  seed?: number;
  fps?: number;
  talking?: Interval[];
  motion?: Interval[];
  chewing?: Interval[];
  flicker?: (Interval & { hz: number; amp: number })[];
  multipleFaces?: Interval[];
  validationBad?: (Interval & { code: number })[];
  resets?: number[];
  fpsDrop?: (Interval & { fps: number })[];
  photo?: boolean;
  values?: Partial<Record<Metric, number>>;
  /** shift (µs) applied to all SDK-sourced events, to test alignment tolerance */
  sdkShiftUs?: number;
  rateEveryS?: number;
}

const inAny = (t: number, xs: Interval[] | undefined) => !!xs?.some((i) => t >= i.from && t < i.to);

/** A deterministic synthetic session: clean by default, with injectable contamination. */
export function synth(o: SynthOptions): GateEvent[] {
  const r = rng(o.seed ?? 7);
  const fps = o.fps ?? 30;
  const shift = o.sdkShiftUs ?? 0;
  const US = 1e6;
  const ev: GateEvent[] = [{ kind: 'session', t: 0, mode: 'full' }];
  ev.push({ kind: 'validation', t: 0 + shift, code: 0 });
  ev.push({ kind: 'talking', t: 0 + shift, detected: false });
  // validation episodes
  const vEdges: { t: number; code: number }[] = [];
  for (const i of o.multipleFaces ?? []) vEdges.push({ t: i.from, code: 2 }, { t: i.to, code: 0 });
  for (const i of o.validationBad ?? []) vEdges.push({ t: i.from, code: i.code }, { t: i.to, code: 0 });
  for (const e of vEdges) ev.push({ kind: 'validation', t: Math.round(e.t * US) + shift, code: e.code });
  for (const i of o.talking ?? []) {
    ev.push({ kind: 'talking', t: Math.round(i.from * US) + shift, detected: true });
    ev.push({ kind: 'talking', t: Math.round(i.to * US) + shift, detected: false });
  }
  for (const s of o.resets ?? []) ev.push({ kind: 'landmarks_reset', t: Math.round(s * US) + shift });
  if (!o.photo) for (let s = 2; s < o.durS; s += 4) ev.push({ kind: 'blink', t: Math.round(s * US) + shift, detected: true });

  const n = Math.floor(o.durS * fps);
  let skipAcc = 0;
  for (let k = 0; k < n; k++) {
    const s = k / fps;
    const drop = o.fpsDrop?.find((i) => s >= i.from && s < i.to);
    if (drop) {
      skipAcc += drop.fps / fps;
      if (skipAcc < 1) continue;
      skipAcc -= 1;
    }
    const t = Math.round(s * US);
    let bg = 120 + 0.15 * gauss(r);
    let bg2 = 118 + 0.15 * gauss(r);
    for (const f of o.flicker ?? []) {
      if (s >= f.from && s < f.to) {
        const m = 1 + f.amp * Math.sin(2 * Math.PI * f.hz * s);
        bg *= m;
        bg2 *= m;
      }
    }
    ev.push({ kind: 'frame', t, bg: [bg, bg2], chest: 80, face: 140 });
    const moving = inAny(s, o.motion);
    const motion = o.photo ? 0 : moving ? 0.05 + 0.02 * Math.abs(gauss(r)) : 0.0015 + 0.0008 * Math.abs(gauss(r));
    const chew = inAny(s, o.chewing);
    const mouth = 0.05 + 0.002 * gauss(r) + (chew ? 0.03 * Math.sin(2 * Math.PI * 1.5 * s) : 0);
    const jaw = 1.0 + 0.002 * gauss(r) + (chew ? 0.02 * Math.sin(2 * Math.PI * 1.5 * s) : 0);
    ev.push({ kind: 'face_feature', t: t + shift, motion, mouth, jaw });
  }
  const vals: Record<Metric, number> = { pulse: 70, breathing: 14, hrv: 45, ...o.values };
  const every = o.rateEveryS ?? 1;
  for (let s = every; s <= o.durS; s += every) {
    const t = Math.round(s * US) + shift;
    for (const m of ['pulse', 'breathing', 'hrv'] as const) {
      ev.push({ kind: 'rate', t, metric: m, value: vals[m] + 0.3 * gauss(r), confidence: 80, stable: true });
    }
  }
  return ev;
}

export function lastSample(ev: GateEvent[], metric: Metric, atOrBeforeS = Infinity) {
  const xs = ev.filter((e): e is Extract<GateEvent, { kind: 'rate' }> => e.kind === 'rate' && e.metric === metric && e.t <= atOrBeforeS * 1e6);
  return xs[xs.length - 1]!;
}
