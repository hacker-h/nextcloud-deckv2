import { describe, expect, it, vi } from 'vitest';
import { ProtonCalendarApi, ProtonCalendarError } from './proton-calendar.js';

function response(data, status = 200) {
  return new Response(JSON.stringify(status >= 400 ? data : { data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ProtonCalendarApi', () => {
  it('keeps the bearer token server-side and forwards idempotency keys', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ id: 'event-1', calendarId: 'calendar-1' }, 201));
    const api = new ProtonCalendarApi({ baseUrl: 'http://calendar.test/', token: 'server-secret', fetch });

    await api.createEvent({ title: 'Deck card' }, { idempotencyKey: 'deck-retry-1' });

    expect(fetch).toHaveBeenCalledWith('http://calendar.test/v1/events', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer server-secret', 'X-Idempotency-Key': 'deck-retry-1' }),
      body: JSON.stringify({ title: 'Deck card' }),
    }));
  });

  it('uses explicit calendar routes and consumes every event page', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ events: [{ id: 'one' }], nextCursor: 'next' }))
      .mockResolvedValueOnce(response({ events: [{ id: 'two' }], nextCursor: null }));
    const api = new ProtonCalendarApi({ baseUrl: 'http://calendar.test', token: 'token', calendarId: 'cal/1', fetch });

    await expect(api.events({ start: '2026-08-01T00:00:00Z', end: '2026-08-08T00:00:00Z' })).resolves.toEqual({
      events: [{ id: 'one' }, { id: 'two' }],
      nextCursor: null,
    });
    expect(fetch.mock.calls[0][0]).toContain('/v1/calendars/cal%2F1/events?');
    expect(fetch.mock.calls[1][0]).toContain('cursor=next');
  });

  it('surfaces stable sanitized upstream errors without leaking payloads', async () => {
    const fetch = vi.fn().mockResolvedValue(response({
      error: {
        code: 'AUTH_EXPIRED',
        message: 'Bearer extremely-secret-token expired',
        details: { requestId: 'safe', cookies: 'must-not-pass' },
      },
    }, 401));
    const api = new ProtonCalendarApi({ baseUrl: 'http://calendar.test', token: 'token', fetch });

    await expect(api.authStatus()).rejects.toMatchObject({
      name: 'ProtonCalendarError',
      status: 401,
      code: 'AUTH_EXPIRED',
      message: 'Bearer [REDACTED] expired',
      details: { requestId: 'safe' },
    });
  });

  it('fails closed on malformed successful responses', async () => {
    const api = new ProtonCalendarApi({
      baseUrl: 'http://calendar.test',
      token: 'token',
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    });
    await expect(api.health()).rejects.toBeInstanceOf(ProtonCalendarError);
  });
});
