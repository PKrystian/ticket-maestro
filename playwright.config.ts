import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: externalBaseUrl ?? 'http://127.0.0.1:5173', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
  webServer: externalBaseUrl ? undefined : { command: 'pnpm dev', url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 180_000, stdout: 'pipe', stderr: 'pipe' }
});
