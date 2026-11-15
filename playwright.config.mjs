import { defineConfig } from 'playwright/test';

// APIs are synthetic. Production mode serves real dist assets through local-only Wrangler.
const production = process.env.PLAYWRIGHT_PRODUCTION === '1';
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
    // Local-only test overrides: installed workerd date ceiling; sites page access
    // avoids standalone server-session setup. All browser /api requests are synthetic.
    // This is not standalone-auth acceptance; never use these overrides remotely.
    command: production ? 'npm start -- --port 4175 --compatibility-date 2026-05-22 --var AUTH_MODE:sites' : 'node e2e/server.mjs',
    timeout: 60_000,
    env: { XDG_CONFIG_HOME: new URL('./.wrangler/e2e-config', import.meta.url).pathname, WRANGLER_SEND_METRICS: 'false' },
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
