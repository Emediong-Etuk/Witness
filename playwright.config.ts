import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-ui.json' }]],
  use: { baseURL: 'http://localhost:4173', viewport: { width: 1280, height: 800 }, trace: 'off' },
  webServer: {
    command: 'npm run preview:web -w @witness/desktop',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
