// Fixture for specs that need no live Nextcloud.
//
// e2e/fixtures.js talks to a real server and guards mutations against a real
// board; it stays as-is for the integration specs. Anything asserting UI
// behaviour — drag, overlays, toasts, animation — has no business needing
// credentials, and needing them is why those specs never ran in CI.

import { test as base, expect } from '@playwright/test';
import { installMockBackend } from './mock-server.js';

export const test = base.extend({
  backend: async ({ page }, use) => {
    const backend = await installMockBackend(page);
    await use(backend);
  },

  // An uncaught exception fails the test that provoked it. `dragDepth is not
  // defined` crashed every drag into the card detail modal in production and no
  // test noticed, because a thrown handler looks identical to a handler that
  // chose to do nothing. Anything the page throws is a bug by default.
  page: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await use(page);
    expect(errors, `page threw during the test: ${errors.join(' | ')}`).toEqual([]);
  },

  // A board that is loaded and settled. Every drag spec starts here, so the
  // waiting rules live in one place rather than being re-derived per spec.
  board: async ({ page, backend }, use) => {
    await page.goto('/');
    await page.waitForSelector('.board', { state: 'visible' });
    await expect(page.locator('.card').first()).toBeVisible();
    await use({ page, backend });
  },
});

export { expect };
