import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CalendarIntegration, entryKey } from './calendar-integration.js';
import { CalendarMappingStore } from './calendar-mappings.js';

function card(changes = {}) {
  return {
    kind: 'card',
    boardId: 7,
    stackId: 8,
    cardId: 42,
    title: 'Ship Planner',
    dueAt: '2026-08-20T10:00:00.000Z',
    ...changes,
  };
}

function fixture() {
  let sequence = 0;
  const events = new Map();
  const api = {
    authStatus: vi.fn().mockResolvedValue({ automationReady: true, status: 'access_valid' }),
    calendars: vi.fn().mockResolvedValue({ calendars: [{ id: 'cal-1', name: 'Deck' }] }),
    events: vi.fn(async () => ({ events: [...events.values()] })),
    createEvent: vi.fn(async (payload, options) => {
      sequence += 1;
      const event = { ...payload, id: `event-${sequence}`, calendarId: options.calendarId ?? 'cal-1', updatedAt: `2026-08-12T00:00:0${sequence}.000Z` };
      events.set(event.id, event);
      return event;
    }),
    event: vi.fn(async (id) => {
      const event = events.get(id);
      if (!event) throw Object.assign(new Error('missing'), { status: 404, code: 'NOT_FOUND' });
      return event;
    }),
    updateEvent: vi.fn(async (id, payload) => {
      sequence += 1;
      const event = { ...events.get(id), ...payload, id, updatedAt: `2026-08-12T00:00:${String(sequence).padStart(2, '0')}.000Z` };
      events.set(id, event);
      return event;
    }),
    deleteEvent: vi.fn(async (id) => {
      events.delete(id);
      return { id };
    }),
  };
  const mappings = new CalendarMappingStore({ filePath: join(mkdtempSync(join(tmpdir(), 'deck-sync-')), 'mappings.json') });
  const integration = new CalendarIntegration({ api, mappings, allowedUsers: ['alice'], timezone: 'Europe/Berlin', now: () => new Date('2026-08-12T00:00:00Z') });
  return { api, events, integration, mappings };
}

