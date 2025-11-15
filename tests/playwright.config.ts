// path: tests/playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',            // <— was 'tests', which pointed to tests/tests
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: { headless: false, viewport: { width: 1366, height: 768 }, ignoreHTTPSErrors: true },
});
