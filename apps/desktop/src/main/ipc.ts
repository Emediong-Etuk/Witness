import { ipcMain, safeStorage, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { CheckinSchema, ExternalIdSchema, KeySchema, MAX_IPC_BYTES, SettingsSchema, type Checkin } from '../shared/ipc-schema';
import { DataStore } from './datastore';
import type { KeyStore } from './keystore';
import { isTrustedUrl, openExternal } from './security';
import type { SettingsStore } from './settings';

export class IpcError extends Error {}

function guard(e: IpcMainInvokeEvent): void {
  const url = e.senderFrame?.url ?? '';
  if (!isTrustedUrl(url)) throw new IpcError('untrusted sender');
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  let size = 0;
  try {
    size = JSON.stringify(raw ?? null).length;
  } catch {
    throw new IpcError('unserialisable payload');
  }
  if (size > MAX_IPC_BYTES) throw new IpcError('payload too large');
  const r = schema.safeParse(raw);
  if (!r.success) throw new IpcError('invalid payload');
  return r.data;
}

export const safeStorageWrapper = {
  available: () => safeStorage.isEncryptionAvailable(),
  wrap: (raw: Buffer) => safeStorage.encryptString(raw.toString('base64')),
  unwrap: (w: Buffer) => Buffer.from(safeStorage.decryptString(w), 'base64'),
};

export interface Deps {
  keys: KeyStore;
  settings: SettingsStore;
  store: DataStore<Checkin>;
  isMeasuringAllowed: () => boolean;
  appInfo: () => { appVersion: string; sdkVersion: string; electron: string; platform: string; packaged: boolean };
}

/**
 * Every channel: sender origin check, size limit, zod validation. There is no
 * generic "invoke anything" bridge.
 */
export function registerIpc(d: Deps): void {
  const handle = (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, async (e, ...args) => {
      guard(e);
      return fn(e, ...args);
    });

  let lastKeyRead = 0;
  handle('key:status', () => ({ ...d.keys.status(), encryptionAvailable: d.keys.encryptionAvailable }));
  handle('key:set', (_e, key, allowPlain) => d.keys.set(parse(KeySchema, key), allowPlain === true));
  handle('key:clear', () => {
    d.keys.clear();
    return true;
  });
  // Only while a consented session is starting (window visible), at most once every 3 s.
  handle('session:getKey', () => {
    const now = Date.now();
    if (!d.isMeasuringAllowed()) throw new IpcError('window not visible');
    if (now - lastKeyRead < 3000) throw new IpcError('rate limited');
    lastKeyRead = now;
    return d.keys.get();
  });
  handle('store:save', (_e, rec) => {
    d.store.save(parse(CheckinSchema, rec));
    return true;
  });
  handle('store:list', () => ({ items: d.store.list(), persistent: d.store.persistent, quarantined: d.store.quarantined }));
  handle('store:exportAll', () => JSON.stringify({ exportedAt: new Date().toISOString(), settings: d.settings.get(), checkins: d.store.list() }, null, 2));
  handle('store:deleteAll', () => {
    const okStore = d.store.deleteAll();
    d.keys.clear();
    d.settings.clear();
    return okStore && !d.keys.status().encrypted;
  });
  handle('settings:get', () => d.settings.get());
  handle('settings:set', (_e, patch) => {
    const next = d.settings.set(parse(SettingsSchema.partial(), patch));
    d.store.purge(next.retentionDays);
    return next;
  });
  handle('open:external', (_e, id) => openExternal(parse(ExternalIdSchema, id)));
  handle('app:info', () => d.appInfo());
}
