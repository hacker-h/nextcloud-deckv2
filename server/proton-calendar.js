const DEFAULT_TIMEOUT_MS = 20_000;

export class ProtonCalendarError extends Error {
  constructor(status, code, message, details = null) {
    super(message || `Proton Calendar API error ${status}`);
    this.name = 'ProtonCalendarError';
    this.status = status;
    this.code = code || 'PROTON_CALENDAR_ERROR';
    this.details = details;
  }
}

export class ProtonCalendarApi {
  constructor({ baseUrl, token, calendarId = null, fetch = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (!baseUrl) throw new Error('ProtonCalendarApi requires baseUrl');
    if (!token) throw new Error('ProtonCalendarApi requires token');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.token = String(token);
    this.calendarId = calendarId ? String(calendarId) : null;
    this.fetch = fetch;
    this.timeoutMs = timeoutMs;
  }

  health() {
    return this.#request('/v1/health', { authenticated: false });
  }

  authStatus() {
    return this.#request('/v1/auth/status');
  }

  calendars() {
    return this.#request('/v1/calendars');
  }

  event(eventId, { calendarId = this.calendarId } = {}) {
    return this.#request(`${eventBase(calendarId)}/${encodeURIComponent(eventId)}`);
  }

  createEvent(body, { calendarId = this.calendarId, idempotencyKey } = {}) {
    return this.#request(eventBase(calendarId), { method: 'POST', body, idempotencyKey });
  }

  updateEvent(eventId, body, { calendarId = this.calendarId, idempotencyKey, scope = 'series' } = {}) {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    return this.#request(`${eventBase(calendarId)}/${encodeURIComponent(eventId)}${query}`, {
      method: 'PATCH',
      body,
      idempotencyKey,
    });
  }

  deleteEvent(eventId, { calendarId = this.calendarId, idempotencyKey, scope = 'series' } = {}) {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : '';
    return this.#request(`${eventBase(calendarId)}/${encodeURIComponent(eventId)}${query}`, {
      method: 'DELETE',
      idempotencyKey,
    });
  }

  async events({ start, end, calendarId = this.calendarId, limit = 200 } = {}) {
    const events = [];
    let cursor = null;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams({ start, end, limit: String(limit) });
      if (cursor) query.set('cursor', cursor);
      const data = await this.#request(`${eventBase(calendarId)}?${query}`);
      events.push(...(data.events ?? []));
      cursor = data.nextCursor ?? null;
      if (!cursor) return { events, nextCursor: null };
    }
    throw new ProtonCalendarError(502, 'PROTON_CALENDAR_PAGE_LIMIT', 'Proton Calendar pagination exceeded 100 pages');
  }

  async #request(path, { method = 'GET', body, idempotencyKey, authenticated = true } = {}) {
    const headers = { Accept: 'application/json' };
    if (authenticated) headers.Authorization = `Bearer ${this.token}`;
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error?.name === 'TimeoutError'
        ? 'Proton Calendar API timed out'
        : 'Proton Calendar API is unavailable';
      throw new ProtonCalendarError(503, 'PROTON_CALENDAR_UNAVAILABLE', message);
    }

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const upstream = payload?.error ?? {};
      throw new ProtonCalendarError(
        response.status,
        String(upstream.code ?? 'PROTON_CALENDAR_ERROR'),
        safeMessage(upstream.message) || `Proton Calendar API error ${response.status}`,
        safeDetails(upstream.details),
      );
    }
    if (!payload || !Object.hasOwn(payload, 'data')) {
      throw new ProtonCalendarError(502, 'PROTON_CALENDAR_INVALID_RESPONSE', 'Proton Calendar API returned an invalid response');
    }
    return payload.data;
  }
}

function eventBase(calendarId) {
  return calendarId
    ? `/v1/calendars/${encodeURIComponent(calendarId)}/events`
    : '/v1/events';
}

function safeMessage(value) {
  return String(value ?? '').replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]').slice(0, 500);
}

function safeDetails(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = {};
  for (const key of ['retryAfterSeconds', 'retryAfterMs', 'requestId']) {
    if (Object.hasOwn(value, key)) allowed[key] = value[key];
  }
  return Object.keys(allowed).length ? allowed : null;
}
