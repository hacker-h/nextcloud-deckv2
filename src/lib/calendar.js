import { updateCard } from './cards.js';
import { parseChecklists, serializeChecklists } from './checklist.js';

const API = '/integration/proton-calendar';

export class CalendarClientError extends Error {
  constructor(status, code, message, details = null) {
    super(message || `Calendar integration error ${status}`);
    this.name = 'CalendarClientError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class CalendarClient {
  constructor({ fetch = globalThis.fetch, onUnauthorized = () => {} } = {}) {
    const fetchImpl = fetch;
    this.fetch = (...args) => fetchImpl(...args);
    this.onUnauthorized = onUnauthorized;
  }

  status() {
    return this.#request('/status');
  }

  calendars() {
    return this.#request('/calendars');
  }

  planner({ start, end }) {
    const query = new URLSearchParams({ start, end });
    return this.#request(`/planner?${query}`);
  }

  sync(entries, options = {}) {
    return this.#request('/sync', {
      method: 'POST',
      body: {
        entries,
        autoCreate: options.autoCreate,
        calendarId: options.calendarId,
        scopeBoardIds: options.scopeBoardIds,
        pruneMissing: options.pruneMissing,
      },
    });
  }

  schedule(entry, options = {}) {
    return this.#request('/schedule', { method: 'POST', body: { entry, ...options } });
  }

  unlink(entryKey, { deleteEvent = false } = {}) {
    return this.#request('/unlink', { method: 'POST', body: { entryKey, deleteEvent } });
  }

  async #request(path, { method = 'GET', body } = {}) {
    const headers = { Accept: 'application/json' };
    const init = { method, headers, credentials: 'same-origin' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    const response = await this.fetch(`${API}${path}`, init);
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) this.onUnauthorized();
      const error = payload?.error ?? {};
      throw new CalendarClientError(response.status, error.code ?? 'CALENDAR_INTEGRATION_ERROR', error.message, error.details);
    }
    return payload;
  }
}

export function calendarEntries(stacks, boardId) {
  const entries = [];
  for (const stack of stacks ?? []) {
    for (const card of stack.cards ?? []) {
      const target = {
        boardId: String(boardId),
        stackId: String(stack.id),
        cardId: String(card.id),
      };
      entries.push({
        kind: 'card',
        ...target,
        title: card.title,
        dueAt: card.duedate ?? null,
      });
      for (const checklist of parseChecklists(card.description ?? '').checklists) {
        for (const item of checklist.items) {
          entries.push({
            kind: 'checklist',
            ...target,
            itemId: String(item.id),
            title: `${card.title} › ${item.text}`,
            dueAt: item.duedate ?? null,
            allDay: true,
          });
        }
      }
    }
  }
  return entries;
}

export function unscheduledEntries(entries) {
  return entries.filter((entry) => !entry.dueAt);
}

export async function applyCalendarPulls(deckClient, stacks, changes, onCard = () => {}) {
  const cards = indexCards(stacks);
  const grouped = new Map();
  for (const change of changes ?? []) {
    const parsed = parseEntryKey(change.entryKey);
    if (!parsed) continue;
    const key = `${parsed.boardId}:${parsed.cardId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ ...change, ...parsed });
  }

  const updated = [];
  for (const changesForCard of grouped.values()) {
    const first = changesForCard[0];
    const indexed = cards.get(`${first.boardId}:${first.cardId}`) ?? cards.get(`*:${first.cardId}`);
    if (!indexed) continue;
    const { card, stackId } = indexed;
    const cardChange = changesForCard.find((change) => change.kind === 'card');
    const checklistChanges = changesForCard.filter((change) => change.kind === 'checklist');
    const patch = {};
    if (cardChange) {
      patch.title = cardChange.title;
      patch.duedate = cardChange.dueAt;
    }
    if (checklistChanges.length) {
      const parsed = parseChecklists(card.description ?? '');
      const byItem = new Map(checklistChanges.map((change) => [String(change.itemId), change]));
      const checklists = parsed.checklists.map((checklist) => ({
        ...checklist,
        items: checklist.items.map((item) => {
          const change = byItem.get(String(item.id));
          return change ? { ...item, text: checklistTitle(change.title), duedate: change.dueAt } : item;
        }),
      }));
      patch.description = serializeChecklists(parsed.descriptionText, checklists);
    }
    const response = await updateCard(deckClient, {
      boardId: first.boardId,
      stackId,
      cardId: first.cardId,
      changes: patch,
    });
    updated.push(response.data);
    onCard(response.data);
  }
  return updated;
}

function indexCards(stacks) {
  const index = new Map();
  for (const stack of stacks ?? []) {
    for (const card of stack.cards ?? []) {
      index.set(`${card.boardId ?? ''}:${card.id}`, { card, stackId: String(stack.id) });
      index.set(`*:${card.id}`, { card, stackId: String(stack.id) });
    }
  }
  return index;
}

function parseEntryKey(value) {
  const parts = String(value ?? '').split(':');
  if (parts[0] === 'card' && parts.length === 3) return { kind: 'card', boardId: parts[1], cardId: parts[2], itemId: null };
  if (parts[0] === 'checklist' && parts.length >= 4) return { kind: 'checklist', boardId: parts[1], cardId: parts[2], itemId: parts.slice(3).join(':') };
  return null;
}

function checklistTitle(title) {
  return String(title).split(' › ').at(-1);
}
