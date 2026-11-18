let ctx: AudioContext | null = null;
/** Soft two-note chime on a verified metric. Generated, no asset files. */
export function chime(): void {
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (const [i, f] of [660, 990].entries()) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, now + i * 0.09);
      g.gain.linearRampToValueAtTime(0.05, now + i * 0.09 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.09 + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.09);
      o.stop(now + i * 0.09 + 0.65);
    }
  } catch {
    /* audio unavailable */
  }
}
