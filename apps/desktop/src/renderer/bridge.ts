import type { Checkin, Settings } from '../shared/ipc-schema';

export interface KeyStatus { hasKey: boolean; encrypted: boolean; memoryOnly: boolean; fromEnv: boolean; encryptionAvailable: boolean }
export interface AppInfo { appVersion: string; sdkVersion: string; electron: string; platform: string; packaged: boolean }

export interface WitnessBridge {
  key: { status(): Promise<KeyStatus>; set(key: string, allowPlain?: boolean): Promise<{ stored: 'encrypted' | 'memory' | 'plain' }>; clear(): Promise<boolean> };
  session: { getKey(): Promise<string | null> };
  store: {
    save(c: Checkin): Promise<boolean>;
    list(): Promise<{ items: Checkin[]; persistent: boolean; quarantined: string | null }>;
    exportAll(): Promise<string>;
    deleteAll(): Promise<boolean>;
  };
  settings: { get(): Promise<Settings>; set(p: Partial<Settings>): Promise<Settings> };
  open: { external(id: 'register' | 'portal' | 'repo'): Promise<boolean> };
  app: { info(): Promise<AppInfo> };
  onHidden(cb: () => void): () => void;
}

declare global {
  interface Window {
    witness?: WitnessBridge;
    __smartspectraBridge?: unknown;
  }
}

const DEFAULTS: Settings = { mode: 'quick', retentionDays: 30, saveByDefault: true, telemetry: false, aiSummaries: false, sounds: true, spokenCoaching: false, consentCompact: false, theme: 'system' };

/** In-memory bridge for the browser build (judge site demo, Playwright UI tests). */
export function memoryBridge(): WitnessBridge {
  let settings = { ...DEFAULTS };
  let items: Checkin[] = [];
  const hidden = new Set<() => void>();
  const w = globalThis as unknown as { __witnessHide?: () => void };
  w.__witnessHide = () => hidden.forEach((f) => f());
  return {
    key: { status: async () => ({ hasKey: false, encrypted: false, memoryOnly: false, fromEnv: false, encryptionAvailable: false }), set: async () => ({ stored: 'memory' }), clear: async () => true },
    session: { getKey: async () => null },
    store: {
      save: async (c) => {
        items = [...items.filter((x) => x.id !== c.id), c];
        return true;
      },
      list: async () => ({ items, persistent: false, quarantined: null }),
      exportAll: async () => JSON.stringify({ checkins: items }, null, 2),
      deleteAll: async () => {
        items = [];
        settings = { ...DEFAULTS };
        return true;
      },
    },
    settings: { get: async () => settings, set: async (p) => (settings = { ...settings, ...p }) },
    open: { external: async () => false },
    app: { info: async () => ({ appVersion: '0.1.0', sdkVersion: 'n/a (browser build)', electron: '', platform: 'browser', packaged: false }) },
    onHidden: (cb) => {
      hidden.add(cb);
      return () => hidden.delete(cb);
    },
  };
}

export const bridge: WitnessBridge = window.witness ?? memoryBridge();
export const hasSdk = typeof window.__smartspectraBridge !== 'undefined';
