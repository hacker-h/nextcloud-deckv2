import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckAbortError, DeckClient, DeckError } from './deck.js';

function client() {
  return new DeckClient();
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('DeckClient transport', () => {
  it('omits OCS-APIRequest for Deck API requests while using same-origin credentials', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    await client().deck('/boards');

    expect(fetch).toHaveBeenCalledWith(
      '/api/deck/boards',
      expect.objectContaining({ credentials: 'same-origin' })
    );
    const init = fetch.mock.calls[0][1];
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers).not.toHaveProperty('OCS-APIRequest');
  });

  it('sends OCS-APIRequest for OCS API requests and unwraps ocs.data', async () => {
    const payload = { ocs: { meta: { status: 'ok' }, data: [{ id: 1 }] } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(payload));

    const result = await client().ocs('/apps/activity/api/v2/activity/filter');

    const init = fetch.mock.calls[0][1];
    expect(fetch.mock.calls[0][0]).toBe('/api/ocs/apps/activity/api/v2/activity/filter');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.headers['OCS-APIRequest']).toBe('true');
    expect(init.credentials).toBe('same-origin');
    expect(result.data).toEqual([{ id: 1 }]);
  });

  it('never sends an Authorization header', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json({ ocs: { data: [] } })));
    const c = client();

    await c.deck('/boards');
    await c.ocs('/apps/activity/api/v2/activity/filter');
    await c.deck('/boards/1/stacks/2/cards/3', { method: 'PUT', body: { title: 'No auth here' } });

    for (const [, init] of fetch.mock.calls) {
      expect(init.headers.Authorization).toBeUndefined();
      expect(Object.keys(init.headers).some((key) => key.toLowerCase() === 'authorization')).toBe(false);
    }
  });

  it('returns 304 before parsing a JSON body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 304 }));

    await expect(client().deck('/boards', { etag: '"etag"' })).resolves.toEqual({
      notModified: true,
      etag: '"etag"',
    });
  });

  it('surfaces JSON errors without leaking Authorization', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({ message: 'denied Basic YWxpY2U6YXBwLXBhc3N3b3Jk' }, { status: 403 })
    );

    await expect(client().deck('/boards')).rejects.toMatchObject({
      name: 'DeckError',
      status: 403,
      message: 'denied Basic [REDACTED]',
    });
  });

  it('surfaces non-JSON text errors as typed safe errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('server failed Basic YWxpY2U6YXBwLXBhc3N3b3Jk', {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(client().deck('/boards')).rejects.toMatchObject({
      name: 'DeckError',
      status: 500,
      message: 'server failed Basic [REDACTED]',
    });
  });

  it('surfaces a 401 as a DeckError with status 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json({ message: 'unauthenticated' }, { status: 401 }));

    await expect(client().deck('/boards')).rejects.toMatchObject({
      name: 'DeckError',
      status: 401,
      message: 'unauthenticated',
    });
    await expect(client().deck('/boards')).rejects.toBeInstanceOf(DeckError);
  });

  it('redacts an Authorization header echoed back in an upstream error body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('proxy failed: Basic YWxpY2U6c2VjcmV0 and Bearer abc.def-ghi', {
        status: 502,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    const err = await client().deck('/boards').catch((error) => error);
    expect(err).toBeInstanceOf(DeckError);
    expect(err.message).toContain('Basic [REDACTED]');
    expect(err.message).toContain('Bearer [REDACTED]');
    expect(err.message).not.toContain('YWxpY2U6c2VjcmV0');
    expect(err.message).not.toContain('abc.def-ghi');
  });

  it('normalizes fetch aborts to AbortError', async () => {
    const abort = new Error('cancelled');
    abort.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(abort);

    await expect(client().deck('/boards', { signal: new AbortController().signal })).rejects.toBeInstanceOf(
      DeckAbortError
    );
  });

  it('supports binary response reads', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));

    const result = await client().deck('/attachments/1', { responseType: 'arrayBuffer' });

    expect([...new Uint8Array(result.data)]).toEqual([1, 2, 3]);
  });
});
