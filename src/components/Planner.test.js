import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import Planner from './Planner.svelte';

function card(changes = {}) {
  return { id: 42, boardId: 7, stackId: 8, title: 'Ship Planner', description: '', duedate: null, ...changes };
}

function setup({ enabled = true, connected = true, sync = {}, planner = {} } = {}) {
  const currentCard = card();
  const calendar = {
    status: vi.fn().mockResolvedValue({ enabled, connected, reloginRequired: !connected }),
    calendars: vi.fn().mockResolvedValue({ calendars: [{ id: 'cal-1', name: 'Deck' }], defaultCalendarId: 'cal-1' }),
    sync: vi.fn().mockResolvedValue({ created: [], updated: [], pulled: [], removed: [], conflicts: [], errors: [], ...sync }),
    planner: vi.fn().mockResolvedValue({ events: [], mappings: [], ...planner }),
    schedule: vi.fn().mockResolvedValue({ event: { id: 'event-1' }, mapping: { entryKey: 'card:7:42' } }),
  };
  const deckClient = {
    deck: vi.fn()
      .mockResolvedValueOnce({ data: currentCard })
      .mockResolvedValue({ data: { ...currentCard, duedate: '2026-08-24T10:00:00.000Z' } }),
  };
  const props = {
    calendar,
    deckClient,
    board: { id: 7, title: 'Product' },
    stacks: [{ id: 8, cards: [currentCard] }],
    onCard: vi.fn(),
    onOpenCard: vi.fn(),
  };
  return { ...render(Planner, { props }), calendar, deckClient, props };
}

describe('Planner', () => {
  it('explains when the server-side Proton integration is disabled', async () => {
    setup({ enabled: false });
    expect(await screen.findByText(/serverseitig noch nicht konfiguriert/i)).toBeInTheDocument();
    expect(screen.queryByText(/api token/i)).not.toBeInTheDocument();
  });

  it('synchronizes all current board dates and renders recurring Proton events', async () => {
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const { calendar } = setup({
      planner: {
        events: [{ id: 'series-1::occurrence', seriesId: 'series-1', title: 'Weekly review', start: start.toISOString(), occurrenceStart: start.toISOString(), isRecurring: true }],
        mappings: [{ entryKey: 'card:7:99', eventId: 'series-1' }],
      },
    });

    expect(await screen.findByText('Weekly review')).toBeInTheDocument();
    expect(screen.getByText(/Deck ↔ Proton/)).toBeInTheDocument();
    expect(screen.getByText(/↻/)).toBeInTheDocument();
    expect(calendar.sync).toHaveBeenCalledWith(
      [expect.objectContaining({ kind: 'card', cardId: '42', dueAt: null })],
      expect.objectContaining({ autoCreate: true, scopeBoardIds: ['7'], pruneMissing: true }),
    );
  });

  it('schedules a card with recurrence through Deck and Proton', async () => {
    const user = userEvent.setup();
    const { calendar, deckClient } = setup();

    await user.click(await screen.findByRole('button', { name: /Ship Planner/ }));
    const dialog = screen.getByRole('dialog', { name: 'In Proton Calendar einplanen' });
    await user.clear(screen.getByLabelText('Datum'));
    await user.type(screen.getByLabelText('Datum'), '2026-08-24');
    await user.clear(screen.getByLabelText('Uhrzeit'));
    await user.type(screen.getByLabelText('Uhrzeit'), '10:00');
    await user.selectOptions(screen.getByLabelText('Wiederholung'), 'WEEKLY');
    await user.selectOptions(screen.getByLabelText('Ende'), 'count');
    await user.clear(screen.getByLabelText('Anzahl'));
    await user.type(screen.getByLabelText('Anzahl'), '6');
    await user.click(screen.getByRole('button', { name: 'In Proton einplanen' }));

    await waitFor(() => expect(calendar.schedule).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'card', dueAt: expect.stringMatching(/^2026-08-24T/) }),
      expect.objectContaining({ calendarId: 'cal-1', recurrence: { freq: 'WEEKLY', count: 6 }, reminderMinutes: 15 }),
    ));
    expect(deckClient.deck).toHaveBeenCalledWith('/boards/7/stacks/8/cards/42', expect.objectContaining({ method: 'PUT' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('shows conflicts as explicit Deck-versus-Proton decisions', async () => {
    setup({
      sync: {
        conflicts: [{
          entryKey: 'card:7:42',
          deck: { title: 'Deck title', dueAt: '2026-08-20T10:00:00Z' },
          proton: { title: 'Proton title', dueAt: '2026-08-21T10:00:00Z' },
        }],
      },
    });

    expect(await screen.findByText(/1 Konflikt braucht/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deck behalten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Proton behalten' })).toBeInTheDocument();
  });
});
