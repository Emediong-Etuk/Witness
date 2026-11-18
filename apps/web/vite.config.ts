import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devInlineStyles } from '../../config/vite-dev-csp';
import { defineConfig } from 'vite';

const REPO = resolve(__dirname, '../..');

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss(), devInlineStyles()],
  worker: { format: 'es' },
  // corpus/, bench/out/ and docs live outside this app and are bundled at build time
  server: { fs: { allow: [REPO] } },
  // assetsInlineLimit 0: fonts must be files, not data: URIs, under font-src 'self'
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500, assetsInlineLimit: 0 },
});
