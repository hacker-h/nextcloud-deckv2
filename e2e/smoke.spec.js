import {
  test,
  expect,
  TEST_BOARD_ID,
  TEST_STACKS,
  assertBoardScoped,
  registerTestCard,
} from './fixtures.js';

test.describe('smoke', () => {
  test('app loads the dedicated test board', async ({ guardedPage: page }) => {
    await page.goto('/');

    await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });

    const stackIds = await page.locator('[data-stack-id]').evaluateAll((els) =>
      els.map((el) => Number(el.dataset.stackId)).sort((a, b) => a - b)
    );
    expect(stackIds).toEqual(Object.values(TEST_STACKS).sort((a, b) => a - b));

    await expect(page.getByText('[deckv2] TEST BOARD - safe to break')).toBeVisible();
    await page.screenshot({ path: '.sisyphus/evidence/card-detail/task-3-smoke.png' });
  });

  test('smoke renders cards without any native Deck link', async ({ guardedPage: page }) => {
    await page.goto('/');
    await expect(page.locator('[data-card-id]').first()).toBeVisible({ timeout: 15_000 });

    expect(await page.locator('[data-card-id] a').count()).toBe(0);
    expect(await page.locator('a[href*="apps/deck"]').count()).toBe(0);
  });

  test('guard refuses a mutation aimed at the real board', async ({ deck }) => {
    expect(() => assertBoardScoped('PUT', '/boards/113/stacks/1/cards/2')).toThrow(
      `Mutation target must be board ${TEST_BOARD_ID}`
    );
    expect(() => assertBoardScoped('DELETE', '/boards/109/stacks/1')).toThrow();
    expect(() => assertBoardScoped('POST', '/cards/10060/comments')).toThrow();

    // Reads are always allowed; only writes are board-scoped.
    expect(() => assertBoardScoped('GET', '/boards/113/stacks')).not.toThrow();
    expect(() => assertBoardScoped('PUT', `/boards/${TEST_BOARD_ID}/stacks/366/cards/1`)).not.toThrow();

    // Comment URLs name no board, so an unknown card must never be writable.
    const ocsComments = (id) => `/ocs/v2.php/apps/deck/api/v1.0/cards/${id}/comments`;
    expect(() => assertBoardScoped('POST', ocsComments(10060))).toThrow();

    registerTestCard(10193);
    expect(() => assertBoardScoped('POST', ocsComments(10193))).not.toThrow();

    // A board id smuggled into the query string is not a scoping claim.
    const smuggled = `${ocsComments(10060)}?ref=/boards/${TEST_BOARD_ID}`;
    expect(() => assertBoardScoped('POST', smuggled)).toThrow();

    await expect(deck.request('PUT', '/boards/113/stacks/1/cards/2', {})).rejects.toThrow(
      /Mutation target must be board 116/
    );

    const board = await deck.request('GET', `/boards/${TEST_BOARD_ID}`);
    expect(board.title).toBe('[deckv2] TEST BOARD - safe to break');
  });
});
