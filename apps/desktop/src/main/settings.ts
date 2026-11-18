import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { SettingsSchema, type Settings } from '../shared/ipc-schema';

export const DEFAULT_SETTINGS: Settings = {
  mode: 'quick',
  retentionDays: 30,
  saveByDefault: true,
  telemetry: false,
  aiSummaries: false,
  sounds: true,
  spokenCoaching: false,
  consentCompact: false,
  theme: 'system',
};

export class SettingsStore {
  private cache: Settings | null = null;
  constructor(private readonly file: string) {}

  get(): Settings {
    if (this.cache) return this.cache;
    try {
      if (existsSync(this.file)) {
        const parsed = SettingsSchema.partial().safeParse(JSON.parse(readFileSync(this.file, 'utf8')));
        if (parsed.success) return (this.cache = { ...DEFAULT_SETTINGS, ...parsed.data });
      }
    } catch {
      /* fall through to defaults */
    }
    return (this.cache = { ...DEFAULT_SETTINGS });
  }

  set(patch: Partial<Settings>): Settings {
    const next = SettingsSchema.parse({ ...this.get(), ...patch });
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2), { mode: 0o600 });
    return (this.cache = next);
  }

  clear(): void {
    this.cache = null;
    rmSync(this.file, { force: true });
  }
}
