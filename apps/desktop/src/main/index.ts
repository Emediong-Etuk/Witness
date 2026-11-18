import { app, BrowserWindow, protocol } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import type { Checkin } from '../shared/ipc-schema';
import { DataStore } from './datastore';
import { registerIpc, safeStorageWrapper } from './ipc';
import { KeyStore } from './keystore';
import { APP_ORIGIN, CSP, devOrigin, installPermissionHandlers, lockDownContents } from './security';
import { SettingsStore } from './settings';

// Packaged builds load the native SmartSpectra library from our own bundle,
// unconditionally, so it can't be redirected through the environment.
if (app.isPackaged) {
  const lib = process.platform === 'win32' ? 'smartspectra_capi.dll' : process.platform === 'darwin' ? 'libsmartspectra_capi.dylib' : 'libsmartspectra_capi.so';
  process.env.SMARTSPECTRA_CAPI_PATH = join(process.resourcesPath, 'smartspectra', lib);
}

// Dev only: read SMARTSPECTRA_API_KEY from a local .env (never in packaged builds, never logged).
if (!app.isPackaged && !process.env.SMARTSPECTRA_API_KEY) {
  for (const f of [join(app.getAppPath(), '.env'), join(app.getAppPath(), '../../.env')]) {
    if (!existsSync(f)) continue;
    const m = /^\s*SMARTSPECTRA_API_KEY\s*=\s*"?([^"\r\n]+)"?\s*$/m.exec(readFileSync(f, 'utf8'));
    if (m?.[1]) {
      process.env.SMARTSPECTRA_API_KEY = m[1].trim();
      break;
    }
  }
}

// Test-only switches exist only in unpackaged builds started with WITNESS_E2E=1.
const E2E = !app.isPackaged && process.env.WITNESS_E2E === '1';
if (E2E && process.env.WITNESS_FAKE_VIDEO) {
  app.commandLine.appendSwitch('use-fake-device-for-media-stream');
  app.commandLine.appendSwitch('use-file-for-fake-video-capture', process.env.WITNESS_FAKE_VIDEO);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let sdkVersion = 'unavailable';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
};

/**
 * Serves the renderer bundle from disk. It reads files directly rather than
 * through net.fetch(file://): the session's request filter blocks every
 * non-app:// URL, file: included, and the filter should stay that strict.
 */
function registerAppProtocol(): void {
  const root = join(__dirname, '../renderer');
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    if (url.host !== 'witness') return new Response('not found', { status: 404 });
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = normalize(join(root, rel));
    if (!file.startsWith(root + sep)) return new Response('forbidden', { status: 403 });
    const type = MIME[extname(file).toLowerCase()];
    if (!type) return new Response('not found', { status: 404 });
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return new Response('not found', { status: 404 });
    }
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    });
  });
}

function bindSdk(w: BrowserWindow): void {
  // Loaded lazily: if the native runtime can't load, replay mode still works.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { bindSmartSpectraIpc } = require('@smartspectra/node-sdk/main') as typeof import('@smartspectra/node-sdk/main');
    bindSmartSpectraIpc(w, { logger: (level, msg) => (level === 'error' ? console.error : console.warn)(`[sdk] ${msg}`) });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    sdkVersion = (require('@smartspectra/node-sdk/package.json') as { version: string }).version;
  } catch (err) {
    console.error('[witness] SmartSpectra native runtime unavailable; camera check-ins disabled:', (err as Error).message);
  }
}

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: '#0F110E',
    title: 'Witness',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  lockDownContents(w.webContents);
  w.once('ready-to-show', () => w.show());
  // Minimize/hide stops measuring within 1 s: tell the renderer immediately.
  const stop = () => w.webContents.send('window:hidden');
  w.on('minimize', stop);
  w.on('hide', stop);
  bindSdk(w);
  const dev = devOrigin();
  void w.loadURL(dev ? process.env.ELECTRON_RENDERER_URL! : `${APP_ORIGIN}/index.html`);
  return w;
}

app.whenReady().then(() => {
  registerAppProtocol();
  installPermissionHandlers();
  const keys = new KeyStore();
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
  const store = new DataStore<Checkin>(app.getPath('userData'), safeStorageWrapper);
  const purge = () => void store.purge(settings.get().retentionDays).catch(() => undefined);
  purge();
  setInterval(purge, 3_600_000).unref();
  registerIpc({
    keys,
    settings,
    store,
    isMeasuringAllowed: () => !!win && win.isVisible() && !win.isMinimized(),
    appInfo: () => ({ appVersion: app.getVersion(), sdkVersion, electron: process.versions.electron ?? '', platform: `${process.platform}-${process.arch}`, packaged: app.isPackaged }),
  });
  win = createWindow();
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
});

app.on('window-all-closed', () => app.quit());
