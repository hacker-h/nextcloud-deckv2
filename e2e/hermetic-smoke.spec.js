import { test, expect } from './hermetic.js';

// Proves the mock backend is sufficient to render a real board. If this fails,
// every other hermetic spec is meaningless, so it runs first by filename.
test('mock backend renders a board with cards', async ({ board }) => {
  const { page } = board;
  await expect(page.locator('.board')).toBeVisible();
  expect(await page.locator('.card').count()).toBeGreaterThan(4);
  await expect(page.locator('.card').first()).toContainText('Pizza Margherita');
});
