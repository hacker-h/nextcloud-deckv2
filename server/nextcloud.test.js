import { describe, expect, it, vi } from 'vitest';
import { LoginExpiredError, NextcloudClient } from './nextcloud.js';

const okJson = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe('Nextcloud Login Flow v2 client', () => {
  it('starts login flow and returns login URL plus poll token', async () => {
    const fetch = vi.fn().mockResolvedValue(okJson({ login: 'https://nc/login/flow', poll: { token: 'poll-token' } }));
    const client = new NextcloudClient({ baseUrl: 'https://nc.test', fetch });
    await expect(client.initLogin()).resolves.toEqual({ loginUrl: 'https://nc/login/flow', pollToken: 'poll-token' });
    expect(fetch).toHaveBeenCalledWith('https://nc.test/index.php/login/v2', expect.objectContaining({ method: 'POST' }));
  });

  it('returns null while poll is pending with 404', async () => {
    const client = new NextcloudClient({ baseUrl: 'https://nc.test', fetch: vi.fn().mockResolvedValue(new Response('', { status: 404 })) });
    await expect(client.poll('token')).resolves.toBeNull();
  });

  it('returns app password and login name on poll success', async () => {
    const fetch = vi.fn().mockResolvedValue(okJson({ appPassword: 'app-password', loginName: 'alice', server: 'https://nc.test' }));
    const client = new NextcloudClient({ baseUrl: 'https://nc.test', fetch });
    await expect(client.poll('token')).resolves.toEqual({ appPassword: 'app-password', loginName: 'alice' });
    expect(String(fetch.mock.calls[0][1].body)).toBe('token=token');
  });

  it('distinguishes expiry from network or malformed responses', async () => {
    const client = new NextcloudClient({ baseUrl: 'https://nc.test', fetch: vi.fn(), now: () => 1_201_000 });
    await expect(client.poll('token', { createdAt: 0 })).rejects.toBeInstanceOf(LoginExpiredError);

    await expect(new NextcloudClient({ baseUrl: 'https://nc.test', fetch: vi.fn().mockRejectedValue(new Error('offline')) }).poll('token')).rejects.toThrow('offline');
    await expect(new NextcloudClient({ baseUrl: 'https://nc.test', fetch: vi.fn().mockResolvedValue(okJson({ nope: true })) }).poll('token')).rejects.toThrow(/malformed/i);
  });
});
