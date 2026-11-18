import { createServer, connect, type Server } from 'node:net';
import { describe, expect, it } from 'vitest';
import { aggregateHits, runAudit, type AuditResult } from '../src/audit.js';
import { descendants, isLoopback, parseLsof, parsePs, parseSs, parseWindowsJson, splitEndpoint } from '../src/parse.js';
import { startLoggingProxy } from '../src/proxy.js';
import { renderEgress, replaceBetween } from '@witness/bench-core';
import { MATRIX } from '../src/matrix.js';

describe('socket-table parsers', () => {
  it('splitEndpoint handles v4, bracketed v6 and wildcards', () => {
    expect(splitEndpoint('10.0.0.2:443')).toEqual({ addr: '10.0.0.2', port: 443 });
    expect(splitEndpoint('[2606:4700::1]:443')).toEqual({ addr: '2606:4700::1', port: 443 });
    expect(splitEndpoint('*:*')).toBeNull();
    expect(splitEndpoint('0.0.0.0:*')).toBeNull();
  });
  it('ss -tunpH', () => {
    const out = [
      'tcp   ESTAB 0 0 10.0.0.5:51234 104.18.2.3:443 users:(("node",pid=4242,fd=21))',
      'udp   UNCONN 0 0 0.0.0.0:5353 0.0.0.0:* users:(("avahi",pid=1,fd=3))',
      'tcp   TIME-WAIT 0 0 [::1]:3000 [::1]:51000',
    ].join('\n');
    const c = parseSs(out);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ proto: 'tcp', remoteAddr: '104.18.2.3', remotePort: 443, pid: 4242, state: 'ESTAB' });
    expect(c[1]!.pid).toBeNull();
  });
  it('lsof -nP -i', () => {
    const out = [
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME',
      'Electron 9001 greg   31u  IPv4 0xabc      0t0  TCP 192.168.1.7:60211->34.120.1.2:443 (ESTABLISHED)',
      'Electron 9001 greg   32u  IPv6 0xdef      0t0  TCP [fe80::1]:60212->[2600:1f18::5]:443 (SYN_SENT)',
      'Electron 9001 greg   33u  IPv4 0x123      0t0  TCP *:9229 (LISTEN)',
    ].join('\n');
    const c = parseLsof(out);
    expect(c.map((x) => [x.remoteAddr, x.remotePort, x.state, x.pid])).toEqual([
      ['34.120.1.2', 443, 'ESTABLISHED', 9001],
      ['2600:1f18::5', 443, 'SYN_SENT', 9001],
    ]);
  });
  it('Get-NetTCPConnection JSON (single object and array)', () => {
    const one = JSON.stringify({ LocalAddress: '10.0.0.3', LocalPort: 5000, RemoteAddress: '52.1.2.3', RemotePort: 443, State: 5, OwningProcess: 77 });
    expect(parseWindowsJson(one)[0]).toMatchObject({ remoteAddr: '52.1.2.3', state: 'ESTABLISHED', pid: 77 });
    const many = JSON.stringify([{ LocalAddress: '0.0.0.0', LocalPort: 135, RemoteAddress: '0.0.0.0', RemotePort: 0, State: 2, OwningProcess: 4 }]);
    expect(parseWindowsJson(many)).toEqual([]);
    expect(parseWindowsJson('')).toEqual([]);
  });
  it('process tree from ps', () => {
    const kids = parsePs('  1 0\n 10 1\n 11 10\n 12 10\n 13 99\n');
    expect(descendants(10, kids).sort()).toEqual([10, 11, 12]);
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('10.0.0.1')).toBe(false);
  });
});

function echoServer(): Promise<{ server: Server; port: number }> {
  return new Promise((r) => {
    const server = createServer((s) => s.pipe(s));
    server.listen(0, '127.0.0.1', () => r({ server, port: (server.address() as { port: number }).port }));
  });
}

