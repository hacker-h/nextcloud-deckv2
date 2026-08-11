import { test, expect } from './hermetic.js';

// The live suite intentionally uses exact accessible names so localization
// regressions are visible. This fast hermetic contract exercises those same
// names in CI; a copy change can no longer leave the credentialed suite stale
// and unnoticed until someone runs it against Nextcloud.
test('critical live-suite controls keep their accessible contract', async ({ board }) => {
  const { page } = board;

  const inbox = page.locator('aside.rail');
  await expect(inbox.getByRole('heading', { name: 'Posteingang' })).toBeVisible();
  await page.getByRole('button', { name: 'Posteingang einklappen' }).click();
  await expect(page.getByRole('button', { name: 'Posteingang erweitern' })).toBeVisible();
  await page.getByRole('button', { name: 'Posteingang erweitern' }).click();

  await page.locator('[data-card-id="1001"]').click();
  const detail = page.getByRole('dialog').first();
  await expect(page.getByLabel('Kartendetails schließen')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Ablaufdatum' })).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Aktionen' })).toBeVisible();

  await detail.getByRole('button', { name: 'Ablaufdatum' }).click();
  const picker = page.getByRole('dialog', { name: 'Fälligkeitsdatum ändern' });
  await expect(picker.getByLabel('Fälligkeitsdatum')).toBeVisible();
  await expect(picker.getByLabel('Uhrzeit')).toBeVisible();
  await expect(picker.getByRole('button', { name: 'Speichern' })).toBeVisible();
  await picker.getByLabel('Schließen').click();

  await detail.getByRole('button', { name: 'Aktionen' }).click();
  await expect(page.getByRole('menuitem', { name: 'Karte archivieren' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Karte löschen' })).toBeVisible();
  await detail.getByRole('button', { name: 'Aktionen' }).click();
  await page.getByLabel('Kartendetails schließen').click();

  const firstStackCards = page.locator('[data-stack-id="301"] [data-card-id]');
  await firstStackCards.nth(0).click({ modifiers: ['Shift'] });
  await firstStackCards.nth(2).click({ modifiers: ['Shift'] });
  await expect(page.getByText('3 ausgewählt')).toBeVisible();
});
