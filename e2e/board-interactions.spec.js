import { test, expect } from './hermetic.js';

test.describe('board interactions', () => {
  test('creates a card from a stack footer without reloading the board', async ({ board }) => {
    const { page, backend } = board;
    const stack = page.locator('[data-stack-id]').first();

    await stack.getByRole('button', { name: 'Eine Karte hinzufügen' }).click();
    await stack.getByRole('textbox', { name: /Neue Karte/ }).fill('E2E created card');
    await stack.getByRole('textbox', { name: /Neue Karte/ }).press('Enter');

    await expect(stack.getByRole('button', { name: 'E2E created card' })).toBeVisible();
    const created = backend.find('/cards', 'POST').at(-1)?.body;
    expect(created).toMatchObject({ title: 'E2E created card' });
    expect(created.order).toBeGreaterThan(0);
    await expect(page.locator('.board-skel')).toHaveCount(0);
  });

  test('drags empty board background to scroll without opening a card', async ({ board }) => {
    const { page } = board;
    await page.setViewportSize({ width: 900, height: 700 });
    const boardElement = page.locator('[data-board]');
    const firstStack = page.locator('[data-stack-id]').first();
    const boardBox = await boardElement.boundingBox();
    const stackBox = await firstStack.boundingBox();
    expect(boardBox).not.toBeNull();
    expect(stackBox).not.toBeNull();
    const start = { x: stackBox.x + stackBox.width + 6, y: boardBox.y + 20 };
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.hasAttribute('data-board'), start)).toBe(true);

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 160, start.y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => boardElement.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('switches to a preloaded board without showing a skeleton', async ({ board }) => {
    const { page } = board;
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/stacks')).length)).toBeGreaterThan(1);
    await page.evaluate(() => {
      window.__sawBoardSkeleton = false;
      window.__boardObserver = new MutationObserver(() => {
        if (document.querySelector('.board-skel')) window.__sawBoardSkeleton = true;
      });
      window.__boardObserver.observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('.switcher .trigger').click();
    const target = page.locator('.switcher .item:not(.active)').first();
    const targetName = (await target.locator('.label').textContent()).trim();
    await target.hover();
    await target.click();

    await expect(page.locator('.board')).toBeVisible();
    await expect(page.locator('.switcher .trigger')).toContainText(targetName);
    expect(await page.evaluate(() => {
      window.__boardObserver.disconnect();
      return window.__sawBoardSkeleton;
    })).toBe(false);
  });
});
