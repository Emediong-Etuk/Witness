import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { devInlineStyles } from '../../config/vite-dev-csp';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    // @smartspectra/node-sdk (native, koffi) stays external; workspace code is bundled.
    build: { externalizeDeps: true, rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    // Sandboxed preloads can only require('electron'), so the SDK's preload bridge is bundled in.
    build: { externalizeDeps: false, rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts'), external: ['electron'] } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), tailwindcss(), devInlineStyles()],
    worker: { format: 'es' },
    // assetsInlineLimit 0: fonts must be files under the CSP's font-src 'self'
    build: { assetsInlineLimit: 0, rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
  },
});
