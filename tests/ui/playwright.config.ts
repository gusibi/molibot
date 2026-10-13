import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: '**/*.spec.ts', fullyParallel: false, workers: 1,
  timeout: 45000, expect: { timeout: 15000 }, retries: 0,
  outputDir: '../../.test-tmp/ui/results',
  reporter: [['list'], ['html', { outputFolder: '../../.test-tmp/ui/report', open: 'never' }]],
  use: { actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1120, height: 760 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1120, height: 760 } } }
  ]
});
