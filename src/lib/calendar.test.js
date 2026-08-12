import { describe, expect, it, vi } from 'vitest';
import { CalendarClient, CalendarClientError, applyCalendarPulls, calendarEntries, unscheduledEntries } from './calendar.js';

const description = [
  'Card details',
  '',
  '## Checklist: QA',
  '- [ ] Browser tests <!-- id:item_one due:2026-08-20 -->',
  '- [x] Unit tests <!-- id:item_two -->',
].join('\n');

function stacks() {
  return [{
    id: 8,
    cards: [{ id: 42, boardId: 7, title: 'Ship Planner', description, duedate: '2026-08-19T10:00:00Z' }],
  }];
}

describe('CalendarClient', () => {
  it('calls the same-origin bridge without any Proton credential', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ enabled: true }), { status: 200 }));
    const client = new CalendarClient({ fetch });

    await expect(client.status()).resolves.toEqual({ enabled: true });
    expect(fetch).toHaveBeenCalledWith('/integration/proton-calendar/status', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    expect(JSON.stringify(fetch.mock.calls)).not.toMatch(/bearer|token/i);
  });

  it('surfaces stable bridge errors and handles expired Deck sessions', async () => {
    const onUnauthorized = vi.fn();
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'AUTH_EXPIRED', message: 'Reconnect Proton' } }), { status: 401 }));
    const client = new CalendarClient({ fetch, onUnauthorized });

    await expect(client.calendars()).rejects.toMatchObject({ name: 'CalendarClientError', code: 'AUTH_EXPIRED' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(CalendarClientError.prototype).toBeInstanceOf(Error);
  });
});

describe('calendar entry projection', () => {
  it('projects cards and every checklist date source into stable sync entries', () => {
    expect(calendarEntries(stacks(), 7)).toEqual([
      expect.objectContaining({ kind: 'card', boardId: '7', stackId: '8', cardId: '42', title: 'Ship Planner', dueAt: '2026-08-19T10:00:00Z' }),
      expect.objectContaining({ kind: 'checklist', itemId: 'item_one', title: 'Ship Planner › Browser tests', dueAt: '2026-08-20', allDay: true }),
      expect.objectContaining({ kind: 'checklist', itemId: 'item_two', title: 'Ship Planner › Unit tests', dueAt: null, allDay: true }),
    ]);
    expect(unscheduledEntries(calendarEntries(stacks(), 7))).toEqual([expect.objectContaining({ itemId: 'item_two' })]);
  });

  it('applies Proton card and checklist changes through replace-style-safe Deck updates', async () => {
    const deckClient = {
      deck: vi.fn()
        .mockResolvedValueOnce({ data: stacks()[0].cards[0] })
        .mockResolvedValueOnce({ data: { ...stacks()[0].cards[0], title: 'Planner shipped', duedate: '2026-08-21T09:00:00Z', description: 'updated' } }),
    };
    const onCard = vi.fn();

    const result = await applyCalendarPulls(deckClient, stacks(), [
      { entryKey: 'card:7:42', title: 'Planner shipped', dueAt: '2026-08-21T09:00:00Z' },
      { entryKey: 'checklist:7:42:item_one', title: 'Ship Planner › Cross-browser QA', dueAt: '2026-08-22' },
    ], onCard);

    expect(deckClient.deck).toHaveBeenLastCalledWith('/boards/7/stacks/8/cards/42', expect.objectContaining({
      method: 'PUT',
      body: expect.objectContaining({
        title: 'Planner shipped',
        duedate: '2026-08-21T09:00:00Z',
        description: expect.stringContaining('Cross-browser QA'),
      }),
    }));
    expect(result).toHaveLength(1);
    expect(onCard).toHaveBeenCalledOnce();
  });
});
