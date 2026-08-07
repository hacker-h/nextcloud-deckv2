import { test, expect, TEST_STACKS } from './fixtures.js';

function card(page, id) {
  return page.locator(`[data-card-id="${id}"]`);
}

function selected(page) {
  return page.locator('[data-card-id][aria-pressed="true"]');
}

async function openTestBoard(page) {
  await page.goto('/');
  await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });
}

async function cardIdsIn(page, stackId) {
  return page
    .locator(`[data-stack-id="${stackId}"] [data-card-id]`)
    .evaluateAll((els) => els.map((el) => Number(el.dataset.cardId)));
}

test.describe('multi-select', () => {
  test('shift+click selects a single card and never opens the detail', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });

    await expect(selected(page)).toHaveCount(1);
    expect(await page.locator('[role="dialog"]').count()).toBe(0);
  });

  test('shift+click a second card selects the whole range', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });
    await card(page, ids[2]).click({ modifiers: ['Shift'] });

    await expect(selected(page)).toHaveCount(3);
  });

  test('shift+click an already-selected card toggles just that card off', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });
    await card(page, ids[2]).click({ modifiers: ['Shift'] });
    await card(page, ids[1]).click({ modifiers: ['Shift'] });

    await expect(selected(page)).toHaveCount(2);
    await expect(card(page, ids[1])).toHaveAttribute('aria-pressed', 'false');
  });

  test('a range never spans two stacks', async ({ page }) => {
    await openTestBoard(page);
    const doing = await cardIdsIn(page, TEST_STACKS.doing);
    const blocked = await cardIdsIn(page, TEST_STACKS.blocked);

    await card(page, doing[0]).click({ modifiers: ['Shift'] });
    await card(page, blocked[2]).click({ modifiers: ['Shift'] });

    await expect(selected(page)).toHaveCount(2);
  });

  test('Escape clears the selection', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });
    await expect(selected(page)).toHaveCount(1);

    await page.keyboard.press('Escape');

    await expect(selected(page)).toHaveCount(0);
  });

  test('a plain click opens the detail and leaves the selection alone', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });
    await card(page, ids[1]).click();

    await expect(page.locator('[role="dialog"]')).toHaveCount(1);
    await expect(card(page, ids[0])).toHaveAttribute('aria-pressed', 'true');
  });

  test('the selection counter reports the number of selected cards', async ({ page }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.doing);

    await card(page, ids[0]).click({ modifiers: ['Shift'] });
    await card(page, ids[2]).click({ modifiers: ['Shift'] });

    await expect(page.getByText('3 selected')).toBeVisible();
  });
});
