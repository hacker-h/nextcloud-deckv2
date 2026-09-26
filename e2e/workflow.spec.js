import { test, expect } from './hermetic.js';

async function ready(page) { await page.goto('/'); await expect(page.locator('.board')).toBeVisible(); }
async function dragTo(page, source, target) {
  const a = await source.boundingBox(); const b = await target.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + 15);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
  await page.mouse.up();
}
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

test('Done defaults on, undo restores status, opt-out persists', async ({ page, backend }) => {
  backend.stacks[1].title = 'Done';
  backend.stacks[0].cards[0].duedate = '2020-01-01T00:00:00Z';
  backend.stacks[0].cards[0].overdue = true;
  await ready(page);
  await dragTo(page, page.locator('[data-card-id="1001"]'), page.locator('[data-stack-id="302"] .head'));
  await expect.poll(() => backend.card(1001)?.done).toBeTruthy();
  await expect(page.locator('[data-card-id="1001"] .due')).not.toHaveClass(/overdue/);
  const undo = page.getByRole('button', { name: '↶ Rückgängig' });
  await expect(undo).toHaveAttribute('title', /Z/);
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => backend.card(1001)?.stackId).toBe(301);
  expect(backend.card(1001).done).toBeFalsy();
  await page.getByRole('button', { name: '⚙ Optionen' }).click();
  await page.getByLabel('In „Done“ automatisch als erledigt markieren').uncheck();
  await page.keyboard.press('Escape'); await page.reload();
  await expect(page.locator('.board')).toBeVisible();
  await dragTo(page, page.locator('[data-card-id="1001"]'), page.locator('[data-stack-id="302"] .head'));
  await expect.poll(() => backend.card(1001)?.stackId).toBe(302);
  expect(backend.card(1001).done).toBeFalsy();
});

test('search shortcut, local/all scope, assigned tasks and result deep link', async ({ page, backend }) => {
  backend.stacks[0].cards[0].assignedUsers = [{ participant: { uid: 'e2e' }, type: 0 }];
  await ready(page);
  await page.keyboard.press(`${mod}+k`);
  const dialog = page.getByRole('dialog', { name: 'Karten suchen' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox').fill('Pizza Margherita');
  await expect(dialog.locator('.result')).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Alle Boards', exact: true }).click();
  await expect.poll(async () => dialog.locator('.result').count()).toBeGreaterThan(1);
  await dialog.getByLabel('Meine Aufgaben').check();
  await dialog.locator('.result').first().click();
  await expect(page).toHaveURL(/#\/boards\/\d+\/cards\/1001$/);
  await expect(page.getByRole('dialog')).toContainText('Pizza Margherita');
});

test('cached board navigation creates zero progress indicators even with slow revalidation', async ({ page, backend }) => {
  await ready(page);
  await expect(page.getByRole('progressbar')).toHaveCount(0);
  await expect.poll(() => backend.requests.filter((r) => /\/boards\/100\/stacks$/.test(r.path)).length).toBeGreaterThan(0);
  await page.route(/\/api\/deck\/boards\/100\/stacks$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200)); await route.fallback();
  });
  await page.evaluate(() => {
    window.progressFlashes = 0;
    window.progressObserver = new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) {
        if (n.nodeType === 1 && (n.matches('[role="progressbar"]') || n.querySelector('[role="progressbar"]'))) window.progressFlashes++;
      }
    });
    window.progressObserver.observe(document.body, { childList: true, subtree: true });
  });
  await page.locator('.switcher .trigger').click();
  await page.locator('.switcher .item').filter({ hasText: 'Essensplanung' }).click();
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.progressFlashes)).toBe(0);
});

