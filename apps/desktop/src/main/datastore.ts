import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Wrapper {
  available(): Promise<boolean>;
  wrap(raw: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

interface Envelope {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}

/**
 * Encrypted local history: AES-256-GCM with a random data key, the data key
 * wrapped by the OS keychain. Holds only what the user chose to save:
 * verified values, receipts and derived check values. No frames, landmarks
 * or expressions.
 */
export class DataStore<T extends { id: string; startedAt: string }> {
  private readonly dir: string;
  private readonly keyFile: string;
  private readonly dataFile: string;
  private dataKey: Buffer | null = null;
  private memory: T[] | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  quarantined: string | null = null;

  constructor(root: string, private readonly wrapper: Wrapper) {
    this.dir = join(root, 'witness-data');
    this.keyFile = join(this.dir, 'data.key');
    this.dataFile = join(this.dir, 'history.enc');
  }

  persistent(): Promise<boolean> {
    return this.wrapper.available();
  }

  /** Operations run one at a time, so an await can't interleave two writes. */
  private serial<R>(fn: () => Promise<R>): Promise<R> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async key(): Promise<Buffer | null> {
    if (this.dataKey) return this.dataKey;
    if (!(await this.wrapper.available())) return null;
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (existsSync(this.keyFile)) {
      this.dataKey = await this.wrapper.unwrap(readFileSync(this.keyFile));
    } else {
      const k = randomBytes(32);
      writeFileSync(this.keyFile, await this.wrapper.wrap(k), { mode: 0o600 });
      this.dataKey = k;
    }
    return this.dataKey;
  }

  list(): Promise<T[]> {
    return this.serial(() => this.listNow());
  }

  private async listNow(): Promise<T[]> {
    if (this.memory) return this.memory;
    const k = await this.key();
    if (!k || !existsSync(this.dataFile)) return (this.memory = []);
    try {
      const env = JSON.parse(readFileSync(this.dataFile, 'utf8')) as Envelope;
      const d = createDecipheriv('aes-256-gcm', k, Buffer.from(env.iv, 'base64'));
      d.setAuthTag(Buffer.from(env.tag, 'base64'));
      const plain = Buffer.concat([d.update(Buffer.from(env.data, 'base64')), d.final()]);
      return (this.memory = JSON.parse(plain.toString('utf8')) as T[]);
    } catch {
      // Corrupted or tampered: move it aside, tell the user, start empty.
      const q = `${this.dataFile}.corrupt-${Date.now()}`;
      renameSync(this.dataFile, q);
      this.quarantined = q;
      return (this.memory = []);
    }
  }

  private async write(items: T[]): Promise<void> {
    this.memory = items;
    const k = await this.key();
    if (!k) return; // memory only
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', k, iv);
    const data = Buffer.concat([c.update(Buffer.from(JSON.stringify(items), 'utf8')), c.final()]);
    const env: Envelope = { v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
    const tmp = `${this.dataFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(env), { mode: 0o600 });
    renameSync(tmp, this.dataFile);
  }

  save(item: T): Promise<void> {
    return this.serial(async () => {
      const items = (await this.listNow()).filter((x) => x.id !== item.id);
      items.push(item);
      items.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
      await this.write(items);
    });
  }

  /** Drop records older than `days`. Returns how many were removed. */
  purge(days: number, now = Date.now()): Promise<number> {
    return this.serial(async () => {
      const cut = now - days * 86_400_000;
      const items = await this.listNow();
      const keep = items.filter((x) => Date.parse(x.startedAt) >= cut);
      if (keep.length !== items.length) await this.write(keep);
      return items.length - keep.length;
    });
  }

  /** Remove everything and verify it is gone. */
  deleteAll(): Promise<boolean> {
    return this.serial(async () => {
      this.memory = null;
      this.dataKey = null;
      rmSync(this.dir, { recursive: true, force: true });
      return !existsSync(this.dir);
    });
  }
}
