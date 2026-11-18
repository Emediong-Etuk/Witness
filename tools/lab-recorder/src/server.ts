import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { ManifestClipSchema, ManifestSchema, type Manifest, type ManifestClip } from '@witness/schema';
import { labelledIntervals, PLAN, READING_TEXT, TEST_TEMPLATE, type ClipTemplate } from './plan.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
const MAX_CLIP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB (75 s at 25 Mbps ≈ 235 MB)
const MAX_JSON_BYTES = 256 * 1024;

export interface LabOptions {
  root?: string;
  port?: number;
  token?: string;
  /** Adds the 4-s Z1 test template (tests only). */
  test?: boolean;
}

export interface Lab {
  url: string;
  token: string;
  port: number;
  close(): Promise<void>;
}

function bundle(entry: string): string {
  const r = buildSync({ entryPoints: [join(HERE, 'page', entry)], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: false });
  return r.outputFiles[0]!.text;
}

const CSS = `
:root{--bg:#0f110e;--raised:#171a15;--hair:#2a2f27;--ink:#eceae2;--muted:#9aa093;--ok:#7cf2b0;--warn:#f5b94a;--bad:#ff7a6b;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:24px}h1{font:400 32px Georgia,serif;margin:0 0 4px}h2{font-size:18px}
.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:1fr 360px;gap:24px}
button{font:inherit;padding:10px 18px;border-radius:999px;border:1px solid var(--hair);background:var(--raised);color:var(--ink);cursor:pointer}
button.primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}button:disabled{opacity:.4;cursor:not-allowed}
.card{background:var(--raised);border:1px solid var(--hair);border-radius:14px;padding:16px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid var(--hair);padding:6px 8px;text-align:left;font-size:14px}
video{width:100%;border-radius:12px;background:#000;transform:scaleX(-1)}
.cue{font:400 34px Georgia,serif;min-height:1.4em}.cue.start{color:var(--warn)}.cue.stop{color:var(--ok)}
.next{font-family:ui-monospace,monospace;color:var(--muted)}.big{font:600 40px ui-monospace,monospace;white-space:nowrap}
.breath{width:180px;height:180px;margin:12px auto;border-radius:50%;border:2px solid var(--ok);transition:transform .1s linear}
input,select,textarea{font:inherit;background:#0b0d0a;color:var(--ink);border:1px solid var(--hair);border-radius:8px;padding:8px;width:100%}
label{display:block;margin:10px 0}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.ok{color:var(--ok)}.bad{color:var(--bad)}
.warn{border-left:3px solid var(--warn);padding-left:12px}
.inline{display:inline-block;width:auto}.narrow{width:90px;display:inline-block}.hidden{display:none}.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
`;

