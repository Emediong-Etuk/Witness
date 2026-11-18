// npm run lab   — starts the dev-only lab recorder on http://127.0.0.1:5199/
import { exec } from 'node:child_process';
import { resolve } from 'node:path';
import { REPO, startLab } from './server.js';

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const lab = await startLab({
  port: Number(opt('port') ?? 5199),
  root: opt('root') ? resolve(opt('root')!) : REPO,
  token: opt('token'),
  test: args.includes('--test') && process.env.WITNESS_LAB_TEST === '1',
});
console.log(`Witness lab recorder: ${lab.url}  (localhost only; Ctrl+C to stop)`);
if (!args.includes('--no-open')) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} ${lab.url}`, () => {});
}
process.on('SIGINT', () => void lab.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void lab.close().then(() => process.exit(0)));
