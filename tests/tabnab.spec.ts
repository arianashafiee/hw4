// path: tests/tabnab.spec.ts
import { test, expect, chromium } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const EXT_PATH = path.resolve(__dirname, '..');       // repo root
const TEST_SERVER = 'http://127.0.0.1:8000';

test.describe('Tabnabbing Watch – E2E', () => {
  test('detects background morph (mock-tabnab)', async () => {
    const userDataDir = path.join(process.cwd(), '.pw-user');
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
      ],
    });

    try {
      const p1 = await context.newPage();
      await p1.goto(`${TEST_SERVER}/test/mock-tabnab.html`);

      // ✅ ensure content script is injected
      await p1.waitForFunction(() =>
        document.documentElement.hasAttribute('data-tabnab-installed'),
        { timeout: 10_000 }
      );

      // Let baseline heartbeat run at least once
      await p1.waitForTimeout(1500);

      // Hide p1 by focusing p2 for a couple seconds (morph occurs on re-show)
      const p2 = await context.newPage();
      await p2.goto('about:blank');
      await p2.bringToFront();
      await p2.waitForTimeout(2500);

      // Return to p1; give the page a moment to morph and the extension to capture
      await p1.bringToFront();
      await p1.waitForTimeout(1500);

      // Look for overlay element (attached is enough; it’s visibly full-screen)
      const overlay = await p1.waitForSelector('.tabnab-overlay-root', {
        state: 'attached',
        timeout: 10_000,
      });
      expect(overlay).toBeTruthy();

      await p1.screenshot({ path: 'tests-artifacts/mock-tabnab.png' });
    } finally {
      await context.close();
    }
  });
});
