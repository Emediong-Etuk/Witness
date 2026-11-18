// Browser build of the same renderer (no Electron, no SDK): replay mode only,
// with an in-memory bridge. Used for Playwright UI tests and the judge site demo.
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devInlineStyles } from '../../config/vite-dev-csp';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), tailwindcss(), devInlineStyles()],
  worker: { format: 'es' },
  build: { outDir: resolve(__dirname, 'dist-web'), emptyOutDir: true, assetsInlineLimit: 0 },
});
