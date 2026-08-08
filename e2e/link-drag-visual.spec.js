import { test, expect } from './fixtures.js';

test.describe('Link Drag & Opacity Visual QA', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.board');
  });

  test('dragging a link over a card tile displays "Link anhängen" and 100% opaque solid background', async ({ page }) => {
    const cardTile = page.locator('.card').first();
    await expect(cardTile).toBeVisible();

    await cardTile.dispatchEvent('dragenter', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('text/uri-list', 'https://example.com/test-link');
        dt.setData('text/plain', 'https://example.com/test-link');
        return dt;
      }),
    });

    const dropOverlay = cardTile.locator('.card-drop-overlay');
    await expect(dropOverlay).toBeVisible();
    await expect(dropOverlay).toHaveText('Link anhängen');

    const bgColor = await dropOverlay.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toMatch(/rgb\(0,\s*87,\s*215\)/);

    await cardTile.screenshot({ path: 'e2e/screenshots/link-drag-overlay.png' });
  });

  test('dragging a file over a card tile displays "Dateien für Upload ablegen." with 100% opaque background', async ({ page }) => {
    const cardTile = page.locator('.card').first();
    await expect(cardTile).toBeVisible();

    await cardTile.dispatchEvent('dragenter', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        const file = new File(['test content'], 'test.png', { type: 'image/png' });
        dt.items.add(file);
        return dt;
      }),
    });

    const dropOverlay = cardTile.locator('.card-drop-overlay');
    await expect(dropOverlay).toBeVisible();
    await expect(dropOverlay).toHaveText('Dateien für Upload ablegen.');

    const bgColor = await dropOverlay.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(bgColor).toMatch(/rgb\(0,\s*87,\s*215\)/);
  });
});
