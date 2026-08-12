import { createHash } from 'node:crypto';

const VALID_KINDS = new Set(['card', 'checklist']);
const VALID_FREQUENCIES = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);

export class CalendarIntegration {
  constructor({ api, mappings, allowedUsers = [], timezone = 'UTC', now = () => new Date() } = {}) {
    if (!api || !mappings) throw new Error('CalendarIntegration requires api and mappings');
    this.api = api;
    this.mappings = mappings;
    this.allowedUsers = new Set(allowedUsers);
    this.timezone = timezone;
    this.now = now;
  }

  assertUser(user) {
    if (this.allowedUsers.size && !this.allowedUsers.has(user)) {
      const error = new Error('Proton Calendar integration is not enabled for this Deck account');
      error.status = 403;
      error.code = 'CALENDAR_USER_NOT_ALLOWED';
      throw error;
    }
  }

  async status(user) {
    this.assertUser(user);
    const auth = await this.api.authStatus();
    const connected = auth.automationReady ?? auth.authenticated ?? false;
    return {
      enabled: true,
      connected: Boolean(connected),
      status: auth.status ?? auth.session?.status ?? (connected ? 'authenticated' : 'unknown'),
      reloginRequired: auth.reloginRequired ?? !connected,
      mappings: this.mappings.list(user).length,
    };
  }

  async calendars(user) {
    this.assertUser(user);
    return this.api.calendars();
  }

  async planner(user, { start, end }) {
    this.assertUser(user);
    assertRange(start, end);
    const { events } = await this.api.events({ start, end });
    return { events, mappings: this.mappings.list(user).map(publicMapping) };
  }

  async schedule(user, rawEntry, options = {}) {
    this.assertUser(user);
    const entry = normalizeEntry(rawEntry);
    const recurrence = normalizeRecurrence(options.recurrence);
    const existing = this.mappings.get(user, entry.entryKey);
    const recurrenceSpecified = Object.hasOwn(options, 'recurrence');
    const payload = eventPayload(entry, {
      recurrence,
      includeRecurrence: Boolean(existing && recurrenceSpecified),
      timezone: options.timezone || this.timezone,
      durationMinutes: options.durationMinutes,
      reminderMinutes: options.reminderMinutes,
    });
    const idempotencyKey = idempotency(user, entry.entryKey, entryHash(entry), recurrence);

    const event = existing
      ? await this.api.updateEvent(existing.eventId, payload, {
        calendarId: existing.calendarId,
        idempotencyKey,
        scope: 'series',
      })
      : await this.api.createEvent(payload, {
        calendarId: options.calendarId,
        idempotencyKey,
      });

    const mapping = this.mappings.put({
      user,
      entryKey: entry.entryKey,
      kind: entry.kind,
      boardId: entry.boardId,
      stackId: entry.stackId,
      cardId: entry.cardId,
      itemId: entry.itemId ?? null,
      calendarId: event.calendarId,
      eventId: baseEventId(event),
      deckHash: entryHash(entry),
      eventUpdatedAt: event.updatedAt ?? null,
      dueAt: entry.dueAt,
      title: entry.title,
      recurrence,
      updatedAt: this.now().toISOString(),
    });
    return { event, mapping: publicMapping(mapping) };
  }

  async sync(user, rawEntries, options = {}) {
    this.assertUser(user);
    if (!Array.isArray(rawEntries) || rawEntries.length > 500) throw integrationError(400, 'INVALID_ENTRIES', 'entries must be an array of at most 500 items');
    const entries = rawEntries.map(normalizeEntry);
    const entryKeys = new Set();
    for (const entry of entries) {
      if (entryKeys.has(entry.entryKey)) throw integrationError(400, 'DUPLICATE_ENTRY', `Duplicate entry ${entry.entryKey}`);
      entryKeys.add(entry.entryKey);
    }

    const result = { created: [], updated: [], pulled: [], removed: [], conflicts: [], errors: [] };
    for (const entry of entries) {
      try {
        await this.#syncEntry(user, entry, options, result);
      } catch (error) {
        result.errors.push({ entryKey: entry.entryKey, code: error.code ?? 'CALENDAR_SYNC_ERROR', message: safeMessage(error.message) });
      }
    }
    if (Array.isArray(options.scopeBoardIds) && options.pruneMissing === true) {
      const boardIds = new Set(options.scopeBoardIds.map(String));
      const stale = this.mappings.list(user).filter((mapping) => boardIds.has(String(mapping.boardId)) && !entryKeys.has(mapping.entryKey));
      for (const mapping of stale) {
        try {
          await this.unlink(user, mapping.entryKey, { deleteEvent: true });
          result.removed.push({ entryKey: mapping.entryKey });
        } catch (error) {
          result.errors.push({ entryKey: mapping.entryKey, code: error.code ?? 'CALENDAR_SYNC_ERROR', message: safeMessage(error.message) });
        }
      }
    }
    return result;
  }

