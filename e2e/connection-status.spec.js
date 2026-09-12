import { test, expect } from './hermetic.js';

test('connection dot turns red offline and green after reconnecting', async ({ page, context, backend }) => {
  await page.goto('/');
  const dot = page.locator('.connection-status');
  await expect(dot).toHaveAttribute('aria-label', 'Online – Server erreichbar');
  await context.setOffline(true);
  await expect(dot).toHaveAttribute('aria-label', 'Offline – keine Serververbindung');
  await expect(dot.locator('span')).toHaveCSS('background-color', 'rgb(248, 113, 113)');
  await context.setOffline(false);
  await expect(dot).toHaveAttribute('aria-label', 'Online – Server erreichbar');
  await expect(dot.locator('span')).toHaveCSS('background-color', 'rgb(74, 222, 128)');
  const box = await dot.boundingBox();
  expect(box.x).toBe(12);
  expect(page.viewportSize().height - box.y - box.height).toBe(8);
  await page.screenshot({ path: 'test-results/connection-status.png' });
});