test('read-only board remains inspectable, with no editing or drag writes', async ({ page, backend }) => {
  backend.boards.find((b) => b.id === 110).permissions = { PERMISSION_READ: true, PERMISSION_EDIT: false };
  await ready(page);
  await expect(page.locator('.board .add')).toHaveCount(0);
  await page.locator('[data-card-id="1001"]').click({ modifiers: ['Shift'] });
  await expect(page.getByRole('region', { name: 'Selection actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Planer', exact: true })).toBeDisabled();
  await page.locator('[data-card-id="1001"]').click();
  await expect(page.getByRole('dialog')).toContainText('Dieses Board ist schreibgeschützt');
  await expect(page.locator('.title-button')).toBeDisabled();
  await expect(page.getByRole('dialog').getByText('Beschreibung speichern')).toHaveCount(0);
  expect(backend.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
});

test('planning drop saves day/week/month independently of due dates and survives reload', async ({ page, backend }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Planungskalender' });
  await expect(sidebar.getByText('Planung wird geladen…')).toHaveCount(0);
  const due = backend.card(1001).duedate;
  await dragTo(page, page.locator('[data-card-id="1001"]'), sidebar.locator('[data-plan-kind="day"]').nth(10));
  await expect.poll(() => backend.plans[1001]?.plan?.granularity).toBe('day');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(backend.card(1001).duedate).toBe(due);
  await sidebar.getByLabel('Karte zum Einplanen').selectOption('1001');
  await sidebar.locator('[data-plan-kind="week"]').nth(2).click();
  await expect.poll(() => backend.plans[1001]?.plan?.granularity).toBe('week');
  await sidebar.locator('[data-plan-kind="month"]').click();
  await expect.poll(() => backend.plans[1001]?.plan?.granularity).toBe('month');
  await page.reload();
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  await expect(sidebar.locator('.entry')).toContainText('Pizza Margherita');
});

test('time and deadline options default off and explicitly enable the planning popup', async ({ page, backend }) => {
  backend.calendarEnabled = true;
  const day = new Date().toISOString().slice(0, 10);
  backend.calendarEvents = [{ id: 'busy', title: 'Besprechung', start: `${day}T09:00:00`, end: `${day}T10:00:00` }];
  await ready(page);
  await page.getByRole('button', { name: '⚙ Optionen' }).click();
  await expect(page.getByLabel('Beim Einplanen auf einen Tag eine Uhrzeit vorschlagen')).not.toBeChecked();
  await expect(page.getByLabel('Beim Einplanen zusätzlich nach einer Fälligkeit fragen')).not.toBeChecked();
  await page.getByLabel('Beim Einplanen auf einen Tag eine Uhrzeit vorschlagen').check();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  const sidebar = page.getByRole('complementary', { name: 'Planungskalender' });
  await expect(sidebar).toContainText('Termine aus dem verbundenen Kalender berücksichtigt');
  await sidebar.getByLabel('Karte zum Einplanen').selectOption('1001');
  await sidebar.locator(`[data-plan-kind="day"][data-plan-start="${day}"]`).click();
  const dialog = page.getByRole('dialog', { name: 'Planung festlegen' });
  await expect(dialog.getByLabel('Uhrzeit')).toHaveValue('10:00');
  await dialog.getByRole('button', { name: 'Nur Zeitraum' }).click();
  await expect.poll(() => backend.plans[1001]?.plan?.time).toBeNull();
});

test('failed saves stay visible and a week drag highlights the full target range', async ({ page, backend }) => {
  await ready(page);
  await page.route(/\/api\/deck\/boards\/\d+\/stacks\/302\/cards\/1001$/, (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Speichern nicht möglich"}' }));
  await dragTo(page, page.locator('[data-card-id="1001"]'), page.locator('[data-stack-id="302"] .head'));
  await expect(page.getByText('Speichern fehlgeschlagen', { exact: true })).toBeVisible();
  await expect(page.locator('[data-stack-id="301"] [data-card-id="1001"]')).toBeVisible();
  await page.getByRole('button', { name: 'Kalender', exact: true }).click();
  const source = await page.locator('[data-card-id="1001"]').boundingBox();
  const target = await page.locator('[data-plan-kind="week"]').nth(2).boundingBox();
  await page.mouse.move(source.x + 30, source.y + 15); await page.mouse.down();
  await page.mouse.move(target.x + 10, target.y + 10, { steps: 12 });
  await expect(page.locator('.grid .highlight')).toHaveCount(7);
  await page.mouse.up();
});
