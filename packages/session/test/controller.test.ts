import { describe, expect, it } from 'vitest';
import { syntheticTrace, TraceReplaySdk, type Scenario } from '@witness/sdk-adapter';
import { SessionController, type CheckinRecord } from '../src/index.js';
import { FakeClock } from './fake-clock.js';

function setup(scenario: Scenario, mode: 'quick' | 'full' = 'full') {
  const clock = new FakeClock();
  let created = 0;
  const done: CheckinRecord[] = [];
  const c = new SessionController({
    createSource: (m) => {
      created++;
      return new TraceReplaySdk(syntheticTrace(scenario, { mode: m }), { clock, tickMs: 33 });
    },
    now: clock.now,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    coachHoldMs: 0,
    newId: () => 'ses_test',
    onComplete: (r) => done.push(r),
  });
  return { c, clock, done, created: () => created };
}

describe('SessionController with synthetic replay', () => {
  it('creates no source (no camera) until consent is accepted', async () => {
    const s = setup('clean');
    s.c.checkIn('full');
    expect(s.c.phase).toBe('consent');
    s.clock.advance(5000);
    expect(s.created()).toBe(0);
    s.c.decline();
    expect(s.c.phase).toBe('idle');
    expect(s.created()).toBe(0);
    s.c.checkIn('full');
    await s.c.accept();
    expect(s.created()).toBe(1);
    expect(s.c.phase).toBe('measuring');
  });

  it('clean full check-in: progressive results, then auto-complete with 3 verified values', async () => {
    const s = setup('clean');
    s.c.checkIn('full');
    await s.c.accept();
    s.clock.advance(20_000);
    const v20 = s.c.snapshot;
    expect(v20.metrics.pulse.shown).not.toBeNull();
    expect(v20.metrics.breathing.shown).toBeNull();
    s.clock.advance(60_000);
    expect(s.c.phase).toBe('complete');
    expect(s.done).toHaveLength(1);
    expect(s.done[0]!.results.map((r) => r.metric).sort()).toEqual(['breathing', 'hrv', 'pulse']);
    expect(s.done[0]!.results.every((r) => r.receipt.verdict === 'VERIFIED')).toBe(true);
    expect(s.done[0]!.stoppedBy).toBe('complete');
  });

  it('quick mode needs only pulse', async () => {
    const s = setup('clean', 'quick');
    s.c.checkIn('quick');
    await s.c.accept();
    s.clock.advance(25_000);
    expect(s.c.phase).toBe('complete');
    expect(s.done[0]!.results.map((r) => r.metric)).toEqual(['pulse']);
  });

  it('talking: breathing is withheld with R7 while the SDK says stable, and recovers after', async () => {
    const s = setup('talking');
    s.c.checkIn('full');
    await s.c.accept();
    s.clock.advance(45_000);
    const b = s.c.snapshot.metrics.breathing;
    expect(b.status).toBe('withheld');
    expect(b.reasons[0]).toBe('R7_QUIET');
    expect(b.latest!.sdk.stable).toBe(true);
    expect(s.c.snapshot.coaching?.text).toMatch(/You spoke/);
    expect(b.countdownS).toBeGreaterThan(0);
    s.clock.advance(40_000);
    expect(s.done[0]!.withheldStable.some((w) => w.metric === 'breathing' && w.reasons.includes('R7_QUIET'))).toBe(true);
  });

  it('multiple faces pauses the session, then resumes', async () => {
    const s = setup('multiple_faces');
    s.c.checkIn('full');
    await s.c.accept();
    s.clock.advance(26_000);
    expect(s.c.phase).toBe('paused');
    expect(s.c.snapshot.coaching?.from).toBe('paused');
    s.clock.advance(4_000);
    expect(s.c.phase).toBe('measuring');
  });

  it('72/min flicker: pulse withheld for steady light', async () => {
    const s = setup('flicker72');
    s.c.checkIn('quick');
    await s.c.accept();
    s.clock.advance(29_000);
    const p = s.c.snapshot.metrics.pulse;
    expect(p.shown).toBeNull();
    expect(p.reasons).toContain('R9_STEADY_LIGHT');
    expect(s.c.snapshot.coaching?.text).toMatch(/flickering at about 7\d\/min/);
  });

  it('hide() stops the source within one tick and ends the check-in', async () => {
    const s = setup('clean');
    s.c.checkIn('full');
    await s.c.accept();
    s.clock.advance(5_000);
    s.c.hide();
    await Promise.resolve();
    expect(s.c.phase).toBe('complete');
    expect(s.done[0]!.stoppedBy).toBe('hidden');
    const before = s.c.snapshot.receiptCount;
    s.clock.advance(5_000);
    expect(s.c.snapshot.receiptCount).toBe(before);
  });

  it('session cap ends the check-in', async () => {
    const clock = new FakeClock();
    const c = new SessionController({
      createSource: (m) => new TraceReplaySdk(syntheticTrace('talking', { mode: m, durS: 80 }), { clock }),
      capS: 10, now: clock.now, setInterval: clock.setInterval, clearInterval: clock.clearInterval,
    });
    c.checkIn('full');
    await c.accept();
    clock.advance(11_000);
    expect(c.phase).toBe('complete');
  });

  it('an SDK error moves to error with the code and never restarts', async () => {
    const clock = new FakeClock();
    const lines = syntheticTrace('clean', { mode: 'quick', durS: 5 });
    lines.push({ type: 'error', t: 2_000_000, code: 14, message: 'sustained low frame rate', retryable: false });
    const c = new SessionController({ createSource: () => new TraceReplaySdk(lines, { clock }), now: clock.now, setInterval: clock.setInterval, clearInterval: clock.clearInterval });
    c.checkIn('quick');
    await c.accept();
    clock.advance(3_000);
    expect(c.phase).toBe('error');
    expect(c.snapshot.error?.code).toBe(14);
  });
});
