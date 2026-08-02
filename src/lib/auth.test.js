import { describe, expect, it, vi } from 'vitest';
import { createAuthStore } from './auth.svelte.js';

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(body),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function settleUntil(assertion) {
  let lastError;
  for (let i = 0; i < 20; i += 1) {
    await flush();
    try {
      assertion();
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

describe('auth store', () => {
  it('check() authenticates a signed-in user', async () => {
    const fetch = vi.fn().mockResolvedValue(response(200, { user: 'alice' }));
    const auth = createAuthStore({ fetch });

    await auth.check();

    expect(auth.state.status).toBe('authenticated');
    expect(auth.state.user).toBe('alice');
  });

  it('check() marks 401 as anonymous', async () => {
    const fetch = vi.fn().mockResolvedValue(response(401, { error: 'unauthenticated' }));
    const auth = createAuthStore({ fetch });

    await auth.check();

    expect(auth.state.status).toBe('anonymous');
    expect(auth.state.user).toBeNull();
  });

  it('runs the full sign-in flow from pending polls to authenticated', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { user: 'alice' }));
    const auth = createAuthStore({ fetch, pollDelays: [1, 2], wait: vi.fn().mockResolvedValue() });

    await expect(auth.signIn()).resolves.toBe('https://cloud/login');
    expect(auth.state.status).toBe('pending');
    expect(auth.state.loginUrl).toBe('https://cloud/login');
    await settleUntil(() => expect(auth.state.status).toBe('authenticated'));

    expect(auth.state.user).toBe('alice');
    expect(auth.state.loginUrl).toBeNull();
  });

  it('marks login expiry distinctly from generic errors', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockResolvedValueOnce(response(410, { error: 'login expired' }));
    const auth = createAuthStore({ fetch, wait: vi.fn().mockResolvedValue() });

    await auth.signIn();
    await settleUntil(() => expect(auth.state.status).toBe('anonymous'));

    expect(auth.state.expired).toBe(true);
    expect(auth.state.error).toMatch(/expired/i);
  });

  it('uses an injected capped non-decreasing backoff schedule', async () => {
    const waits = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(204))
      .mockResolvedValueOnce(response(200, { user: 'alice' }));
    const auth = createAuthStore({
      fetch,
      pollDelays: [10, 20, 20],
      wait: vi.fn((ms) => {
        waits.push(ms);
        return Promise.resolve();
      }),
    });

    await auth.signIn();
    await settleUntil(() => expect(auth.state.status).toBe('authenticated'));

    expect(waits).toEqual([10, 20, 20, 20]);
  });

  it('cancel() mid-poll prevents a late response from mutating state', async () => {
    const pendingPoll = deferred();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockReturnValueOnce(pendingPoll.promise);
    const auth = createAuthStore({ fetch, wait: vi.fn().mockResolvedValue() });

    await auth.signIn();
    auth.cancel();
    pendingPoll.resolve(response(200, { user: 'alice' }));
    await flush();

    expect(auth.state.status).toBe('anonymous');
    expect(auth.state.user).toBeNull();
  });

  it('does not run a second poll loop when signIn() is called twice while pending', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockResolvedValueOnce(response(204));
    const auth = createAuthStore({ fetch, wait: () => new Promise(() => {}) });

    await auth.signIn();
    await auth.signIn();

    expect(fetch.mock.calls.filter(([url]) => url === '/auth/poll')).toHaveLength(1);
  });

  it('signOut() posts logout and clears authenticated state', async () => {
    const fetch = vi.fn().mockResolvedValue(response(204));
    const auth = createAuthStore({ fetch });
    auth.state.status = 'authenticated';
    auth.state.user = 'alice';

    await auth.signOut();

    expect(fetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    expect(auth.state.status).toBe('anonymous');
    expect(auth.state.user).toBeNull();
    expect(auth.state.error).toBeNull();
  });

  it('signOut() clears state even when logout rejects and surfaces the error', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    const auth = createAuthStore({ fetch });
    auth.state.status = 'authenticated';
    auth.state.user = 'alice';

    await auth.signOut();

    expect(auth.state.status).toBe('anonymous');
    expect(auth.state.user).toBeNull();
    expect(auth.state.error).toBe('offline');
  });

  it('sends credentials: same-origin on every request', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response(401, { error: 'unauthenticated' }))
      .mockResolvedValueOnce(response(200, { loginUrl: 'https://cloud/login' }))
      .mockResolvedValueOnce(response(200, { user: 'alice' }))
      .mockResolvedValueOnce(response(204));
    const auth = createAuthStore({ fetch, wait: vi.fn().mockResolvedValue() });

    await auth.check();
    await auth.signIn();
    await settleUntil(() => expect(auth.state.status).toBe('authenticated'));
    await auth.signOut();

    expect(fetch.mock.calls.map(([, options]) => options.credentials)).toEqual([
      'same-origin',
      'same-origin',
      'same-origin',
      'same-origin',
    ]);
  });
});
