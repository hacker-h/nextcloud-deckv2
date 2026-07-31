import { test, expect, TEST_BOARD_ID, TEST_STACKS, registerTestCard } from './fixtures.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_PREFIX = `[e2e-${crypto.randomUUID()}]`;
const EVIDENCE = resolve(root, '.sisyphus/evidence/card-detail/task-21-failure-cleanup.txt');
const API = `/boards/${TEST_BOARD_ID}/stacks/${TEST_STACKS.inbox}/cards`;

function card(page, id) {
  return page.locator(`[data-card-id="${id}"]`);
}

function dialog(page) {
  return page.locator('[role="dialog"]');
}

function env() {
  const out = {};
  for (const line of readFileSync(resolve(root, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function asArray(value) {
  return Array.isArray(value) ? value : value.data;
}

function fullPath(cardId) {
  return `${API}/${cardId}`;
}

function updateBody(source, changes = {}) {
  const merged = { ...source, ...changes };
  const body = { ...merged, owner: typeof merged.owner === 'object' ? merged.owner?.uid : merged.owner };
  delete body.attachments;
  return body;
}

function normalizeAssigned(entry) {
  const p = entry.participant ?? entry;
  return { id: p.uid ?? p.id ?? p, displayName: p.displayName ?? p.uid ?? p.id ?? p, type: entry.type ?? 0 };
}

async function ocsRequest(method, path, body) {
  const e = env();
  const base = String(e.VITE_NC_URL).replace(/\/$/, '');
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${e.VITE_NC_USER}:${e.VITE_NC_PASS}`).toString('base64'),
    Accept: 'application/json',
    'OCS-APIRequest': 'true',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${base}/ocs/v2.php${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OCS ${method} ${path} failed: ${res.status}`);
  if (res.status === 204) return null;
  const json = await res.json();
  return json.ocs?.data ?? json;
}

async function createFixture(deck, suffix) {
  const created = await deck.request('POST', API, {
    title: `${RUN_PREFIX} ${suffix}`,
    type: 'plain',
    description: '',
    order: Date.now(),
  });
  // Comment writes carry no board id, so the guard can only allow them once the
  // card is known to have been created on the test board.
  registerTestCard(created.id);
  return created;
}

async function getCard(deck, id) {
  return deck.request('GET', fullPath(id));
}

async function findBoardCard(deck, id) {
  const stacks = asArray(await deck.request('GET', `/boards/${TEST_BOARD_ID}/stacks`));
  return stacks.flatMap((stack) => stack.cards ?? []).find((candidate) => candidate.id === id) ?? null;
}

async function listFixtures(deck) {
  const stacks = asArray(await deck.request('GET', `/boards/${TEST_BOARD_ID}/stacks`));
  return stacks.flatMap((stack) => stack.cards ?? []).filter((candidate) => candidate.title?.startsWith(RUN_PREFIX));
}

async function cleanupCard(deck, id) {
  try {
    const comments = await ocsRequest('GET', `/apps/deck/api/v1.0/cards/${id}/comments`);
    for (const comment of comments ?? []) {
      await ocsRequest('DELETE', `/apps/deck/api/v1.0/cards/${id}/comments/${comment.id}`).catch(() => {});
    }
  } catch {}

  try {
    const attachments = asArray(await deck.request('GET', `${fullPath(id)}/attachments`));
    for (const attachment of attachments ?? []) {
      if (!attachment.deletedAt) await deck.request('DELETE', `${fullPath(id)}/attachments/${attachment.id}`).catch(() => {});
    }
  } catch {}

  await deck.request('DELETE', fullPath(id)).catch(() => {});
}

async function openTestBoard(page) {
  await page.goto('/');
  await expect(page.locator('[data-stack-id]').first()).toBeVisible({ timeout: 15_000 });
}

async function openCard(page, id) {
  await card(page, id).click();
  await expect(dialog(page)).toBeVisible();
}

async function closeDialog(page) {
  await page.getByLabel('Close card detail').click();
  await expect(dialog(page)).toHaveCount(0);
}

async function deleteThroughUi(page, title) {
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete card' }).click();
  await page.getByLabel('Confirm card title').fill(title);
  await page.getByRole('alertdialog', { name: 'Confirm delete' }).getByRole('button', { name: 'Delete card' }).click();
  await expect(dialog(page)).toHaveCount(0);
}

async function commitDue(page, cardId, value) {
  const input = dialog(page).getByLabel('Due date');
  if (value !== undefined) await input.fill(value);
  const saved = page.waitForResponse(
    (res) => res.request().method() === 'PUT' && res.url().includes(`${fullPath(cardId)}`),
  );
  await input.evaluate((node) => node.dispatchEvent(new Event('change', { bubbles: true })));
  await saved;
}

test.describe('card detail live CRUD', () => {
  const created = new Set();

  test.afterAll(async ({ deck }) => {
    for (const fixture of await listFixtures(deck)) created.add(fixture.id);
    for (const id of created) await cleanupCard(deck, id);

    const leftovers = await listFixtures(deck);
    mkdirSync(dirname(EVIDENCE), { recursive: true });
    writeFileSync(EVIDENCE, `prefix=${RUN_PREFIX}\nleftovers=${JSON.stringify(leftovers.map((c) => ({ id: c.id, title: c.title })))}\n`);
    expect(leftovers).toEqual([]);
  });

  test('full workflow persists core fields, assignments, comment, attachment, and tile badges', async ({
    guardedPage: page,
    deck,
  }, testInfo) => {
    const fixture = await createFixture(deck, 'card detail');
    created.add(fixture.id);
    const nextTitle = `${RUN_PREFIX} card detail saved`;
    const description = `${RUN_PREFIX} multiline description\nsecond detail line`;
    const dueLocal = '2035-04-05T09:30';
    const dueApi = new Date(dueLocal).toISOString().replace('.000Z', '+00:00');
    const comment = `${RUN_PREFIX} comment body`;
    const attachmentPath = testInfo.outputPath('detail-test.txt');
    writeFileSync(attachmentPath, `${RUN_PREFIX} attachment bytes\n`);

    try {
      const options = await deck.request('GET', `/boards/${TEST_BOARD_ID}`);
      const label = options.labels.find((candidate) => candidate.title) ?? options.labels[0];
      const person = (options.acl ?? []).map(normalizeAssigned).find((candidate) => candidate.id);
      expect(label).toBeTruthy();
      expect(person).toBeTruthy();

      await openTestBoard(page);
      await page.reload();
      await expect(card(page, fixture.id)).toBeVisible();
      await openCard(page, fixture.id);

      await dialog(page).getByRole('button', { name: fixture.title }).click();
      await dialog(page).getByRole('textbox', { name: 'Card title' }).fill(nextTitle);
      await dialog(page).getByRole('textbox', { name: 'Card title' }).press('Enter');
      await expect(dialog(page)).toContainText(nextTitle);

      await page.getByRole('button', { name: 'Add a more detailed description' }).click();
      await page.getByLabel('Card description').fill(description);
      await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByTestId('description')).toHaveText(description);

      await commitDue(page, fixture.id, dueLocal);
      await expect.poll(async () => (await getCard(deck, fixture.id)).duedate).toBe(dueApi);

      await page.getByRole('button', { name: 'Edit labels' }).click();
      await page.getByRole('checkbox', { name: label.title }).click();
      await expect.poll(async () => ((await getCard(deck, fixture.id)).labels ?? []).map((entry) => entry.id)).toContain(label.id);

      await page.getByRole('button', { name: 'Edit members' }).click();
      await page.getByRole('checkbox', { name: person.displayName }).click();
      await expect.poll(async () => ((await getCard(deck, fixture.id)).assignedUsers ?? []).map(normalizeAssigned)).toContainEqual(
        expect.objectContaining({ id: person.id }),
      );

      await page.getByLabel('Write a comment').fill(comment);
      await page.getByRole('button', { name: 'Comment' }).click();
      await expect(dialog(page)).toContainText(comment);

      await page.getByLabel('Attach a file').setInputFiles(attachmentPath);
      await expect(dialog(page)).toContainText('detail-test.txt');
      await expect.poll(async () => (await getCard(deck, fixture.id)).commentsCount, { timeout: 15_000 }).toBe(1);

      // Comment and attachment endpoints update the detail pane; a core save is
      // what republishes the fresh card counters back onto the board tile.
      await commitDue(page, fixture.id);
      await expect.poll(async () => (await getCard(deck, fixture.id)).duedate).toBe(dueApi);

      await closeDialog(page);
      const tile = card(page, fixture.id);
      await expect(tile).toContainText(nextTitle);
      await expect(tile.getByLabel('Has description')).toBeVisible();
      await expect(tile.locator('[title="1 comments"]')).toBeVisible();
      await expect(tile.locator(`[title="${label.title}"]`)).toBeVisible();

      await openCard(page, fixture.id);
      await expect(dialog(page)).toContainText(nextTitle);
      await expect(page.getByTestId('description')).toHaveText(description);
      await expect(page.getByLabel('Due date')).toHaveValue(dueLocal);
      await expect(dialog(page)).toContainText(label.title);
      await expect(dialog(page)).toContainText(comment);
      await expect(dialog(page)).toContainText('detail-test.txt');
      await closeDialog(page);

      const persisted = await getCard(deck, fixture.id);
      expect(persisted.title).toBe(nextTitle);
      expect(persisted.description).toBe(description);
      expect(persisted.duedate).toBe(dueApi);
      expect((persisted.labels ?? []).map((entry) => entry.id)).toContain(label.id);
      expect((persisted.assignedUsers ?? []).map(normalizeAssigned)).toContainEqual(expect.objectContaining({ id: person.id }));

      const comments = await ocsRequest('GET', `/apps/deck/api/v1.0/cards/${fixture.id}/comments`);
      expect(comments.map((entry) => entry.message)).toContain(comment);
      const attachments = asArray(await deck.request('GET', `${fullPath(fixture.id)}/attachments`));
      expect(attachments.some((entry) => entry.data === 'detail-test.txt' || entry.extendedData?.info?.filename === 'detail-test')).toBe(true);
    } finally {
      await cleanupCard(deck, fixture.id);
    }
  });

  test('archive and unarchive persist the archived flag', async ({ guardedPage: page, deck }) => {
    const fixture = await createFixture(deck, 'archive detail');
    created.add(fixture.id);
    try {
      await openTestBoard(page);
      await page.reload();
      await openCard(page, fixture.id);
      await page.getByRole('button', { name: 'Actions' }).click();
      await page.getByRole('menuitem', { name: 'Archive card' }).click();
      await page.getByRole('alertdialog', { name: 'Confirm archive' }).getByRole('button', { name: 'Archive' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect.poll(async () => Boolean((await getCard(deck, fixture.id)).archived)).toBe(true);

      await deck.request('PUT', `${fullPath(fixture.id)}/unarchive`);
      await expect.poll(async () => Boolean((await getCard(deck, fixture.id)).archived)).toBe(false);
      await page.reload();
      await expect(card(page, fixture.id)).toBeVisible();
    } finally {
      await cleanupCard(deck, fixture.id);
    }
  });

  test('destructive delete removes only the suite-created card', async ({ guardedPage: page, deck }) => {
    const fixture = await createFixture(deck, 'delete detail');
    created.add(fixture.id);
    await openTestBoard(page);
    await page.reload();
    await openCard(page, fixture.id);
    await deleteThroughUi(page, fixture.title);

    await expect.poll(async () => findBoardCard(deck, fixture.id)).toBeNull();
    await expect(deck.request('GET', fullPath(fixture.id))).rejects.toThrow(/403|deleted|failed/);
  });

  test('failed core save surfaces an error, preserves prior data, and retries', async ({ guardedPage: page, deck }) => {
    const fixture = await createFixture(deck, 'failure detail');
    created.add(fixture.id);
    const failedTitle = `${RUN_PREFIX} retry title`;
    let failed = false;
    try {
      await openTestBoard(page);
      await page.reload();
      await openCard(page, fixture.id);
      await page.route(new RegExp(`/boards/${TEST_BOARD_ID}/stacks/${TEST_STACKS.inbox}/cards/${fixture.id}(?:[?#]|$)`), async (route) => {
        if (!failed && route.request().method() === 'PUT') {
          failed = true;
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'forced detail save failure' }) });
          return;
        }
        await route.continue();
      });

      await dialog(page).getByRole('button', { name: fixture.title }).click();
      await dialog(page).getByRole('textbox', { name: 'Card title' }).fill(failedTitle);
      await dialog(page).getByRole('textbox', { name: 'Card title' }).press('Enter');
      await expect(page.getByRole('alert')).toContainText('forced detail save failure');
      await expect(dialog(page)).toContainText(fixture.title);
      expect((await getCard(deck, fixture.id)).title).toBe(fixture.title);

      await page.unroute(new RegExp(`/boards/${TEST_BOARD_ID}/stacks/${TEST_STACKS.inbox}/cards/${fixture.id}(?:[?#]|$)`));
      await page.getByLabel('Close card detail').click();
      await page.getByRole('alertdialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect.poll(async () => (await getCard(deck, fixture.id)).title).toBe(failedTitle);
    } finally {
      await cleanupCard(deck, fixture.id);
    }
  });
});
