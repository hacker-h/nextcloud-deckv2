import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { SessionStore } from './sessions.js';

const secret = Buffer.alloc(32, 9);
const upstreamCalls = [];
let servers = [];

afterEach(async () => {
  vi.restoreAllMocks();
  upstreamCalls.length = 0;
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
  servers = [];
});

function makeSessions() {
  const dir = mkdtempSync(join(tmpdir(), 'deck-app-'));
  return new SessionStore({ filePath: join(dir, 'sessions.json'), secret });
}

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function upstream(handler) {
  return listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      upstreamCalls.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      handler(req, res);
    });
  });
}

async function appUrl({ nextcloud, sessions, client, now } = {}) {
  const handler = createApp({ ncUrl: nextcloud, sessions, nextcloud: client, now });
  return listen(handler);
}

function cookieNamed(response, name) {
  return response.headers
    .get('set-cookie')
    ?.split(/,(?=\s*[^;=]+=)/)
    .find((cookie) => cookie.trim().startsWith(`${name}=`))
    ?.split(';')[0];
}

describe('auth routes', () => {
  it('runs login, pending poll, successful poll, me, and logout with upstream revocation', async () => {
    const sessions = makeSessions();
    const revokeBase = await upstream((req, res) => res.writeHead(200).end('{}'));
    const client = {
      initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'poll-token' }),
      poll: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ appPassword: 'app-password', loginName: 'alice' }),
    };
    const base = await appUrl({ nextcloud: revokeBase, sessions, client });

    const login = await fetch(`${base}/auth/login`, { method: 'POST' });
    expect(await login.json()).toEqual({ loginUrl: 'https://nc/login' });
    const flowCookie = cookieNamed(login, 'flow');
    expect(flowCookie).toBeTruthy();

    expect((await fetch(`${base}/auth/poll`, { headers: { cookie: flowCookie } })).status).toBe(204);
    const poll = await fetch(`${base}/auth/poll`, { headers: { cookie: flowCookie } });
    expect(poll.status).toBe(200);
    expect(poll.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict; Path=\//);
    expect(poll.headers.get('set-cookie')).toContain('flow=;');
    const cookie = cookieNamed(poll, 'sid');

    await expect((await fetch(`${base}/auth/me`, { headers: { cookie } })).json()).resolves.toEqual({ user: 'alice' });
    const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie, Origin: base } });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(upstreamCalls.at(-1)).toMatchObject({ method: 'DELETE', url: '/ocs/v2.php/core/apppassword' });
    expect(upstreamCalls.at(-1).headers.authorization).toMatch(/^Basic /);
  });

  it('keeps double-login flows independent and rejects unauthenticated me', async () => {
    const client = {
      initLogin: vi.fn().mockResolvedValueOnce({ loginUrl: 'one', pollToken: 'one' }).mockResolvedValueOnce({ loginUrl: 'two', pollToken: 'two' }),
      poll: vi.fn(async (token) => ({ appPassword: `${token}-password`, loginName: token })),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client });
    const firstLogin = await fetch(`${base}/auth/login`, { method: 'POST' });
    const secondLogin = await fetch(`${base}/auth/login`, { method: 'POST' });
    expect(await secondLogin.json()).toEqual({ loginUrl: 'two' });
    const firstPoll = await fetch(`${base}/auth/poll`, { headers: { cookie: cookieNamed(firstLogin, 'flow') } });
    const secondPoll = await fetch(`${base}/auth/poll`, { headers: { cookie: cookieNamed(secondLogin, 'flow') } });
    expect(await firstPoll.json()).toEqual({ user: 'one' });
    expect(await secondPoll.json()).toEqual({ user: 'two' });
    expect((await fetch(`${base}/auth/me`)).status).toBe(401);
  });

  it('does not let a second browser hijack another pending login by polling without a flow cookie', async () => {
    const client = {
      initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'alice-token' }),
      poll: vi.fn().mockResolvedValue({ appPassword: 'alice-password', loginName: 'alice' }),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client });
    await fetch(`${base}/auth/login`, { method: 'POST' });

    const malloryPoll = await fetch(`${base}/auth/poll`);

    expect(malloryPoll.status).not.toBe(200);
    expect(cookieNamed(malloryPoll, 'sid')).toBeUndefined();
  });

  it('supports concurrent pending flows without account swaps', async () => {
    const client = {
      initLogin: vi
        .fn()
        .mockResolvedValueOnce({ loginUrl: 'https://nc/alice', pollToken: 'alice-token' })
        .mockResolvedValueOnce({ loginUrl: 'https://nc/bob', pollToken: 'bob-token' }),
      poll: vi.fn(async (token) => ({ appPassword: `${token}-password`, loginName: token.replace('-token', '') })),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client });
    const aliceFlow = cookieNamed(await fetch(`${base}/auth/login`, { method: 'POST' }), 'flow');
    const bobFlow = cookieNamed(await fetch(`${base}/auth/login`, { method: 'POST' }), 'flow');

    const alicePoll = await fetch(`${base}/auth/poll`, { headers: { cookie: aliceFlow } });
    const bobPoll = await fetch(`${base}/auth/poll`, { headers: { cookie: bobFlow } });

    expect(await alicePoll.json()).toEqual({ user: 'alice' });
    expect(await bobPoll.json()).toEqual({ user: 'bob' });
    expect(client.poll).toHaveBeenCalledWith('alice-token', expect.any(Object));
    expect(client.poll).toHaveBeenCalledWith('bob-token', expect.any(Object));
  });

  it('rejects forged flow ids without minting a session', async () => {
    const client = {
      initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'real-token' }),
      poll: vi.fn().mockResolvedValue({ appPassword: 'alice-password', loginName: 'alice' }),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client });
    await fetch(`${base}/auth/login`, { method: 'POST' });

    const forged = await fetch(`${base}/auth/poll`, { headers: { cookie: 'flow=forged' } });

    expect(forged.status).toBe(410);
    expect(cookieNamed(forged, 'sid')).toBeUndefined();
    expect(client.poll).not.toHaveBeenCalled();
  });

  it('expires pending flows after the Login Flow v2 lifetime and evicts them', async () => {
    let now = 1_000;
    const client = {
      initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'old-token' }),
      poll: vi.fn().mockResolvedValue({ appPassword: 'alice-password', loginName: 'alice' }),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client, now: () => now });
    const flowCookie = cookieNamed(await fetch(`${base}/auth/login`, { method: 'POST' }), 'flow');
    now += 20 * 60 * 1000 + 1;

    const expired = await fetch(`${base}/auth/poll`, { headers: { cookie: flowCookie } });
    const evicted = await fetch(`${base}/auth/poll`, { headers: { cookie: flowCookie } });

    expect(expired.status).toBe(410);
    expect(evicted.status).toBe(410);
    expect(cookieNamed(expired, 'sid')).toBeUndefined();
    expect(client.poll).not.toHaveBeenCalled();
  });
});

