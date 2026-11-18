import { app, session, shell, type WebContents } from 'electron';

export const APP_ORIGIN = 'app://witness';

/** One CSP for the meta tag and the response header. Nothing remote, ever. */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join('; ');

/** External links go through ids, never raw URLs from the renderer. */
export const EXTERNAL: Record<string, string> = {
  register: 'https://physiology.presagetech.com/auth/register',
  portal: 'https://physiology.presagetech.com/',
  repo: 'https://github.com/Emediong-Etuk/Witness',
};

export function openExternal(id: string): boolean {
  const url = EXTERNAL[id];
  if (!url) return false;
  void shell.openExternal(url);
  return true;
}

/** Dev server origin (electron-vite dev), allowed only in unpackaged builds. */
export function devOrigin(): string | null {
  const u = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  if (!u) return null;
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

export function isTrustedUrl(url: string): boolean {
  if (url.startsWith(APP_ORIGIN + '/')) return true;
  const dev = devOrigin();
  return !!dev && (url === dev || url.startsWith(dev + '/'));
}

/**
 * Grant only `media`, only video-only requests, only to our own origin.
 * Everything else is denied: microphone, notifications, geolocation, clipboard…
 */
export function installPermissionHandlers(): void {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && 'requestingUrl' in details && details.requestingUrl) || wc?.getURL() || '';
    const media = details as { mediaTypes?: string[] };
    const videoOnly = Array.isArray(media.mediaTypes) && media.mediaTypes.length > 0 && media.mediaTypes.every((t) => t === 'video');
    callback(permission === 'media' && videoOnly && isTrustedUrl(url));
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const origin = requestingOrigin || (details as { securityOrigin?: string })?.securityOrigin || '';
    const okOrigin = origin === APP_ORIGIN || origin === devOrigin();
    return permission === 'media' && okOrigin && (details as { mediaType?: string })?.mediaType !== 'audio';
  });
  ses.setDevicePermissionHandler(() => false);
  // Strip anything that would let content reach the network: all requests are app:// or devtools.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const ok = u.startsWith(APP_ORIGIN + '/') || u.startsWith('devtools://') || u.startsWith('blob:') || u.startsWith('data:') || (devOrigin() !== null && (u.startsWith(devOrigin()!) || u.startsWith(devOrigin()!.replace('http', 'ws'))));
    callback({ cancel: !ok });
  });
}

export function lockDownContents(wc: WebContents): void {
  wc.on('will-navigate', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!isTrustedUrl(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (app.isPackaged) {
    wc.on('devtools-opened', () => wc.closeDevTools());
  }
}
