import { test, expect, TEST_BOARD_ID, TEST_STACKS } from './fixtures.js';

const CARD_ID = 10193;
const CARD_TITLE = 'Buy milk';
const SYNTHETIC_CLICK_WINDOW_MS = 100;

function card(page, id = CARD_ID) {
  return page.locator(`[data-card-id="${id}"]`);
}

function dialogs(page) {
  return page.locator('[role="dialog"]');
}

async function dialogCount(page) {
  return dialogs(page).count();
}

async function expectNoDialog(page) {
  expect(await dialogCount(page)).toBe(0);
}

async function expectOneDialog(page) {
  expect(await dialogCount(page)).toBe(1);
}

async function openTestBoard(page) {
  await page.goto('/');
  await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });
  await expect(card(page)).toBeVisible();
}

// The comment list is the one detail read the dev origin cannot make: /ocs/ CORS
// allows only the deployed SPA origin (T19), so from localhost:5173 the preflight
// returns an ACAO the browser rejects. The card itself and its attachments are
// fetched live so activation stays a real end-to-end read.
async function routeDetailReads(page) {
  await page.route(/\/ocs\/v2\.php\/apps\/deck\/api\/v1\.0\/cards\/10193\/comments(?:[?#]|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: [] } }),
    });
  });
}

async function closeDialog(page) {
  await page.getByLabel('Close card detail').click();
  await expect.poll(() => dialogCount(page)).toBe(0);
}

