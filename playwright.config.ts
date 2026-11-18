import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e.json' }]],
  use: { viewport: { width: 1280, height: 800 }, trace: 'off' },
  projects: [
    { name: 'app', testMatch: /ui-replay\.spec\.ts/, use: { baseURL: 'http://localhost:4173' } },
    { name: 'site', testMatch: /site\.spec\.ts/, use: { baseURL: 'http://localhost:4174' } },
  ],
  webServer: [
    { command: 'npm run preview:web -w @witness/desktop', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run preview -w @witness/web', url: 'http://localhost:4174', reuseExistingServer: true, timeout: 60_000 },
  ],
});