  async unlink(user, entryKey, { deleteEvent = false } = {}) {
    this.assertUser(user);
    const mapping = this.mappings.get(user, entryKey);
    if (!mapping) return { removed: false };
    if (deleteEvent) {
      await this.api.deleteEvent(mapping.eventId, {
        calendarId: mapping.calendarId,
        idempotencyKey: idempotency(user, entryKey, 'delete'),
        scope: 'series',
      });
    }
    this.mappings.remove(user, entryKey);
    return { removed: true, eventDeleted: deleteEvent };
  }

  async #syncEntry(user, entry, options, result) {
    const mapping = this.mappings.get(user, entry.entryKey);
    if (!mapping) {
      if (!entry.dueAt || options.autoCreate === false) return;
      const scheduled = await this.schedule(user, entry, { calendarId: options.calendarId });
      result.created.push(scheduled.mapping);
      return;
    }

    let event;
    try {
      event = await this.api.event(mapping.eventId, { calendarId: mapping.calendarId });
    } catch (error) {
      if (error.status !== 404) throw error;
      this.mappings.remove(user, entry.entryKey);
      if (entry.dueAt) {
        const scheduled = await this.schedule(user, entry, { calendarId: options.calendarId, recurrence: mapping.recurrence });
        result.created.push(scheduled.mapping);
      }
      return;
    }

    const deckHash = entryHash(entry);
    const deckChanged = deckHash !== mapping.deckHash;
    const eventChanged = Boolean(mapping.eventUpdatedAt && event.updatedAt && mapping.eventUpdatedAt !== event.updatedAt);

    // A user may resolve a conflict by applying the Proton value to Deck before
    // the next sync. Both revision markers then changed, but the data already
    // converged and must not be reported as the same conflict forever.
    if (deckChanged && eventChanged && eventMatchesEntry(entry, event)) {
      this.mappings.put({
        ...mapping,
        title: entry.title,
        dueAt: entry.dueAt,
        recurrence: event.recurrence ? normalizeRecurrence(event.recurrence) : null,
        deckHash,
        eventUpdatedAt: event.updatedAt,
        updatedAt: this.now().toISOString(),
      });
      return;
    }

    if (deckChanged && eventChanged) {
      result.conflicts.push({
        entryKey: entry.entryKey,
        deck: { title: entry.title, dueAt: entry.dueAt },
        proton: { title: event.title, dueAt: event.start, updatedAt: event.updatedAt },
      });
      return;
    }

    if (eventChanged) {
      const pulled = { entryKey: entry.entryKey, title: pullTitle(entry, event), dueAt: pullDueAt(entry, event) };
      result.pulled.push(pulled);
      this.mappings.put({
        ...mapping,
        title: pulled.title,
        dueAt: pulled.dueAt,
        recurrence: event.recurrence ? normalizeRecurrence(event.recurrence) : null,
        deckHash: entryHash({ ...entry, title: pulled.title, dueAt: pulled.dueAt }),
        eventUpdatedAt: event.updatedAt,
        updatedAt: this.now().toISOString(),
      });
      return;
    }

    if (!deckChanged) return;
    if (!entry.dueAt) {
      await this.unlink(user, entry.entryKey, { deleteEvent: true });
      result.removed.push({ entryKey: entry.entryKey });
      return;
    }

    const scheduled = await this.schedule(user, entry, {
      calendarId: mapping.calendarId,
      recurrence: mapping.recurrence,
    });
    result.updated.push(scheduled.mapping);
  }
}

export function entryKey({ kind, boardId, cardId, itemId }) {
  return kind === 'checklist'
    ? `checklist:${boardId}:${cardId}:${itemId}`
    : `card:${boardId}:${cardId}`;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== 'object') throw integrationError(400, 'INVALID_ENTRY', 'entry must be an object');
  const kind = String(raw.kind ?? 'card');
  if (!VALID_KINDS.has(kind)) throw integrationError(400, 'INVALID_ENTRY', 'entry.kind must be card or checklist');
  const boardId = requiredId(raw.boardId, 'boardId');
  const stackId = requiredId(raw.stackId, 'stackId');
  const cardId = requiredId(raw.cardId, 'cardId');
  const itemId = kind === 'checklist' ? requiredId(raw.itemId, 'itemId') : null;
  const title = String(raw.title ?? '').trim();
  if (!title || title.length > 255) throw integrationError(400, 'INVALID_ENTRY', 'entry.title must be 1..255 characters');
  const dueAt = raw.dueAt == null || raw.dueAt === '' ? null : normalizeDueAt(raw.dueAt, kind);
  return {
    kind,
    boardId,
    stackId,
    cardId,
    itemId,
    title,
    dueAt,
    allDay: kind === 'checklist' || Boolean(raw.allDay),
    entryKey: entryKey({ kind, boardId, cardId, itemId }),
  };
}

