import { defineConfig } from 'playwright/test';

// Browser traffic is intercepted with synthetic fixtures. No Worker or remote D1 is started.
export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    headless: true,
    reducedMotion: 'reduce',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    } : {},
    // Do not capture inputs, request bodies or browser sessions.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'node e2e/server.mjs',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
