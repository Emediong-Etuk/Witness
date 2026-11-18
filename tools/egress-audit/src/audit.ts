import { spawn } from 'node:child_process';
import { promises as dns } from 'node:dns';
import { existsSync, readFileSync } from 'node:fs';
import { isLoopback, type Conn } from './parse.js';
import { startLoggingProxy, type ProxyHit } from './proxy.js';
import { createSampler, type Sampler } from './sampler.js';

export interface Remote {
  proto: 'tcp' | 'udp';
  ip: string;
  port: number;
  hostnames: string[];
  firstS: number;
  lastS: number;
  /** Number of samples in which this endpoint was seen. */
  seen: number;
  states: string[];
}

export interface AuditResult {
  v: 1;
  kind: 'witness-egress-audit';
  label: string;
  config: Record<string, unknown>;
  startedAt: string;
  durationS: number;
  platform: string;
  sampler: string;
  intervalMs: number;
  samples: number;
  sampleErrors: number;
  maxPids: number;
  remotes: Remote[];
  proxy: { used: boolean; connects: { host: string; port: number; kind: string; firstS: number; lastS: number; count: number }[] };
  exitCode: number | null;
  probe: unknown;
  limitations: string[];
}

export interface AuditOptions {
  label: string;
  config?: Record<string, unknown>;
  intervalMs?: number;
  durationS?: number;
  includeLoopback?: boolean;
  /** Spawn this command and audit its process tree… */
  command?: string[];
  env?: Record<string, string>;
  /** …or attach to an already-running process tree. */
  pid?: number;
  /** Start a logging CONNECT proxy and point the child's proxy variables at it. */
  proxy?: boolean;
  upstreamProxy?: string | null;
  /** File the child writes a JSON summary to (the probe does). */
  probeOut?: string;
  sampler?: Sampler;
  log?: (s: string) => void;
  /** Reverse-DNS lookups (disable in tests). */
  reverseDns?: boolean;
}

const LIMITS = [
  'Socket tables are sampled, not traced: a connection that opens and closes between two samples can be missed. The logging proxy (when used and honoured by the process) has no such gap.',
  'Reverse DNS names are whatever the resolver returns for the remote IP (often a CDN or cloud name), not necessarily the hostname the process asked for. Proxy CONNECT targets are the requested hostnames.',
  'Only sockets owned by the audited process tree are counted; OS services acting on the app’s behalf are not.',
];

export async function runAudit(o: AuditOptions): Promise<AuditResult> {
  const log = o.log ?? (() => {});
  const intervalMs = o.intervalMs ?? 500;
  const sampler = o.sampler ?? (await createSampler());
  const proxy = o.proxy ? await startLoggingProxy({ upstream: o.upstreamProxy ?? null }) : null;
  const t0 = Date.now();
  const startedAt = new Date(t0).toISOString();
  let rootPid: number;
  let exitCode: number | null = null;
  let exited = false;
  let child: ReturnType<typeof spawn> | null = null;
  if (o.command?.length) {
    const env: NodeJS.ProcessEnv = { ...process.env, ...o.env };
    if (proxy) {
      const url = `http://127.0.0.1:${proxy.port}`;
      for (const k of ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']) env[k] = url;
      env.NO_PROXY = env.no_proxy = 'localhost,127.0.0.1,::1';
    }
    if (o.probeOut) env.WITNESS_PROBE_OUT = o.probeOut;
    child = spawn(o.command[0]!, o.command.slice(1), { env, stdio: ['ignore', 'inherit', 'inherit'] });
    rootPid = child.pid!;
    child.on('exit', (c) => {
      exited = true;
      exitCode = c;
    });
  } else if (o.pid) rootPid = o.pid;
  else throw new Error('runAudit needs a command or a pid');

  const remotes = new Map<string, Remote & { stateSet: Set<string> }>();
  let samples = 0, errors = 0, maxPids = 0;
  const deadline = o.durationS ? t0 + o.durationS * 1000 : Infinity;
  log(`auditing pid ${rootPid} with ${sampler.name} every ${intervalMs} ms${proxy ? `, proxy on :${proxy.port}` : ''}`);
  while (Date.now() < deadline && !(child && exited)) {
    const ts = (Date.now() - t0) / 1000;
    try {
      const { pids, conns } = await sampler.sample(rootPid);
      maxPids = Math.max(maxPids, pids.length);
      samples++;
      for (const c of conns) record(remotes, c, ts, !!o.includeLoopback, proxy?.port);
    } catch {
      errors++;
    }
    const wait = intervalMs - ((Date.now() - t0) % intervalMs);
    await new Promise((r) => setTimeout(r, wait));
  }
  if (child && !exited) {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 1500));
    if (!exited) child.kill('SIGKILL');
  }
  const durationS = (Date.now() - t0) / 1000;
  const list = [...remotes.values()].sort((a, b) => a.firstS - b.firstS);
  if (o.reverseDns !== false) {
    await Promise.all(list.map(async (r) => {
      try {
        r.hostnames = await Promise.race([dns.reverse(r.ip), new Promise<string[]>((res) => setTimeout(() => res([]), 3000))]);
      } catch {
        r.hostnames = [];
      }
    }));
  }
  const hits = proxy?.hits ?? [];
  await proxy?.close();
  let probe: unknown = null;
  if (o.probeOut && existsSync(o.probeOut)) {
    try {
      probe = JSON.parse(readFileSync(o.probeOut, 'utf8'));
    } catch {
      probe = { error: 'unreadable probe summary' };
    }
  }
  return {
    v: 1, kind: 'witness-egress-audit', label: o.label, config: o.config ?? {}, startedAt, durationS: round(durationS), platform: `${process.platform}-${process.arch}`,
    sampler: sampler.name, intervalMs, samples, sampleErrors: errors, maxPids,
    remotes: list.map(({ stateSet, ...r }) => ({ ...r, states: [...stateSet].sort(), firstS: round(r.firstS), lastS: round(r.lastS) })),
    proxy: { used: !!proxy, connects: aggregateHits(hits) },
    exitCode, probe, limitations: LIMITS,
  };
}

function record(m: Map<string, Remote & { stateSet: Set<string> }>, c: Conn, ts: number, loop: boolean, proxyPort?: number) {
  if (!loop && isLoopback(c.remoteAddr)) return;
  if (proxyPort && isLoopback(c.remoteAddr) && c.remotePort === proxyPort) return; // child → our own proxy
  if (c.state === 'LISTEN') return;
  const key = `${c.proto}|${c.remoteAddr}|${c.remotePort}`;
  const r = m.get(key);
  if (r) {
    r.lastS = ts;
    r.seen++;
    r.stateSet.add(c.state);
  } else m.set(key, { proto: c.proto, ip: c.remoteAddr, port: c.remotePort, hostnames: [], firstS: ts, lastS: ts, seen: 1, states: [], stateSet: new Set([c.state]) });
}

export function aggregateHits(hits: ProxyHit[]) {
  const m = new Map<string, { host: string; port: number; kind: string; firstS: number; lastS: number; count: number }>();
  for (const h of hits) {
    const k = `${h.kind}|${h.host}|${h.port}`;
    const s = h.tMs / 1000;
    const e = m.get(k);
    if (e) {
      e.lastS = round(s);
      e.count++;
    } else m.set(k, { host: h.host, port: h.port, kind: h.kind, firstS: round(s), lastS: round(s), count: 1 });
  }
  return [...m.values()].sort((a, b) => a.firstS - b.firstS);
}

const round = (x: number) => Math.round(x * 100) / 100;