const page = (title: string, script: string, token: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob: mediastream:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="lab-token" content="${token}"><title>${title}</title><link rel="stylesheet" href="/lab.css"></head>
<body><main id="app"></main><script type="module" src="/${script}"></script></body></html>`;

export function readManifest(root: string): Manifest {
  const f = join(root, 'corpus/manifest.json');
  return existsSync(f) ? ManifestSchema.parse(JSON.parse(readFileSync(f, 'utf8'))) : { v: 1, clips: [] };
}

function writeManifest(root: string, m: Manifest): void {
  const f = join(root, 'corpus/manifest.json');
  mkdirSync(dirname(f), { recursive: true });
  m.clips.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  writeFileSync(f, JSON.stringify(ManifestSchema.parse(m), null, 2) + '\n');
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((res, rej) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (c: Buffer) => {
      n += c.length;
      if (n > max) {
        rej(new Error('too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => res(Buffer.concat(chunks)));
    req.on('error', rej);
  });
}

/** Template → manifest entry, from the form fields the page sends. */
export function entryFor(t: ClipTemplate, form: {
  file: string; subject: string; fitzpatrick: number | null; camera: string; lighting: string; resolution: string;
  publishVideo: boolean; notes?: string; pulse: { tS: number; bpm: number }[]; device: string; consentAt: string; clipSha256: string;
}): ManifestClip {
  return ManifestClipSchema.parse({
    id: t.id,
    title: t.title,
    condition: t.condition,
    split: t.split,
    file: form.file,
    intervals: labelledIntervals(t),
    wholeClip: t.wholeClip,
    ...(t.flickerHz ? { flickerHz: t.flickerHz } : {}),
    ...(t.pacedBreathingBrpm ? { pacedBreathingBrpm: t.pacedBreathingBrpm } : {}),
    groundTruth: form.pulse.length ? { device: form.device || 'fingertip pulse oximeter', pulse: form.pulse } : null,
    consent: { attested: true, subject: form.subject, at: form.consentAt, publishVideo: form.publishVideo },
    subject: { fitzpatrick: form.fitzpatrick },
    camera: form.camera.slice(0, 120),
    lighting: form.lighting.slice(0, 200),
    resolution: form.resolution,
    ...(form.notes ? { notes: form.notes.slice(0, 500) } : {}),
    sha256: { clip: form.clipSha256, trace: null },
  });
}

export function startLab(o: LabOptions = {}): Promise<Lab> {
  const root = o.root ?? REPO;
  const token = o.token ?? randomBytes(18).toString('base64url');
  const plan = o.test ? [...PLAN, TEST_TEMPLATE] : PLAN;
  const clipsDir = join(root, 'corpus/clips');
  const js = { 'lab.js': bundle('main.ts'), 'flicker.js': bundle('flicker.ts') };
  const tokOk = (req: IncomingMessage) => {
    const got = Buffer.from(String(req.headers['x-lab-token'] ?? ''));
    const want = Buffer.from(token);
    return got.length === want.length && timingSafeEqual(got, want);
  };
  const send = (res: ServerResponse, code: number, body: string | Buffer, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.end(body);
  };
  const json = (res: ServerResponse, code: number, v: unknown) => send(res, code, JSON.stringify(v));

  const server: Server = createServer(async (req, res) => {
    try {
      // DNS-rebinding guard: only answer requests addressed to the loopback name we listen on.
      const host = String(req.headers.host ?? '');
      const port = (server.address() as { port: number }).port;
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 421, 'misdirected', 'text/plain');
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      // Pages (the token is embedded; API calls must echo it in a header, so other sites can't drive the recorder)
      if (req.method === 'GET' && url.pathname === '/') return send(res, 200, page('Witness lab recorder', 'lab.js', token), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/flicker') return send(res, 200, page('Witness flicker page', 'flicker.js', token), 'text/html; charset=utf-8');
      if (req.method === 'GET' && url.pathname === '/lab.css') return send(res, 200, CSS, 'text/css');
      if (req.method === 'GET' && url.pathname === '/flicker-standalone.html') {
        // Self-contained copy to send to a phone (the lab server itself is loopback-only).
        res.setHeader('Content-Disposition', 'attachment; filename="witness-flicker.html"');
        return send(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Witness flicker page</title><style>${CSS}</style></head><body><main id="app"></main><script type="module">${js['flicker.js']}</script></body></html>`, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && (url.pathname === '/lab.js' || url.pathname === '/flicker.js')) return send(res, 200, js[url.pathname.slice(1) as keyof typeof js], 'text/javascript');
      if (!url.pathname.startsWith('/api/')) return send(res, 404, 'not found', 'text/plain');
      if (!tokOk(req)) return json(res, 403, { error: 'bad token' });

      if (req.method === 'GET' && url.pathname === '/api/plan') {
        const m = readManifest(root);
        return json(res, 200, {
          plan: plan.map((t) => ({ ...t, intervals: labelledIntervals(t) })),
          recorded: m.clips.map((c) => ({ id: c.id, trace: c.sha256.trace !== null })),
          readingText: READING_TEXT,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/clip') {
        const id = String(req.headers['x-clip-id'] ?? '');
        const t = plan.find((x) => x.id === id);
        if (!t) return json(res, 400, { error: `unknown clip id ${id}` });
        if (req.headers['x-consent'] !== 'attested') return json(res, 400, { error: 'consent not attested; nothing saved' });
        const ext = String(req.headers['content-type'] ?? '').includes('mp4') ? 'mp4' : 'webm';
        const file = `${id}.${ext}`;
        mkdirSync(clipsDir, { recursive: true });
        const final = join(clipsDir, file);
        if (existsSync(final) && url.searchParams.get('replace') !== '1') return json(res, 409, { error: `${file} exists; re-record with replace` });
        const part = `${final}.part`;
        const hash = createHash('sha256');
        let n = 0;
        await new Promise<void>((resolveUp, rejectUp) => {
          const out = createWriteStream(part);
          req.on('data', (c: Buffer) => {
            n += c.length;
            if (n > MAX_CLIP_BYTES) {
              req.destroy();
              out.destroy();
              rejectUp(new Error('clip too large'));
              return;
            }
            hash.update(c);
            out.write(c);
          });
          req.on('end', () => out.end(() => resolveUp()));
          req.on('error', rejectUp);
        });
        if (n === 0) {
          rmSync(part, { force: true });
          return json(res, 400, { error: 'empty recording' });
        }
        renameSync(part, final);
        return json(res, 200, { file, bytes: statSync(final).size, sha256: 'sha256:' + hash.digest('hex') });
      }

      if (req.method === 'POST' && url.pathname === '/api/entry') {
        const body = JSON.parse((await readBody(req, MAX_JSON_BYTES)).toString('utf8')) as Parameters<typeof entryFor>[1] & { id: string };
        const t = plan.find((x) => x.id === body.id);
        if (!t) return json(res, 400, { error: 'unknown clip id' });
        const file = join(clipsDir, body.file);
        if (!/^[A-Z][0-9]+\.(webm|mp4)$/.test(body.file) || !existsSync(file)) return json(res, 400, { error: 'recording not found' });
        const sha = 'sha256:' + createHash('sha256').update(readFileSync(file)).digest('hex');
        if (sha !== body.clipSha256) return json(res, 400, { error: 'clip hash mismatch' });
        let entry: ManifestClip;
        try {
          entry = entryFor(t, body);
        } catch (e) {
          return json(res, 400, { error: `invalid entry: ${(e as Error).message.slice(0, 400)}` });
        }
        const m = readManifest(root);
        m.clips = [...m.clips.filter((c) => c.id !== t.id), entry];
        writeManifest(root, m);
        return json(res, 200, { ok: true, entry });
      }
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  });

  return new Promise((r) => {
    server.listen(o.port ?? 0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      r({ url: `http://127.0.0.1:${port}/`, token, port, close: () => new Promise<void>((c) => server.close(() => c())) });
    });
  });
}
