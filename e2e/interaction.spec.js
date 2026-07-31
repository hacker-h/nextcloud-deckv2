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
});
