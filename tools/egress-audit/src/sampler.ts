import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { descendants, parseLsof, parsePs, parseSs, parseWindowsJson, type Conn } from './parse.js';

const run = promisify(execFile);
const has = async (cmd: string) => {
  try {
    await run(process.platform === 'win32' ? 'where' : 'which', [cmd]);
    return true;
  } catch {
    return false;
  }
};

export interface Sampler {
  name: string;
  sample(rootPid: number): Promise<{ pids: number[]; conns: Conn[] }>;
}

async function processTree(root: number): Promise<number[]> {
  if (process.platform === 'win32') {
    const { stdout } = await run('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }']);
    return descendants(root, parsePs(stdout));
  }
  const { stdout } = await run('ps', ['-A', '-o', 'pid=,ppid=']);
  return descendants(root, parsePs(stdout));
}

/** Picks the best socket-table source for this OS: ss (Linux), lsof (macOS/Linux), Get-NetTCPConnection (Windows). */
export async function createSampler(): Promise<Sampler> {
  if (process.platform === 'win32') {
    return {
      name: 'Get-NetTCPConnection',
      async sample(root) {
        const pids = await processTree(root);
        const { stdout } = await run('powershell', ['-NoProfile', '-Command', `Get-NetTCPConnection -OwningProcess ${pids.join(',')} -ErrorAction SilentlyContinue | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,State,OwningProcess | ConvertTo-Json -Compress`]);
        return { pids, conns: parseWindowsJson(stdout) };
      },
    };
  }
  if (process.platform === 'linux' && (await has('ss'))) {
    return {
      name: 'ss -tunpH',
      async sample(root) {
        const pids = await processTree(root);
        const { stdout } = await run('ss', ['-tunpH']);
        const set = new Set(pids);
        return { pids, conns: parseSs(stdout).filter((c) => c.pid !== null && set.has(c.pid)) };
      },
    };
  }
  return {
    name: 'lsof -nP -i -a -p',
    async sample(root) {
      const pids = await processTree(root);
      try {
        const { stdout } = await run('lsof', ['-nP', '-i', '-a', '-p', pids.join(',')], { maxBuffer: 16 * 1024 * 1024 });
        return { pids, conns: parseLsof(stdout) };
      } catch (e) {
        // lsof exits 1 when nothing matches
        const out = (e as { stdout?: string }).stdout ?? '';
        return { pids, conns: parseLsof(out) };
      }
    },
  };
}
