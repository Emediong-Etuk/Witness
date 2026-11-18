import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { syntheticTrace, TraceReplaySdk } from '@witness/sdk-adapter';
import { SessionController, type CheckinRecord } from '@witness/session';
import { DataStore, type Wrapper } from '../src/main/datastore';
import { SettingsStore, DEFAULT_SETTINGS } from '../src/main/settings';
import { CheckinSchema, KeySchema, type Checkin } from '../src/shared/ipc-schema';

/** Stand-in for safeStorage: XOR "wrap" so tests can tell wrapped from raw. */
const fakeWrap = (available = true): Wrapper => ({
  available: () => available,
  wrap: (b) => Buffer.from(b.map((x) => x ^ 0x5a)),
  unwrap: (b) => Buffer.from(b.map((x) => x ^ 0x5a)),
});

async function realCheckin(scenario: 'clean' | 'talking' = 'clean'): Promise<CheckinRecord> {
  let now = 0;
  const timers: (() => void)[] = [];
  const clock = { now: () => now, setInterval: (fn: () => void) => (timers.push(fn), timers.length), clearInterval: () => {} };
  let rec: CheckinRecord | null = null;
  const c = new SessionController({
    createSource: (m) => new TraceReplaySdk(syntheticTrace(scenario, { mode: m }), { clock }),
    now: clock.now, setInterval: clock.setInterval, clearInterval: () => {}, newId: () => 'ses_store_test',
    onComplete: (r) => (rec = r),
  });
  c.checkIn('full');
  await c.accept();
  for (let i = 0; i < 900 && !rec; i++) {
    now += 100;
    for (const f of [...timers]) f();
  }
  return rec!;
}

describe('DataStore (encrypted history)', () => {
  it('round-trips, and nothing on disk is plaintext', async () => {
    const root = mkdtempSync(join(tmpdir(), 'witness-'));
    const s = new DataStore<Checkin>(root, fakeWrap());
    const rec = CheckinSchema.parse(await realCheckin());
    s.save(rec);
    const s2 = new DataStore<Checkin>(root, fakeWrap());
    expect(s2.list()).toEqual([rec]);
    for (const f of readdirSync(join(root, 'witness-data'))) {
      const raw = readFileSync(join(root, 'witness-data', f), 'utf8');
      expect(raw).not.toContain('pulse');
      expect(raw).not.toContain('"value"');
      expect(raw).not.toContain('VERIFIED');
    }
  });
  it('purges by retention and deletes everything', async () => {
    const root = mkdtempSync(join(tmpdir(), 'witness-'));
    const s = new DataStore<Checkin>(root, fakeWrap());
    const base = CheckinSchema.parse(await realCheckin());
    s.save({ ...base, id: 'ses_old_one', startedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() });
    s.save({ ...base, id: 'ses_new_one', startedAt: new Date().toISOString() });
    expect(s.purge(30)).toBe(1);
    expect(s.list().map((x) => x.id)).toEqual(['ses_new_one']);
    expect(s.deleteAll()).toBe(true);
    expect(existsSync(join(root, 'witness-data'))).toBe(false);
    expect(new DataStore<Checkin>(root, fakeWrap()).list()).toEqual([]);
  });
  it('a corrupted file is quarantined, not crashed on', () => {
    const root = mkdtempSync(join(tmpdir(), 'witness-'));
    const s = new DataStore<Checkin>(root, fakeWrap());
    s.list();
    writeFileSync(join(root, 'witness-data', 'history.enc'), '{"v":1,"iv":"AAAA","tag":"AAAA","data":"AAAA"}');
    const s2 = new DataStore<Checkin>(root, fakeWrap());
    expect(s2.list()).toEqual([]);
    expect(s2.quarantined).toMatch(/corrupt/);
  });
  it('without OS encryption it keeps history in memory only', async () => {
    const root = mkdtempSync(join(tmpdir(), 'witness-'));
    const s = new DataStore<Checkin>(root, fakeWrap(false));
    s.save(CheckinSchema.parse(await realCheckin()));
    expect(s.list()).toHaveLength(1);
    expect(existsSync(join(root, 'witness-data'))).toBe(false);
  });
});

describe('IPC payload schemas', () => {
  it('a check-in record from the controller validates', async () => {
    expect(CheckinSchema.safeParse(await realCheckin('talking')).success).toBe(true);
  });
  it('rejects extra fields (e.g. smuggled landmarks) and bad ids', async () => {
    const rec = await realCheckin();
    expect(CheckinSchema.safeParse({ ...rec, landmarks: [[1, 2]] }).success).toBe(false);
    expect(CheckinSchema.safeParse({ ...rec, id: '../../etc' }).success).toBe(false);
  });
  it('key schema', () => {
    expect(KeySchema.safeParse('abc').success).toBe(false);
    expect(KeySchema.safeParse('has space inside key').success).toBe(false);
    expect(KeySchema.safeParse('ABCdef123456').success).toBe(true);
  });
});

describe('SettingsStore', () => {
  it('defaults: telemetry off, AI summaries off, 30-day retention', () => {
    const s = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'witness-')), 'settings.json'));
    expect(s.get()).toEqual(DEFAULT_SETTINGS);
    expect(s.get().telemetry).toBe(false);
    expect(s.get().aiSummaries).toBe(false);
    expect(s.get().retentionDays).toBe(30);
  });
  it('rejects invalid values', () => {
    const s = new SettingsStore(join(mkdtempSync(join(tmpdir(), 'witness-')), 'settings.json'));
    expect(() => s.set({ retentionDays: 365 as never })).toThrow();
    expect(s.set({ retentionDays: 7 }).retentionDays).toBe(7);
  });
});
