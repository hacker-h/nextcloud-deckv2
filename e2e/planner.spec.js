import { test, expect } from './hermetic.js';

test('Planner shows Proton events and schedules a recurring Deck card end to end', async ({ page, backend }) => {
  backend.calendarEnabled = true;
  const eventStart = new Date();
  eventStart.setHours(9, 30, 0, 0);
  backend.calendarEvents = [{
    id: 'weekly-review::occurrence',
    seriesId: 'weekly-review',
    title: 'Weekly review',
    start: eventStart.toISOString(),
    occurrenceStart: eventStart.toISOString(),
    end: new Date(eventStart.getTime() + 30 * 60_000).toISOString(),
    isRecurring: true,
    allDay: false,
  }];
  backend.calendarMappings = [{ entryKey: 'card:1:9999', eventId: 'weekly-review' }];

  await page.goto('/');
  await expect(page.locator('.board')).toBeVisible();
  await page.getByRole('button', { name: 'Planer' }).click();

  await expect(page.getByRole('heading', { name: 'Deine Woche, zusammengeführt' })).toBeVisible();
  await expect(page.getByText('Weekly review')).toBeVisible();
  await expect(page.getByText('Deck ↔ Proton')).toBeVisible();

  await page.getByRole('button', { name: 'Pizza Margherita Karte', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'In Proton Calendar einplanen' });
  await dialog.getByLabel('Datum').fill('2026-08-24');
  await dialog.getByLabel('Uhrzeit').fill('10:15');
  await dialog.getByLabel('Wiederholung').selectOption('WEEKLY');
  await dialog.getByLabel('Ende').selectOption('count');
  await dialog.getByLabel('Anzahl').fill('6');
  await dialog.getByRole('button', { name: 'In Proton einplanen' }).click();

  await expect(dialog).toBeHidden();
  const schedule = backend.find('/integration/proton-calendar/schedule', 'POST').at(-1);
  expect(schedule.body).toMatchObject({
    entry: { kind: 'card', title: 'Pizza Margherita' },
    calendarId: 'calendar-1',
    recurrence: { freq: 'WEEKLY', count: 6 },
    reminderMinutes: 15,
  });
  expect(backend.find('/cards/1001', 'PUT').at(-1)?.body.duedate).toMatch(/^2026-08-24T/);
  expect(JSON.stringify(backend.requests)).not.toMatch(/bearer|proton.*token|password/i);
});

test('Planner remains useful when Proton Calendar is not configured', async ({ page, backend }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Planer' }).click();
  await expect(page.getByText(/serverseitig noch nicht konfiguriert/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toBeEnabled();
});