function normalizeDueAt(value, kind) {
  const text = String(value);
  if (kind === 'checklist' && /^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) throw integrationError(400, 'INVALID_ENTRY', 'entry.dueAt must be an ISO date or date-time');
  return parsed.toISOString();
}

function normalizeRecurrence(raw) {
  if (!raw) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw integrationError(400, 'INVALID_RECURRENCE', 'recurrence must be an object');
  const freq = String(raw.freq ?? '').toUpperCase();
  if (!VALID_FREQUENCIES.has(freq)) throw integrationError(400, 'INVALID_RECURRENCE', 'Unsupported recurrence frequency');
  const recurrence = { freq, interval: positiveInt(raw.interval, 1) };
  if (raw.count != null && raw.count !== '') recurrence.count = positiveInt(raw.count);
  if (raw.until) recurrence.until = new Date(raw.until).toISOString();
  if (recurrence.count && recurrence.until) throw integrationError(400, 'INVALID_RECURRENCE', 'recurrence.count and recurrence.until cannot both be set');
  return recurrence;
}

function eventPayload(entry, { recurrence, includeRecurrence = false, timezone, durationMinutes = 30, reminderMinutes = null }) {
  const allDay = entry.allDay;
  const start = entry.dueAt;
  const end = allDay ? nextDate(start) : new Date(Date.parse(start) + positiveInt(durationMinutes, 30) * 60_000).toISOString();
  const payload = {
    title: entry.title,
    description: descriptionTrailer(entry),
    start,
    end,
    allDay,
    timezone,
    protected: true,
  };
  if (recurrence || includeRecurrence) payload.recurrence = recurrence;
  if (reminderMinutes != null) payload.reminder = `${positiveInt(reminderMinutes)}m`;
  return payload;
}

function descriptionTrailer(entry) {
  return [
    'Synchronized by Deck v2.',
    '',
    '--- deckv2 ---',
    `kind: ${entry.kind}`,
    `board: ${entry.boardId}`,
    `card: ${entry.cardId}`,
    ...(entry.itemId ? [`item: ${entry.itemId}`] : []),
  ].join('\n');
}

function entryHash(entry) {
  return createHash('sha256').update(JSON.stringify({
    kind: entry.kind,
    boardId: entry.boardId,
    stackId: entry.stackId,
    cardId: entry.cardId,
    itemId: entry.itemId ?? null,
    title: entry.title,
    dueAt: entry.dueAt,
  })).digest('hex');
}

function idempotency(...parts) {
  return `deckv2-${createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 48)}`;
}

function baseEventId(event) {
  return String(event.seriesId ?? event.id);
}

function pullTitle(entry, event) {
  if (entry.kind === 'checklist' && event.title.includes(' › ')) return event.title.split(' › ').at(-1);
  return event.title;
}

function pullDueAt(entry, event) {
  return entry.kind === 'checklist' || event.allDay ? String(event.start).slice(0, 10) : new Date(event.start).toISOString();
}

function eventMatchesEntry(entry, event) {
  return pullTitle(entry, event) === entry.title && pullDueAt(entry, event) === entry.dueAt;
}

function publicMapping(mapping) {
  return {
    entryKey: mapping.entryKey,
    kind: mapping.kind,
    boardId: mapping.boardId,
    stackId: mapping.stackId,
    cardId: mapping.cardId,
    itemId: mapping.itemId,
    calendarId: mapping.calendarId,
    eventId: mapping.eventId,
    dueAt: mapping.dueAt,
    recurrence: mapping.recurrence,
    updatedAt: mapping.updatedAt,
  };
}

function requiredId(value, field) {
  const text = String(value ?? '').trim();
  if (!text || text.length > 128 || /[\u0000-\u001f]/.test(text)) throw integrationError(400, 'INVALID_ENTRY', `entry.${field} is invalid`);
  return text;
}

function positiveInt(value, fallback = null) {
  if ((value == null || value === '') && fallback != null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 10000) throw integrationError(400, 'INVALID_NUMBER', 'Expected a positive integer');
  return parsed;
}

function nextDate(date) {
  const parsed = new Date(`${String(date).slice(0, 10)}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function assertRange(start, end) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 93 * 86_400_000) {
    throw integrationError(400, 'INVALID_RANGE', 'Calendar range must be valid and at most 93 days');
  }
}

function integrationError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function safeMessage(message) {
  return String(message ?? 'Calendar sync failed').replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]').slice(0, 500);
}
