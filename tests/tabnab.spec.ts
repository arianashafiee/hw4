import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXT_PATH = path.resolve(__dirname, '..'); // repo root with manifest.json
const TEST_SERVER = 'http://127.0.0.1:8000';

test.describe('Tabnabbing Watch – E2E', () => {
  test('detects background morph (mock-tabnab)', async () => {
    if (!fs.existsSync(path.join(EXT_PATH, 'manifest.json'))) {
      test.fail(true, 'manifest.json not found at repo root');
    }

    // Launch persistent context with the extension loaded (extensions require headful)
    const userDataDir = path.join(process.cwd(), '.pw-user');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });

    try {
      // Page 1: attack page
      const p1 = await context.newPage();
      await p1.goto(`${TEST_SERVER}/test/mock-tabnab.html`);
      await p1.waitForTimeout(1200); // let baseline exist

      // Page 2: any page to force p1 to hidden
      const p2 = await context.newPage();
      await p2.goto('about:blank');
      await p2.bringToFront();
      await p2.waitForTimeout(2000); // allow hidden time + morph

      // Return to p1 (visible)
      await p1.bringToFront();

      // Expect overlay from the content script
      const overlay = await p1.waitForSelector('.tabnab-overlay-root', { timeout: 6000 });
      expect(overlay).toBeTruthy();

      // Optional: screenshot for artifacts
      await p1.screenshot({ path: 'tests-artifacts/mock-tabnab.png' });
    } finally {
      await context.close();
    }
  });
});
