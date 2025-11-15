import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: 0,
  reporter: [['list']],
  use: {
    // Deliberately headful because Chromium disables extensions in headless
    headless: false,
    viewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
  },
});