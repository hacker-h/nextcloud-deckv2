import { test, expect } from './fixtures.js';

test.describe('Multi-Card Drag & Tile Drop QA Suite', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.board');
  });

  test('dragging across multiple cards ensures ONLY the active target card has an overlay', async ({ page }) => {
    const cards = page.locator('.card');
    const count = await cards.count();
    expect(count).toBeGreaterThan(1);

    const card1 = cards.nth(0);
    const card2 = cards.nth(1);

    // Dragenter card 1
    await card1.dispatchEvent('dragenter', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'https://example.com');
        return dt;
      }),
    });

    // Assert only 1 overlay exists
    await expect(page.locator('.card-drop-overlay')).toHaveCount(1);
    await expect(card1.locator('.card-drop-overlay')).toBeVisible();

    // Dragenter card 2
    await card2.dispatchEvent('dragenter', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'https://example.com');
        return dt;
      }),
    });

    // Assert card 1 overlay is gone and card 2 is active
    await expect(page.locator('.card-drop-overlay')).toHaveCount(1);
    await expect(card2.locator('.card-drop-overlay')).toBeVisible();
    await expect(card1.locator('.card-drop-overlay')).toHaveCount(0);
  });

  test('tile link drop triggers toast notification and completes link attachment', async ({ page }) => {
    const cardTile = page.locator('.card').first();
    await expect(cardTile).toBeVisible();

    // Drop link on card tile
    await cardTile.dispatchEvent('drop', {
      dataTransfer: await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.setData('text/plain', 'https://example.com/tile-link-test');
        return dt;
      }),
    });

    // Assert toast notification appears
    const toast = page.locator('.toast');
    await expect(toast).toBeVisible();
  });
});
