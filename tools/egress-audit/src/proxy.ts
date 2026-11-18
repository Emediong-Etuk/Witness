import { createServer, request as httpRequest, type Server } from 'node:http';
import { connect, type Socket } from 'node:net';

export interface ProxyHit {
  kind: 'connect' | 'http';
  host: string;
  port: number;
  tMs: number;
}

/**
 * Logging forward proxy. For HTTPS it sees only `CONNECT host:port` (the TLS
 * stays end-to-end), which is exactly what we want to know: which hosts the
 * process talks to. It logs host and port only, never paths, headers or
 * bodies, so an API key in a header or query can't end up in the log.
 * If `upstream` is set (e.g. a corporate proxy), tunnels go through it.
 */
export function startLoggingProxy(o: { upstream?: string | null; now?: () => number } = {}): Promise<{ server: Server; port: number; hits: ProxyHit[]; close: () => Promise<void> }> {
  const hits: ProxyHit[] = [];
  const t0 = Date.now();
  const now = o.now ?? (() => Date.now() - t0);
  const up = o.upstream ? new URL(o.upstream) : null;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    // plain-HTTP absolute-URI request
    let u: URL;
    try {
      u = new URL(req.url ?? '');
    } catch {
      res.writeHead(400).end();
      return;
    }
    hits.push({ kind: 'http', host: u.hostname, port: Number(u.port || 80), tMs: now() });
    const fwd = httpRequest({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    fwd.on('error', () => res.writeHead(502).end());
    req.pipe(fwd);
  });
  server.on('connect', (req, client: Socket, head: Buffer) => {
    sockets.add(client);
    client.on('close', () => sockets.delete(client));
    const [host, portS] = (req.url ?? '').split(':');
    const port = Number(portS || 443);
    if (!host) {
      client.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    hits.push({ kind: 'connect', host, port, tMs: now() });
    const target = up ? connect(Number(up.port || 80), up.hostname) : connect(port, host);
    sockets.add(target);
    target.on('close', () => sockets.delete(target));
    target.on('error', () => client.destroy());
    client.on('error', () => target.destroy());
    target.once('connect', () => {
      if (up) {
        target.write(`CONNECT ${host}:${port} HTTP/1.1\r\nHost: ${host}:${port}\r\n\r\n`);
        target.once('data', (d: Buffer) => {
          const ok = /^HTTP\/1\.[01] 200/.test(d.toString('latin1'));
          if (!ok) return client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) target.write(head);
          target.pipe(client);
          client.pipe(target);
        });
      } else {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) target.write(head);
        target.pipe(client);
        client.pipe(target);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        server, port, hits,
        close: () => new Promise<void>((r) => {
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
      });
    });
  });
}
