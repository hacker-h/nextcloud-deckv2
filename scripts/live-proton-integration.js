import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CalendarIntegration } from '../server/calendar-integration.js';
import { CalendarMappingStore } from '../server/calendar-mappings.js';
import { ProtonCalendarApi } from '../server/proton-calendar.js';

if (process.env.RUN_LIVE_PROTON_INTEGRATION !== '1') {
  throw new Error('Set RUN_LIVE_PROTON_INTEGRATION=1 to allow live Proton Calendar mutations');
}

const required = (name) => {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const api = new ProtonCalendarApi({
  baseUrl: required('PROTON_CALENDAR_API_URL'),
  token: required('PROTON_CALENDAR_API_TOKEN'),
  calendarId: required('PROTON_CALENDAR_ID'),
});
const mappings = new CalendarMappingStore({ filePath: join(mkdtempSync(join(tmpdir(), 'deckv2-proton-live-')), 'mappings.json') });
const integration = new CalendarIntegration({ api, mappings, allowedUsers: ['live-qa'], timezone: 'Europe/Berlin' });
const run = `${Date.now()}-${process.pid}`;
const start = roundedFutureDate(3);
const card = {
  kind: 'card',
  boardId: 'live-board',
  stackId: 'live-stack',
  cardId: `card-${run}`,
  title: `[deckv2-live] recurring ${run}`,
  dueAt: start.toISOString(),
};
const checklist = {
  kind: 'checklist',
  boardId: 'live-board',
  stackId: 'live-stack',
  cardId: `card-${run}`,
  itemId: `item-${run}`,
  title: `[deckv2-live] checklist ${run}`,
  dueAt: start.toISOString().slice(0, 10),
};
const cleanupRange = {
  start: new Date(start.getTime() - 86_400_000).toISOString(),
  end: new Date(start.getTime() + 5 * 86_400_000).toISOString(),
};
let assertionsPassed = false;

try {
  const status = await integration.status('live-qa');
  assert(status.connected, 'Proton automation session is not ready');

  await integration.schedule('live-qa', card, { recurrence: { freq: 'DAILY', count: 3 }, reminderMinutes: 15 });
  await integration.schedule('live-qa', checklist);

  const planner = await integration.planner('live-qa', cleanupRange);
  const recurring = planner.events.filter((event) => event.title === card.title);
  const checklistEvents = planner.events.filter((event) => event.title === checklist.title);
  assert(recurring.length === 3, `Expected 3 recurring occurrences, received ${recurring.length}`);
  assert(recurring.every((event) => event.isRecurring), 'Recurring occurrences were not marked recurring');
  assert(checklistEvents.length === 1 && checklistEvents[0].allDay, 'Checklist date did not become one all-day event');

  const changed = { ...card, title: `${card.title} updated`, dueAt: new Date(start.getTime() + 60 * 60_000).toISOString() };
  const sync = await integration.sync('live-qa', [changed, checklist]);
  assert(sync.updated.length === 1 && sync.errors.length === 0, 'Deck-to-Proton update did not reconcile cleanly');

  const updatedPlanner = await integration.planner('live-qa', cleanupRange);
  assert(updatedPlanner.events.filter((event) => event.title === changed.title).length === 3, 'Updated recurring series was not visible in Planner');
  assertionsPassed = true;
} finally {
  const cleanupErrors = [];
  for (const mapping of mappings.list('live-qa')) {
    await integration.unlink('live-qa', mapping.entryKey, { deleteEvent: true }).catch((error) => cleanupErrors.push(error));
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Live Proton Calendar QA cleanup failed');
  if (assertionsPassed) {
    const afterCleanup = await integration.planner('live-qa', cleanupRange);
    assert(!afterCleanup.events.some((event) => event.title.includes(run)), 'Live Proton Calendar QA left test events behind');
    process.stdout.write('Live Deck v2 ↔ Proton Calendar QA passed: one protected recurring series, three occurrences, one all-day checklist event, update, and verified cleanup.\n');
  }
}

function roundedFutureDate(days) {
  const value = new Date(Date.now() + days * 86_400_000);
  value.setUTCMinutes(0, 0, 0);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