describe('logging CONNECT proxy', () => {
  it('tunnels and logs host:port only (never headers)', async () => {
    const echo = await echoServer();
    const p = await startLoggingProxy();
    const reply = await new Promise<string>((resolve, reject) => {
      const s = connect(p.port, '127.0.0.1', () => {
        s.write(`CONNECT 127.0.0.1:${echo.port} HTTP/1.1\r\nHost: 127.0.0.1:${echo.port}\r\nX-Api-Key: SECRET-SHOULD-NOT-BE-LOGGED\r\n\r\n`);
      });
      let buf = '';
      let sent = false;
      s.on('data', (d) => {
        buf += d.toString();
        if (!sent && buf.includes('200 Connection Established\r\n\r\n')) {
          sent = true;
          buf = '';
          s.write('ping');
        } else if (sent && buf === 'ping') {
          s.end();
          resolve(buf);
        }
      });
      s.on('error', reject);
    });
    expect(reply).toBe('ping');
    expect(p.hits).toEqual([expect.objectContaining({ kind: 'connect', host: '127.0.0.1', port: echo.port })]);
    expect(JSON.stringify(p.hits)).not.toContain('SECRET');
    expect(aggregateHits([...p.hits, ...p.hits])[0]!.count).toBe(2);
    await p.close();
    echo.server.close();
  });
});

describe('runAudit (real sampler, child process)', () => {
  it('sees a connection the child holds open', async () => {
    const echo = await echoServer();
    const script = `const s=require('net').connect(${echo.port},'127.0.0.1');s.on('connect',()=>setTimeout(()=>{s.end();process.exit(0)},2500));`;
    const res = await runAudit({ label: 'test', command: [process.execPath, '-e', script], intervalMs: 200, includeLoopback: true, reverseDns: false });
    echo.server.close();
    expect(res.exitCode).toBe(0);
    expect(res.samples).toBeGreaterThan(3);
    const hit = res.remotes.find((r) => r.port === echo.port);
    expect(hit).toBeDefined();
    expect(hit!.seen).toBeGreaterThan(1);
    expect(res.limitations.length).toBeGreaterThan(0);
  }, 20_000);
  it('loopback is excluded by default', async () => {
    const echo = await echoServer();
    const script = `const s=require('net').connect(${echo.port},'127.0.0.1');s.on('connect',()=>setTimeout(()=>process.exit(0),1200));`;
    const res = await runAudit({ label: 'test', command: [process.execPath, '-e', script], intervalMs: 200, reverseDns: false });
    echo.server.close();
    expect(res.remotes).toEqual([]);
  }, 20_000);
});

describe('EGRESS.md rendering', () => {
  const base = (label: string, remotes: AuditResult['remotes']): AuditResult => ({
    v: 1, kind: 'witness-egress-audit', label, config: {}, startedAt: '', durationS: 180, platform: 'test', sampler: 'lsof', intervalMs: 500,
    samples: 360, sampleErrors: 0, maxPids: 4, remotes, proxy: { used: true, connects: [] }, exitCode: 0, probe: { insightsUnrequested: 3, metricsPackets: 900, errors: [] }, limitations: [],
  });
  it('renders tables and the (a) vs (b) comparison', () => {
    const r = (ip: string, h: string) => ({ proto: 'tcp' as const, ip, port: 443, hostnames: [h], firstS: 1, lastS: 170, seen: 300, states: ['ESTABLISHED'] });
    const md = renderEgress([base('a-full', [r('1.1.1.1', 'auth.example'), r('2.2.2.2', 'gw.example')]), base('b-full', [r('1.1.1.1', 'auth.example')])]);
    expect(md).toContain('| a-full | lsof | 180 | 360 | 3 | 900 | 0 |');
    expect(md).toContain('Endpoints only in (a): gw.example:443');
    expect(md).toContain('none (process did not use the proxy)');
  });
  it('replaceBetween keeps everything outside the markers', () => {
    expect(replaceBetween('x <!--s--> old <!--e--> y', '<!--s-->', '<!--e-->', 'new\n')).toBe('x <!--s-->\nnew\n<!--e--> y');
    expect(() => replaceBetween('nothing', '<!--s-->', '<!--e-->', '')).toThrow();
  });
  it('the matrix covers §7.6 tests a, b, c and telemetry on/off', () => {
    expect(MATRIX.map((m) => m.label[0])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(MATRIX.filter((m) => m.telemetry === 'on')).toHaveLength(2);
  });
});