describe('CalendarIntegration', () => {
  it('accepts the authenticated status shape returned by proton-calendar-cli', async () => {
    const { api, integration } = fixture();
    api.authStatus.mockResolvedValue({ authenticated: true, session: { status: 'access_valid' } });

    await expect(integration.status('alice')).resolves.toMatchObject({
      connected: true,
      reloginRequired: false,
      status: 'access_valid',
    });
  });

  it('creates a protected Proton event with recurrence and durable linkage', async () => {
    const { api, integration, mappings } = fixture();

    const result = await integration.schedule('alice', card(), {
      calendarId: 'cal-1',
      recurrence: { freq: 'WEEKLY', count: 5 },
      reminderMinutes: 15,
    });

    expect(api.createEvent).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ship Planner',
      start: '2026-08-20T10:00:00.000Z',
      end: '2026-08-20T10:30:00.000Z',
      timezone: 'Europe/Berlin',
      protected: true,
      recurrence: { freq: 'WEEKLY', interval: 1, count: 5 },
      reminder: '15m',
      description: expect.stringContaining('card: 42'),
    }), expect.objectContaining({ calendarId: 'cal-1', idempotencyKey: expect.stringMatching(/^deckv2-/) }));
    expect(result.mapping).toMatchObject({ entryKey: 'card:7:42', eventId: 'event-1' });
    expect(mappings.get('alice', 'card:7:42')).toMatchObject({ recurrence: { freq: 'WEEKLY', interval: 1, count: 5 } });
  });

  it('creates all-day checklist events and exposes them in Planner', async () => {
    const { api, integration } = fixture();
    const checklist = card({ kind: 'checklist', itemId: 'item-1', title: 'QA checklist', dueAt: '2026-08-22' });

    await integration.schedule('alice', checklist);
    const planner = await integration.planner('alice', { start: '2026-08-20T00:00:00Z', end: '2026-08-30T00:00:00Z' });

    expect(api.createEvent).toHaveBeenCalledWith(expect.objectContaining({ start: '2026-08-22', end: '2026-08-23', allDay: true }), expect.any(Object));
    expect(planner.events).toHaveLength(1);
    expect(planner.mappings[0]).toMatchObject({ entryKey: 'checklist:7:42:item-1', kind: 'checklist' });
  });

  it('automatically creates new dated entries and pushes Deck-only changes', async () => {
    const { api, integration } = fixture();
    await integration.sync('alice', [card()]);
    const result = await integration.sync('alice', [card({ title: 'Ship Planner safely' })]);

    expect(result.created).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(api.updateEvent).toHaveBeenCalledWith('event-1', expect.objectContaining({ title: 'Ship Planner safely' }), expect.any(Object));
  });

  it('can explicitly remove recurrence from an existing series', async () => {
    const { api, integration } = fixture();
    await integration.schedule('alice', card(), { recurrence: { freq: 'DAILY', count: 3 } });
    await integration.schedule('alice', card(), { recurrence: null });

    expect(api.updateEvent).toHaveBeenCalledWith(
      'event-1',
      expect.objectContaining({ recurrence: null }),
      expect.objectContaining({ scope: 'series' }),
    );
  });

  it('pulls Proton-only title and due-date changes back to Deck', async () => {
    const { events, integration } = fixture();
    await integration.sync('alice', [card()]);
    events.set('event-1', {
      ...events.get('event-1'),
      title: 'Planner shipped',
      start: '2026-08-21T09:00:00.000Z',
      recurrence: { freq: 'MONTHLY', count: 4 },
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    const result = await integration.sync('alice', [card()]);

    expect(result.pulled).toEqual([{ entryKey: 'card:7:42', title: 'Planner shipped', dueAt: '2026-08-21T09:00:00.000Z' }]);
    expect(integration.mappings.get('alice', 'card:7:42')).toMatchObject({ recurrence: { freq: 'MONTHLY', interval: 1, count: 4 } });
  });

  it('recognizes simultaneous revisions that already converged', async () => {
    const { events, integration } = fixture();
    await integration.sync('alice', [card()]);
    const converged = card({ title: 'Same result', dueAt: '2026-08-21T09:00:00.000Z' });
    events.set('event-1', {
      ...events.get('event-1'),
      title: converged.title,
      start: converged.dueAt,
      updatedAt: '2026-08-13T00:00:00.000Z',
    });

    const result = await integration.sync('alice', [converged]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.pulled).toHaveLength(0);
    expect(integration.mappings.get('alice', 'card:7:42')).toMatchObject({ title: 'Same result', dueAt: converged.dueAt });
  });

  it('reports a conflict rather than overwriting simultaneous changes', async () => {
    const { api, events, integration } = fixture();
    await integration.sync('alice', [card()]);
    events.set('event-1', { ...events.get('event-1'), start: '2026-08-21T09:00:00.000Z', updatedAt: '2026-08-13T00:00:00.000Z' });

    const result = await integration.sync('alice', [card({ title: 'Changed in Deck' })]);

    expect(result.conflicts).toHaveLength(1);
    expect(api.updateEvent).not.toHaveBeenCalled();
  });

  it('deletes only its linked Proton event when a due date is cleared', async () => {
    const { api, events, integration, mappings } = fixture();
    await integration.sync('alice', [card()]);
    const result = await integration.sync('alice', [card({ dueAt: null })]);

    expect(result.removed).toEqual([{ entryKey: 'card:7:42' }]);
    expect(api.deleteEvent).toHaveBeenCalledWith('event-1', expect.objectContaining({ scope: 'series' }));
    expect(events.size).toBe(0);
    expect(mappings.get('alice', 'card:7:42')).toBeNull();
  });

  it('enforces per-user access and validates stable entry keys', async () => {
    const { integration } = fixture();
    await expect(integration.status('mallory')).rejects.toMatchObject({ status: 403, code: 'CALENDAR_USER_NOT_ALLOWED' });
    expect(entryKey({ kind: 'card', boardId: 7, cardId: 42 })).toBe('card:7:42');
    expect(entryKey({ kind: 'checklist', boardId: 7, cardId: 42, itemId: 'a' })).toBe('checklist:7:42:a');
  });
});