function trackCardRequests(page) {
  const detailGets = [];
  const movePuts = [];

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'GET' && /\/cards\/10193(?:[?#]|$)/.test(url)) detailGets.push(req);
    if (req.method() === 'PUT' && /\/boards\/116\/stacks\/\d+\/cards\/\d+(?:[?#]|$)/.test(url)) {
      movePuts.push(req);
    }
  });

  return { detailGets, movePuts };
}

function asArray(value) {
  return Array.isArray(value) ? value : value.data;
}

async function boardCard(deck, id = CARD_ID) {
  const stacks = asArray(await deck.request('GET', `/boards/${TEST_BOARD_ID}/stacks`));
  for (const stack of stacks) {
    const found = (stack.cards ?? []).find((candidate) => candidate.id === id);
    if (found) return { stack, card: found };
  }
  throw new Error(`Card ${id} not found on board ${TEST_BOARD_ID}`);
}

function updateBody(source, order = source.order) {
  const body = {
    title: source.title,
    type: source.type ?? 'plain',
    description: source.description ?? '',
    order,
  };
  const owner = typeof source.owner === 'object' ? source.owner?.uid : source.owner;
  if (owner !== undefined) body.owner = owner;
  if (source.duedate) body.duedate = source.duedate;
  return body;
}

async function apiMoveCard(deck, toStackId) {
  const { card: found } = await boardCard(deck);
  await deck.request(
    'PUT',
    `/boards/${TEST_BOARD_ID}/stacks/${toStackId}/cards/${CARD_ID}`,
    updateBody(found)
  );
}

async function expectApiStack(deck, stackId) {
  await expect.poll(async () => (await boardCard(deck)).card.stackId).toBe(stackId);
}

async function restoreCard(deck) {
  const { card: found } = await boardCard(deck);
  if (found.stackId !== TEST_STACKS.inbox) await apiMoveCard(deck, TEST_STACKS.inbox);
  await expectApiStack(deck, TEST_STACKS.inbox);
}

async function center(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function pointInside(locator, xRatio = 0.5, yRatio = 0.5) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio };
}

async function dragFromCardTo(page, target) {
  const start = await center(card(page));
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expectNoDialog(page);
  await page.mouse.move(target.x, target.y, { steps: 10 });
}

test.describe('interaction', () => {
  test.afterAll(async ({ deck }) => {
    await restoreCard(deck);
  });

  test('plain click opens the card detail exactly once', async ({ guardedPage: page }) => {
    await routeDetailReads(page);
    await openTestBoard(page);

    await card(page).click();

    await expectOneDialog(page);
    await expect(dialogs(page)).toContainText(CARD_TITLE);
  });

  test('Enter opens the focused card and close restores focus', async ({ guardedPage: page }) => {
    await routeDetailReads(page);
    await openTestBoard(page);
    const opener = card(page);

    await opener.focus();
    await page.keyboard.press('Enter');

    await expectOneDialog(page);
    await expect(dialogs(page)).toContainText(CARD_TITLE);
    await closeDialog(page);
    await expect(opener).toBeFocused();
  });

  test('Space opens the focused card exactly once', async ({ guardedPage: page }) => {
    await routeDetailReads(page);
    await openTestBoard(page);

    await card(page).focus();
    await page.keyboard.press('Space');

    await expectOneDialog(page);
    await expect(dialogs(page)).toContainText(CARD_TITLE);
  });

  test('Shift-click reserves the gesture without opening detail', async ({ guardedPage: page }) => {
    await openTestBoard(page);

    await card(page).click({ modifiers: ['Shift'] });

    await expectNoDialog(page);
  });

  test('sub-threshold jitter still activates the card', async ({ guardedPage: page }) => {
    await routeDetailReads(page);
    await openTestBoard(page);
    const start = await center(card(page));

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 4, start.y, { steps: 4 });
    await page.mouse.up();

    await expectOneDialog(page);
    await expect(dialogs(page)).toContainText(CARD_TITLE);
  });

  test('dragging a card between stacks never opens detail and persists the move', async ({
    guardedPage: page,
    deck,
  }) => {
    await restoreCard(deck);
    await openTestBoard(page);
    const requests = trackCardRequests(page);
    const target = await pointInside(page.locator(`[data-stack-id="${TEST_STACKS.doing}"] [data-cards]`), 0.5, 0.2);

    try {
      await dragFromCardTo(page, target);

      await expect(page.locator(`[data-stack-id="${TEST_STACKS.doing}"] .placeholder`)).toBeVisible();
      await expectNoDialog(page);
      await page.mouse.up();
      await expectNoDialog(page);
      await page.waitForTimeout(SYNTHETIC_CLICK_WINDOW_MS);
      await expectNoDialog(page);
      await expect.poll(() => requests.movePuts.length).toBeGreaterThan(0);
      await expectApiStack(deck, TEST_STACKS.doing);
      expect(requests.detailGets).toHaveLength(0);
    } finally {
      await restoreCard(deck);
    }
  });

  test('pointercancel aborts without activation or drop', async ({ guardedPage: page, deck }) => {
    await restoreCard(deck);
    await openTestBoard(page);
    const requests = trackCardRequests(page);
    const target = await pointInside(page.locator(`[data-stack-id="${TEST_STACKS.doing}"] [data-cards]`), 0.5, 0.2);

    await dragFromCardTo(page, target);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));

    await expectNoDialog(page);
    expect(requests.movePuts).toHaveLength(0);
    await expectApiStack(deck, TEST_STACKS.inbox);
  });

  test('invalid drop outside stacks neither opens detail nor mutates the card', async ({
    guardedPage: page,
    deck,
  }) => {
    await restoreCard(deck);
    await openTestBoard(page);
    const requests = trackCardRequests(page);

    await dragFromCardTo(page, { x: 4, y: 4 });
    await expectNoDialog(page);
    await page.mouse.up();
    await page.waitForTimeout(SYNTHETIC_CLICK_WINDOW_MS);

    await expectNoDialog(page);
    expect(requests.movePuts).toHaveLength(0);
    await expectApiStack(deck, TEST_STACKS.inbox);
  });

  // Trello sizes a lane to its cards. Stretching the visible lane to the board
  // height was one way to make the space below droppable, but it looks wrong;
  // the hit-test must carry that instead. Both halves are asserted together so
  // neither can be "fixed" by reintroducing the other's bug.
  test('a short lane stays short yet still accepts a drop below its last card', async ({ guardedPage: page }) => {
    await openTestBoard(page);

    const viewport = page.viewportSize().height;
    const lanes = await page.$$eval('[data-stack-id]', (els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        const cards = [...el.querySelectorAll('[data-card-id]')];
        const last = cards.at(-1)?.getBoundingClientRect();
        return {
          id: el.dataset.stackId,
          count: cards.length,
          bottom: r.bottom,
          lastCardBottom: last ? last.bottom : r.top,
        };
      })
    );

    const short = lanes.filter((l) => l.count > 0 && l.count < 6);
    expect(short.length).toBeGreaterThan(0);
    for (const lane of short) {
      expect(lane.bottom).toBeLessThan(viewport - 60);
      expect(lane.bottom - lane.lastCardBottom).toBeLessThan(120);
    }

    const target = short.slice().sort((a, b) => a.lastCardBottom - b.lastCardBottom)[0];
    const source = page.locator(`[data-stack-id="${TEST_STACKS.inbox}"] [data-card-id]`).first();
    const sourceId = await source.getAttribute('data-card-id');
    const sb = await source.boundingBox();
    const tb = await page.locator(`[data-stack-id="${target.id}"]`).boundingBox();

    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2, target.lastCardBottom + 150, { steps: 20 });

    await expect(page.locator(`[data-stack-id="${target.id}"].over`)).toBeVisible();
    // One card is being dragged, so exactly one slot opens - and only in the
    // lane under the pointer.
    expect(await page.locator('.placeholder').count()).toBe(1);

    await page.mouse.up();
    await expect(
      page.locator(`[data-stack-id="${target.id}"] [data-card-id="${sourceId}"]`)
    ).toBeVisible({ timeout: 15_000 });
  });
});