describe('authenticated proxy and guards', () => {
  it('injects auth, preserves ETag/If-None-Match and passes 304 through', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(304, { ETag: '"abc"' }).end());
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const res = await fetch(`${base}/api/deck/boards`, { headers: { cookie: `sid=${sid}`, 'If-None-Match': '"abc"' } });
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe('"abc"');
    expect(upstreamCalls[0].url).toBe('/index.php/apps/deck/api/v1.0/boards');
    expect(upstreamCalls[0].headers.authorization).toMatch(/^Basic /);
    expect(upstreamCalls[0].headers['if-none-match']).toBe('"abc"');
    expect(upstreamCalls[0].headers['accept-encoding']).toBe('identity');
    expect(upstreamCalls[0].headers).not.toHaveProperty('ocs-apirequest');
  });

  it('adds OCS-APIRequest only for OCS proxy routes and streams binary responses', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(Buffer.from([1, 2, 3])));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const res = await fetch(`${base}/api/ocs/apps/deck/api/v1.0/cards/99/comments`, { headers: { cookie: `sid=${sid}` } });
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(upstreamCalls[0].headers['ocs-apirequest']).toBe('true');
  });

  it('surfaces upstream 403 and rejects unauthenticated requests', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(403).end('denied'));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    expect((await fetch(`${base}/api/deck/boards`)).status).toBe(401);
    expect((await fetch(`${base}/api/deck/boards`, { headers: { cookie: `sid=${sid}` } })).status).toBe(403);
  });

  it('blocks non-allowlisted and traversal paths after normalisation', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(200).end('should-not-hit'));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const cookie = { cookie: `sid=${sid}` };
    expect((await fetch(`${base}/api/ocs/cloud/users`, { headers: cookie })).status).toBe(403);
    expect((await fetch(`${base}/api/deck/%2e%2e%2f%2e%2e%2focs/cloud/users`, { headers: cookie })).status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('rejects cross-origin mutating proxied requests but allows same-origin and GET', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(200).end('{}'));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const cookie = `sid=${sid}`;
    expect((await fetch(`${base}/api/deck/boards`, { headers: { cookie, Origin: 'https://evil.test' } })).status).toBe(200);
    expect((await fetch(`${base}/api/deck/boards`, { method: 'POST', headers: { cookie, Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await fetch(`${base}/api/deck/boards`, { method: 'POST', headers: { cookie, Origin: base } })).status).toBe(200);
  });
});
