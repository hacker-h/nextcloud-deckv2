import {
  test,
  expect,
  TEST_BOARD_ID,
  TEST_STACKS,
  assertBoardScoped,
  registerTestCard,
  installMutationGuard,
} from './fixtures.js';

test.describe('smoke', () => {
  test('app loads the dedicated test board', async ({ guardedPage: page, inbox }) => {
    await page.goto('/');

    await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });

    // The inbox panel is a lane too, so it is excluded before comparing the
    // board's own stacks.
    const stackIds = await page.locator('[data-stack-id]').evaluateAll((els) =>
      els.map((el) => Number(el.dataset.stackId))
    );
    const boardStackIds = stackIds.filter((id) => id !== inbox.stack.id).sort((a, b) => a - b);
    expect(boardStackIds).toEqual(Object.values(TEST_STACKS).sort((a, b) => a - b));

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
      /Mutation target must be an approved board/
    );
    expect(() => assertBoardScoped('DELETE', '/boards/109/stacks/1')).toThrow();
    expect(() => assertBoardScoped('POST', '/cards/10060/comments')).toThrow();

    // Reads are always allowed; only writes are board-scoped.
    expect(() => assertBoardScoped('GET', '/boards/113/stacks')).not.toThrow();
    expect(() => assertBoardScoped('PUT', `/boards/${TEST_BOARD_ID}/stacks/366/cards/1`)).not.toThrow();
    expect(() => assertBoardScoped('PUT', `/api/deck/boards/${TEST_BOARD_ID}/stacks/366/cards/1`)).not.toThrow();
    expect(() => assertBoardScoped('PUT', '/api/deck/boards/113/stacks/1/cards/2')).toThrow();
    expect(() => assertBoardScoped('POST', '/auth/logout')).not.toThrow();
    expect(() => assertBoardScoped('POST', '/auth/login')).not.toThrow();
    expect(() => assertBoardScoped('GET', '/auth/poll')).not.toThrow();

    // Comment URLs name no board, so an unknown card must never be writable.
    const ocsComments = (id) => `/ocs/v2.php/apps/deck/api/v1.0/cards/${id}/comments`;
    expect(() => assertBoardScoped('POST', ocsComments(10060))).toThrow();

    registerTestCard(10193);
    expect(() => assertBoardScoped('POST', ocsComments(10193))).not.toThrow();
    expect(() => assertBoardScoped('POST', `/api/ocs/apps/deck/api/v1.0/cards/10193/comments`)).not.toThrow();

    // A board id smuggled into the query string is not a scoping claim.
    const smuggled = `${ocsComments(10060)}?ref=/boards/${TEST_BOARD_ID}`;
    expect(() => assertBoardScoped('POST', smuggled)).toThrow();

    await expect(deck.request('PUT', '/boards/113/stacks/1/cards/2', {})).rejects.toThrow(
      /Mutation target must be an approved board/
    );

    const board = await deck.request('GET', `/boards/${TEST_BOARD_ID}`);
    expect(board.title).toBe('[deckv2] TEST BOARD - safe to break');
  });

  test('guard aborts a forbidden write before it reaches the network', async ({ page }) => {
    const violations = await installMutationGuard(page);
    await page.goto('/');
    await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });

    const blocked = await page.evaluate(async () => {
      try {
        await fetch('/index.php/apps/deck/api/v1.0/boards/113/stacks/1/cards/2', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'must never be sent' }),
        });
        return false;
      } catch {
        return true;
      }
    });

    expect(blocked).toBe(true);
    expect(violations.join('; ')).toContain('refusing PUT');
  });

  // The top bar's backdrop-filter makes it a stacking context, which traps the
  // switcher menu's z-index inside it. Anything on the board that forms its own
  // context then paints over the open menu, so the overlap is asserted here in
  // a real engine - jsdom has no layout and cannot catch it.
  test('the open board switcher covers the board beneath it', async ({ guardedPage: page }) => {
    await page.goto('/');
    await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });

    await page.locator('.trigger').click();
    await expect(page.locator('.menu')).toBeVisible();

    const covered = await page.evaluate(() => {
      const menu = document.querySelector('.menu').getBoundingClientRect();
      const overlapped = [];
      for (const el of document.querySelectorAll('.board .add, .board [data-card-id]')) {
        const r = el.getBoundingClientRect();
        const x = Math.max(r.left, menu.left) + 4;
        const y = Math.max(r.top, menu.top) + 4;
        if (x >= Math.min(r.right, menu.right) || y >= Math.min(r.bottom, menu.bottom)) continue;
        overlapped.push(document.elementsFromPoint(x, y).some((hit) => hit.closest('.menu')));
      }
      return { count: overlapped.length, allCoveredByMenu: overlapped.every(Boolean) };
    });

    expect(covered.count).toBeGreaterThan(0);
    expect(covered.allCoveredByMenu).toBe(true);
  });
});
