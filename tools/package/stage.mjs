#!/usr/bin/env node
// Builds a self-contained app folder for electron-builder, outside the npm
// workspace: the already-built app (apps/desktop/out) plus only its runtime
// dependencies, pinned to the exact versions in the root package-lock.json.
//
// Usage: node tools/package/stage.mjs <stage-dir>
// Then:  npx electron-builder --projectDir <stage-dir> --win|--mac|--linux --publish never
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const stage = resolve(process.argv[2] ?? join(REPO, 'dist-pack'));
const desktop = JSON.parse(readFileSync(join(REPO, 'apps/desktop/package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(REPO, 'package-lock.json'), 'utf8')).packages;
const out = join(REPO, 'apps/desktop/out');
if (!existsSync(join(out, 'main/index.js'))) throw new Error('apps/desktop/out is missing: run npm run build:desktop first');

/** Exact versions of the runtime dependency closure, read from the root lockfile. */
function closure(names) {
  const pinned = {};
  const todo = [...names];
  while (todo.length) {
    const n = todo.pop();
    if (pinned[n]) continue;
    const e = lock[`node_modules/${n}`];
    if (!e?.version) throw new Error(`${n} is not in package-lock.json`);
    pinned[n] = e.version;
    for (const d of Object.keys({ ...(e.dependencies ?? {}), ...(e.optionalDependencies ?? {}) })) todo.push(d);
  }
  return pinned;
}

const runtime = Object.keys(desktop.dependencies);
const pinned = closure(runtime);
const electron = lock['node_modules/electron'].version;

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(out, join(stage, 'out'), { recursive: true });
cpSync(join(REPO, 'LICENSE'), join(stage, 'LICENSE'));

const pkg = {
  name: 'witness',
  productName: 'Witness',
  version: desktop.version,
  description: 'Camera vitals that show their work. Built on the Presage SmartSpectra SDK.',
  author: 'Emediong Etuk',
  license: 'MIT',
  homepage: 'https://github.com/Emediong-Etuk/Witness',
  main: 'out/main/index.js',
  dependencies: Object.fromEntries(runtime.map((n) => [n, pinned[n]])),
  overrides: pinned,
  allowScripts: JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).allowScripts ?? {},
  build: {
    appId: 'dev.witness.app',
    productName: 'Witness',
    electronVersion: electron,
    npmRebuild: false,
    directories: { output: 'release' },
    files: ['out/**/*', 'package.json', 'LICENSE', 'node_modules/**/*', '!node_modules/@smartspectra/node-sdk-*/**', '!node_modules/electron/**'],
    // koffi loads a native .node file; it must sit outside the asar archive.
    asarUnpack: ['node_modules/koffi/**'],
    // Only this platform's SmartSpectra runtime, next to the app; the main
    // process points SMARTSPECTRA_CAPI_PATH at it when packaged.
    extraResources: [{ from: 'node_modules/@smartspectra/node-sdk-${platform}-${arch}', to: 'smartspectra' }],
    win: { target: [{ target: 'nsis', arch: ['x64'] }], artifactName: 'Witness-Setup-${version}-win-x64.${ext}' },
    nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
    mac: { target: [{ target: 'dmg', arch: ['arm64'] }], identity: '-', hardenedRuntime: false, gatekeeperAssess: false, category: 'public.app-category.healthcare-fitness', artifactName: 'Witness-${version}-mac-arm64.${ext}', extendInfo: { NSCameraUsageDescription: 'Witness uses the camera to measure pulse, breathing and HRV, only after you agree, each session.' } },
    linux: { target: [{ target: 'AppImage', arch: ['x64'] }], category: 'Utility', artifactName: 'Witness-${version}-linux-x86_64.${ext}' },
    // Ad-hoc signature ('-'): Apple Silicon refuses an unsigned modified bundle as "damaged".
    publish: null,
  },
};
writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
// Install the pinned runtime closure only (the Electron binary comes from electron-builder).
execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: stage, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ELECTRON_SKIP_BINARY_DOWNLOAD: '1' } });
console.log(`staged ${stage}: ${Object.keys(pinned).length} runtime packages, electron ${electron}`);
