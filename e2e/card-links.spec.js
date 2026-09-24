import { test, expect } from './hermetic.js';

const card = (page, id = 1001) => page.locator(`.card[data-card-id="${id}"]`);
const dialog = (page) => page.locator('.dialog[role="dialog"]');

test('opening, copying, reloading and closing a card keeps the URL in sync', async ({ page, backend }) => {
  await page.goto('/');
  await card(page).click();
  await expect(page).toHaveURL(/#\/boards\/\d+\/cards\/1001$/);
  const link = page.url();
  await page.reload();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
  await expect(page).toHaveURL(link);
  await page.getByRole('button', { name: 'Kartendetails schließen' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/boards\/\d+$/);
  await page.goto(link);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
});

test('a direct link selects its board and resolves a card moved to another stack', async ({ page, backend }) => {
  const moved = backend.stacks[0].cards.shift();
  backend.stacks[1].cards.push({ ...moved, stackId: backend.stacks[1].id });
  await page.goto('/#/boards/100/cards/1001');
  await expect(page.locator('.switcher .name')).toHaveText('Essensplanung');
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
  expect(backend.find('/cards/1001', 'GET').some((r) => r.path.includes(`/stacks/${backend.stacks[1].id}/`))).toBe(true);
});

test('browser Back closes the card and Forward reopens it', async ({ page, backend }) => {
  await page.goto('/#/boards/100');
  await card(page).click();
  await expect(dialog(page)).toBeVisible();
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/boards\/100$/);
  await page.goForward();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
  await expect(page).toHaveURL(/#\/boards\/100\/cards\/1001$/);
});

test('browser Back preserves an unsaved description and offers the existing confirmation', async ({ page, backend }) => {
  await page.goto('/#/boards/100');
  await card(page).click();
  await page.getByRole('button', { name: 'Beschreibung bearbeiten' }).click();
  await page.getByLabel('Beschreibung der Karte').fill('Nicht verlieren');
  await page.goBack();
  await expect(page.getByRole('alertdialog', { name: 'Ungespeicherte Änderungen' })).toBeVisible();
  await expect(page).toHaveURL(/#\/boards\/100\/cards\/1001$/);
  await page.getByRole('button', { name: 'Weiter bearbeiten' }).click();
  await expect(page.getByLabel('Beschreibung der Karte')).toHaveValue('Nicht verlieren');
  await page.getByRole('button', { name: 'Kartendetails schließen' }).click();
  await page.getByRole('button', { name: 'Verwerfen', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page).toHaveURL(/#\/boards\/100$/);
});

test('a card link remains available through the login screen', async ({ page, backend }) => {
  let authenticated = false;
  await page.route('**/auth/me', async (route) => {
    if (authenticated) return route.fallback();
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ instance: 'Nextcloud' }) });
  });
  await page.goto('/#/boards/100/cards/1001');
  await expect(page).toHaveURL(/#\/boards\/100\/cards\/1001$/);
  await expect(dialog(page)).toHaveCount(0);
  authenticated = true;
  await page.reload();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
});

for (const [hash, message] of [
  ['#/boards/100/cards/nope', 'Dieser Kartenlink ist ungültig.'],
  ['#/boards/99999/cards/1001', 'Das verlinkte Board ist nicht verfügbar'],
  ['#/boards/100/cards/99999', 'Die verlinkte Karte wurde nicht gefunden'],
]) {
  test(`unavailable links explain the problem: ${hash}`, async ({ page, backend }) => {
    await page.goto('/' + hash);
    await expect(page.getByText(message, { exact: false })).toBeVisible();
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator('.board-skel')).toHaveCount(0);
  });
}

test('an older slow board load cannot reopen the wrong card after navigation', async ({ page, backend }) => {
  await page.goto('/#/boards/100');
  await expect(card(page)).toBeVisible();
  let started;
  const requested = new Promise((resolve) => { started = resolve; });
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/deck/boards/101/stacks', async (route) => {
    started();
    await blocked;
    await route.fallback();
  });
  await page.evaluate(() => { location.hash = '#/boards/101/cards/1001'; });
  await requested;
  await page.evaluate(() => { location.hash = '#/boards/100/cards/1002'; });
  await expect(dialog(page)).toHaveAttribute('aria-label', backend.stacks[0].cards[1].title);
  release();
  await expect(page.locator('.switcher .name')).toHaveText('Essensplanung');
  await expect(page).toHaveURL(/#\/boards\/100\/cards\/1002$/);
});

test('inbox cards also have direct links', async ({ page, backend }) => {
  backend.boards.push({ ...backend.boards[0], id: 900, title: '[deckv2] Inbox — managed by deckv2' });
  // Use the application's exact managed-board marker.
  const { INBOX_TITLE } = await import('../shared/inbox-board.js');
  backend.boards.at(-1).title = INBOX_TITLE;
  await page.goto('/#/boards/100');
  const inboxCard = page.locator('.rail .card[data-card-id="1001"]');
  await inboxCard.click();
  await expect(page).toHaveURL(/#\/boards\/900\/cards\/1001$/);
  const url = page.url();
  await page.goto(url);
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
});

test('browser Back saves an edited title before leaving the card', async ({ page, backend }) => {
  await page.goto('/#/boards/100');
  await card(page).click();
  await dialog(page).locator('.title-button').click();
  await page.getByLabel('Kartentitel').fill('Titel bleibt gespeichert');
  await page.goBack();
  await expect(dialog(page)).toHaveCount(0);
  await expect.poll(() => backend.find('/cards/1001', 'PUT').at(-1)?.body.title).toBe('Titel bleibt gespeichert');
  await page.goForward();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Titel bleibt gespeichert');
});

test('retrying a failed board load keeps the requested card link', async ({ page, backend }) => {
  let fail = true;
  await page.route('**/api/deck/boards/100/stacks', async (route) => {
    if (!fail) return route.fallback();
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Vorübergehend nicht erreichbar' }) });
  });
  await page.goto('/#/boards/100/cards/1001');
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect(dialog(page)).toHaveAttribute('aria-label', 'Pizza Margherita');
  await expect(page).toHaveURL(/#\/boards\/100\/cards\/1001$/);
});
