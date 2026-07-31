import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckAbortError, DeckClient, DeckError } from './deck.js';

const auth = 'Basic ' + btoa('alice:app-password');

function client() {
  return new DeckClient({ baseUrl: 'https://nextcloud-alice.example', username: 'alice', password: 'app-password' });
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
  it('omits OCS-APIRequest for Deck API requests while keeping auth and cookie isolation', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json([]));

    await client().deck('/boards');

    expect(fetch).toHaveBeenCalledWith(
      'https://nextcloud-alice.example/index.php/apps/deck/api/v1.0/boards',
      expect.objectContaining({ credentials: 'omit' })
    );
    const init = fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe(auth);
    expect(init.headers).not.toHaveProperty('OCS-APIRequest');
  });

  it('sends OCS-APIRequest for OCS API requests and unwraps ocs.data', async () => {
    const payload = { ocs: { meta: { status: 'ok' }, data: [{ id: 1 }] } };
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(payload));

    const result = await client().ocs('/apps/activity/api/v2/activity/filter');

    const init = fetch.mock.calls[0][1];
    expect(init.headers.Authorization).toBe(auth);
    expect(init.headers['OCS-APIRequest']).toBe('true');
    expect(init.credentials).toBe('omit');
    expect(result.data).toEqual([{ id: 1 }]);
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
      json({ message: `denied ${auth}` }, { status: 403 })
    );

    await expect(client().deck('/boards')).rejects.toMatchObject({
      name: 'DeckError',
      status: 403,
      message: 'denied [redacted]',
    });
  });

  it('surfaces non-JSON text errors as typed safe errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(`server failed ${auth}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain' },
      })
    );

    await expect(client().deck('/boards')).rejects.toMatchObject({
      name: 'DeckError',
      status: 500,
      message: 'server failed [redacted]',
    });
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
