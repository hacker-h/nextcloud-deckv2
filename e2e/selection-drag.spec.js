import { test, expect, TEST_BOARD_ID, TEST_STACKS } from './fixtures.js';

function card(page, id) {
  return page.locator(`[data-card-id="${id}"]`);
}

function asArray(value) {
  return Array.isArray(value) ? value : value.data;
}

async function stacksFromApi(deck) {
  return asArray(await deck.request('GET', `/boards/${TEST_BOARD_ID}/stacks`));
}

async function apiStackOf(deck, cardId) {
  for (const stack of await stacksFromApi(deck)) {
    if ((stack.cards ?? []).some((c) => c.id === cardId)) return stack.id;
  }
  return null;
}

async function moveViaApi(deck, cardId, toStackId) {
  const stacks = await stacksFromApi(deck);
  let found = null;
  for (const stack of stacks) {
    const hit = (stack.cards ?? []).find((c) => c.id === cardId);
    if (hit) found = hit;
  }
  if (!found || found.stackId === toStackId) return;
  const owner = typeof found.owner === 'object' ? found.owner?.uid : found.owner;
  await deck.request('PUT', `/boards/${TEST_BOARD_ID}/stacks/${toStackId}/cards/${cardId}`, {
    title: found.title,
    type: found.type ?? 'plain',
    description: found.description ?? '',
    order: found.order,
    ...(owner === undefined ? {} : { owner }),
  });
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

async function center(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('multi-card drag', () => {
  test('dragging a selected card carries the whole selection and persists every move', async ({
    guardedPage: page,
    deck,
  }) => {
    await openTestBoard(page);
    const source = await cardIdsIn(page, TEST_STACKS.blocked);
    expect(source.length).toBeGreaterThanOrEqual(2);
    const moving = [source[0], source[1]];

    try {
      await card(page, moving[0]).click({ modifiers: ['Shift'] });
      await card(page, moving[1]).click({ modifiers: ['Shift'] });
      await expect(page.locator('[data-card-id][aria-pressed="true"]')).toHaveCount(2);

      const start = await center(card(page, moving[0]));
      const target = await center(page.locator(`[data-stack-id="${TEST_STACKS.done}"] [data-cards]`));

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 12 });

      await expect(page.locator('.preview .count')).toHaveText('2');

      await page.mouse.up();

      for (const id of moving) {
        await expect.poll(() => apiStackOf(deck, id), { timeout: 20_000 }).toBe(TEST_STACKS.done);
      }
      expect(await page.locator('[role="dialog"]').count()).toBe(0);
    } finally {
      for (const id of moving) await moveViaApi(deck, id, TEST_STACKS.blocked);
    }
  });

  test('bulk move via the selection bar moves every selected card', async ({
    guardedPage: page,
    deck,
  }) => {
    await openTestBoard(page);
    const source = await cardIdsIn(page, TEST_STACKS.todo);
    expect(source.length).toBeGreaterThanOrEqual(2);
    const moving = [source[0], source[1]];

    try {
      await card(page, moving[0]).click({ modifiers: ['Shift'] });
      await card(page, moving[1]).click({ modifiers: ['Shift'] });

      await page.getByLabel('Selection to list').selectOption(String(TEST_STACKS.done));

      for (const id of moving) {
        await expect.poll(() => apiStackOf(deck, id), { timeout: 20_000 }).toBe(TEST_STACKS.done);
      }
      await expect(page.locator('[data-card-id][aria-pressed="true"]')).toHaveCount(0);
    } finally {
      for (const id of moving) await moveViaApi(deck, id, TEST_STACKS.todo);
    }
  });

  test('dragging an unselected card moves only that card', async ({ guardedPage: page, deck }) => {
    await openTestBoard(page);
    const blocked = await cardIdsIn(page, TEST_STACKS.blocked);
    const selectedId = blocked[0];
    const draggedId = blocked[1];

    try {
      await card(page, selectedId).click({ modifiers: ['Shift'] });

      const start = await center(card(page, draggedId));
      const target = await center(page.locator(`[data-stack-id="${TEST_STACKS.done}"] [data-cards]`));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(target.x, target.y, { steps: 12 });
      await page.mouse.up();

      await expect.poll(() => apiStackOf(deck, draggedId), { timeout: 20_000 }).toBe(TEST_STACKS.done);
      expect(await apiStackOf(deck, selectedId)).toBe(TEST_STACKS.blocked);
    } finally {
      await moveViaApi(deck, draggedId, TEST_STACKS.blocked);
    }
  });
});
