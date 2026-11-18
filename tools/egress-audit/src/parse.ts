/** One observed connection from a socket table. */
export interface Conn {
  proto: 'tcp' | 'udp';
  localAddr: string;
  localPort: number;
  remoteAddr: string;
  remotePort: number;
  state: string;
  pid: number | null;
}

/** Split "addr:port", "[v6]:port" or "v6.port"-style endpoints. */
export function splitEndpoint(s: string): { addr: string; port: number } | null {
  const t = s.trim();
  if (!t || t === '*:*' || t === '*') return null;
  const v6 = /^\[([^\]]+)\]:(\d+|\*)$/.exec(t);
  if (v6) return v6[2] === '*' ? null : { addr: v6[1]!, port: Number(v6[2]) };
  const i = t.lastIndexOf(':');
  if (i <= 0) return null;
  const port = t.slice(i + 1);
  if (port === '*' || !/^\d+$/.test(port)) return null;
  return { addr: t.slice(0, i).replace(/%.*$/, ''), port: Number(port) };
}

/** `ss -tunpH` (Linux). */
export function parseSs(out: string): Conn[] {
  const res: Conn[] = [];
  for (const line of out.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length < 6) continue;
    const proto = f[0] === 'udp' ? 'udp' : f[0] === 'tcp' ? 'tcp' : null;
    if (!proto) continue;
    const local = splitEndpoint(f[4]!);
    const remote = splitEndpoint(f[5]!);
    if (!local || !remote) continue;
    const pid = /pid=(\d+)/.exec(line);
    res.push({ proto, localAddr: local.addr, localPort: local.port, remoteAddr: remote.addr, remotePort: remote.port, state: f[1]!, pid: pid ? Number(pid[1]) : null });
  }
  return res;
}

/** `lsof -nP -i -a -p <pids>` (macOS, Linux). */
export function parseLsof(out: string): Conn[] {
  const res: Conn[] = [];
  for (const line of out.split('\n')) {
    if (!line || line.startsWith('COMMAND')) continue;
    const f = line.trim().split(/\s+/);
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME [(STATE)]
    const nodeIdx = f.findIndex((x) => x === 'TCP' || x === 'UDP');
    if (nodeIdx < 0) continue;
    const name = f[nodeIdx + 1] ?? '';
    const state = (f[nodeIdx + 2] ?? '').replace(/[()]/g, '');
    const arrow = name.split('->');
    if (arrow.length !== 2) continue;
    const local = splitEndpoint(arrow[0]!);
    const remote = splitEndpoint(arrow[1]!);
    if (!local || !remote) continue;
    res.push({ proto: f[nodeIdx] === 'UDP' ? 'udp' : 'tcp', localAddr: local.addr, localPort: local.port, remoteAddr: remote.addr, remotePort: remote.port, state: state || 'UNKNOWN', pid: Number(f[1]) || null });
  }
  return res;
}

/** `Get-NetTCPConnection ... | ConvertTo-Json` (Windows). */
export function parseWindowsJson(out: string): Conn[] {
  if (!out.trim()) return [];
  const raw = JSON.parse(out) as unknown;
  const rows = (Array.isArray(raw) ? raw : [raw]) as { LocalAddress: string; LocalPort: number; RemoteAddress: string; RemotePort: number; State: number | string; OwningProcess: number }[];
  const STATES: Record<number, string> = { 1: 'CLOSED', 2: 'LISTEN', 3: 'SYN_SENT', 4: 'SYN_RECEIVED', 5: 'ESTABLISHED', 6: 'FIN_WAIT1', 7: 'FIN_WAIT2', 8: 'CLOSE_WAIT', 9: 'CLOSING', 10: 'LAST_ACK', 11: 'TIME_WAIT', 12: 'DELETE_TCB', 100: 'BOUND' };
  return rows
    .filter((r) => r.RemoteAddress && r.RemoteAddress !== '0.0.0.0' && r.RemoteAddress !== '::')
    .map((r) => ({ proto: 'tcp' as const, localAddr: r.LocalAddress, localPort: r.LocalPort, remoteAddr: r.RemoteAddress, remotePort: r.RemotePort, state: typeof r.State === 'number' ? (STATES[r.State] ?? String(r.State)) : r.State, pid: r.OwningProcess }));
}

/** `ps -A -o pid=,ppid=` → children map. */
export function parsePs(out: string): Map<number, number[]> {
  const kids = new Map<number, number[]>();
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const pid = Number(m[1]), ppid = Number(m[2]);
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid)!.push(pid);
  }
  return kids;
}

export function descendants(root: number, kids: Map<number, number[]>): number[] {
  const out = [root];
  for (let i = 0; i < out.length; i++) for (const k of kids.get(out[i]!) ?? []) if (!out.includes(k)) out.push(k);
  return out;
}

export function isLoopback(addr: string): boolean {
  return addr === '::1' || addr.startsWith('127.') || addr === 'localhost' || addr.startsWith('::ffff:127.');
}
