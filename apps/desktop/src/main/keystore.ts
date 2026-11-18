import { app, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The API key lives encrypted with the OS keychain (safeStorage) in
 * userData/key.bin. It is never logged. If the OS offers no encryption, it is
 * kept in memory for this run only, unless the user explicitly opts into a
 * plain-text file.
 */
export class KeyStore {
  private memory: string | null = null;
  private readonly file = join(app.getPath('userData'), 'key.bin');
  private readonly plainFile = join(app.getPath('userData'), 'key.plain');

  get encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  status(): { hasKey: boolean; encrypted: boolean; memoryOnly: boolean; fromEnv: boolean } {
    const fromEnv = !app.isPackaged && !!process.env.SMARTSPECTRA_API_KEY;
    return {
      hasKey: !!this.memory || existsSync(this.file) || existsSync(this.plainFile) || fromEnv,
      encrypted: existsSync(this.file),
      memoryOnly: !!this.memory && !existsSync(this.file) && !existsSync(this.plainFile),
      fromEnv,
    };
  }

  set(key: string, allowPlain = false): { stored: 'encrypted' | 'memory' | 'plain' } {
    this.memory = key;
    mkdirSync(app.getPath('userData'), { recursive: true });
    if (this.encryptionAvailable) {
      writeFileSync(this.file, safeStorage.encryptString(key), { mode: 0o600 });
      return { stored: 'encrypted' };
    }
    if (allowPlain) {
      writeFileSync(this.plainFile, key, { mode: 0o600 });
      return { stored: 'plain' };
    }
    return { stored: 'memory' };
  }

  get(): string | null {
    if (this.memory) return this.memory;
    if (existsSync(this.file) && this.encryptionAvailable) {
      this.memory = safeStorage.decryptString(readFileSync(this.file));
      return this.memory;
    }
    if (existsSync(this.plainFile)) return (this.memory = readFileSync(this.plainFile, 'utf8').trim());
    if (!app.isPackaged && process.env.SMARTSPECTRA_API_KEY) return process.env.SMARTSPECTRA_API_KEY;
    return null;
  }

  clear(): void {
    this.memory = null;
    rmSync(this.file, { force: true });
    rmSync(this.plainFile, { force: true });
  }
}
