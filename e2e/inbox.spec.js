import { test, expect, TEST_BOARD_ID, TEST_STACKS, asList } from './fixtures.js';

function card(page, id) {
  return page.locator(`[data-card-id="${id}"]`);
}

function inboxPanel(page) {
  return page.locator('aside.rail');
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

async function dragTo(page, from, to) {
  const start = await center(from);
  const target = await center(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 14 });
  await page.mouse.up();
}

async function locate(deck, inboxBoardId, cardId) {
  for (const boardId of [TEST_BOARD_ID, inboxBoardId]) {
    const stacks = asList(await deck.request('GET', `/boards/${boardId}/stacks`));
    for (const stack of stacks) {
      const hit = (stack.cards ?? []).find((c) => c.id === cardId);
      if (hit) return { boardId, stackId: stack.id, card: hit };
    }
  }
  return null;
}

async function boardOfCard(deck, inboxBoardId, cardId) {
  const at = await locate(deck, inboxBoardId, cardId);
  return at && { boardId: at.boardId, stackId: at.stackId };
}

// Cleanup must search BOTH boards for the card, not just the one it is being
// restored to: a card stranded on the inbox board would otherwise be invisible
// here and silently left behind.
async function restoreTo(deck, inboxBoardId, cardId, toStackId) {
  const at = await locate(deck, inboxBoardId, cardId);
  if (!at) throw new Error(`Card ${cardId} vanished from both boards`);
  if (at.boardId === TEST_BOARD_ID && at.stackId === toStackId) return;

  const owner = typeof at.card.owner === 'object' ? at.card.owner?.uid : at.card.owner;
  await deck.request('PUT', `/boards/${TEST_BOARD_ID}/stacks/${toStackId}/cards/${cardId}`, {
    title: at.card.title,
    type: at.card.type ?? 'plain',
    description: at.card.description ?? '',
    order: at.card.order,
    ...(owner === undefined ? {} : { owner }),
  });
}

test.describe('cross-board inbox', () => {
  test('the inbox panel renders and is not offered as a board to switch to', async ({
    guardedPage: page,
  }) => {
    await openTestBoard(page);

    await expect(inboxPanel(page)).toBeVisible();
    await expect(inboxPanel(page).getByRole('heading', { name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('option', { name: /managed, do not edit/ })).toHaveCount(0);
  });

  test('collapsing the inbox persists across a reload', async ({ guardedPage: page }) => {
    await openTestBoard(page);

    await page.getByRole('button', { name: 'Collapse inbox' }).click();
    await expect(inboxPanel(page)).toHaveClass(/collapsed/);

    await page.reload();
    await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });
    await expect(inboxPanel(page)).toHaveClass(/collapsed/);

    await page.getByRole('button', { name: 'Expand inbox' }).click();
    await expect(inboxPanel(page)).not.toHaveClass(/collapsed/);
  });

  test('a card dragged into the inbox actually changes board on the server', async ({
    guardedPage: page,
    deck,
    inbox,
  }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.todo);
    const moving = ids[0];

    try {
      await dragTo(page, card(page, moving), inboxPanel(page).locator('[data-cards]'));

      await expect
        .poll(() => boardOfCard(deck, inbox.board.id, moving).then((r) => r?.boardId), {
          timeout: 20_000,
        })
        .toBe(inbox.board.id);

      await expect(inboxPanel(page).locator(`[data-card-id="${moving}"]`)).toBeVisible();
    } finally {
      await restoreTo(deck, inbox.board.id, moving, TEST_STACKS.todo);
    }
  });

  test('a card dragged out of the inbox lands on the current board', async ({
    guardedPage: page,
    deck,
    inbox,
  }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.todo);
    const moving = ids[0];

    try {
      await dragTo(page, card(page, moving), inboxPanel(page).locator('[data-cards]'));
      await expect
        .poll(() => boardOfCard(deck, inbox.board.id, moving).then((r) => r?.boardId), {
          timeout: 20_000,
        })
        .toBe(inbox.board.id);

      await dragTo(
        page,
        inboxPanel(page).locator(`[data-card-id="${moving}"]`),
        page.locator(`[data-stack-id="${TEST_STACKS.done}"] [data-cards]`)
      );

      await expect
        .poll(() => boardOfCard(deck, inbox.board.id, moving), { timeout: 20_000 })
        .toEqual({ boardId: TEST_BOARD_ID, stackId: TEST_STACKS.done });
    } finally {
      await restoreTo(deck, inbox.board.id, moving, TEST_STACKS.todo);
    }
  });

  test('the inbox survives a board switch', async ({ guardedPage: page, deck, inbox }) => {
    await openTestBoard(page);
    const ids = await cardIdsIn(page, TEST_STACKS.todo);
    const moving = ids[0];

    try {
      await dragTo(page, card(page, moving), inboxPanel(page).locator('[data-cards]'));
      await expect(inboxPanel(page).locator(`[data-card-id="${moving}"]`)).toBeVisible();

      // The drop renders optimistically, so the move must be confirmed server
      // side before reloading - a reload would otherwise abort the in-flight
      // PUT and the assertion below would be testing the aborted request.
      await expect
        .poll(() => boardOfCard(deck, inbox.board.id, moving).then((r) => r?.boardId), {
          timeout: 20_000,
        })
        .toBe(inbox.board.id);

      await page.reload();
      await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });

      await expect(inboxPanel(page).locator(`[data-card-id="${moving}"]`)).toBeVisible();
    } finally {
      await restoreTo(deck, inbox.board.id, moving, TEST_STACKS.todo);
    }
  });
});
