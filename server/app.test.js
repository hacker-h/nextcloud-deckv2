import { createServer, request as httpRequest } from 'node:http';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

async function appUrl({ nextcloud, sessions, client, now, distDir, flowLimits } = {}) {
  const handler = createApp({ ncUrl: nextcloud, sessions, nextcloud: client, now, distDir, flowLimits });
  return listen(handler);
}

function fixtureDist() {
  const dir = mkdtempSync(join(tmpdir(), 'deck-dist-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="app">client</div>');
  writeFileSync(join(dir, 'assets', 'index-a1b2c3.js'), 'console.log("asset")');
  writeFileSync(join(dir, 'assets', 'style-a1b2c3.css'), 'body{}');
  return dir;
}

function rawGet(base, path) {
  const target = new URL(base);
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ hostname: target.hostname, port: target.port, path, method: 'GET' }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function rawRequest(base, { path = '/', method = 'GET', headers = {}, body = '' } = {}) {
  const target = new URL(base);
  return new Promise((resolveRequest, reject) => {
    const req = httpRequest({ hostname: target.hostname, port: target.port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        resolveRequest({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function rawSocketRequest(base, requestLine) {
  const target = new URL(base);
  return new Promise((resolveRequest, reject) => {
    const socket = connect(Number(target.port), target.hostname);
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${requestLine}\r\nHost: ${target.host}\r\nConnection: close\r\n\r\n`));
    socket.on('data', (chunk) => { raw += chunk; });
    socket.on('error', reject);
    socket.on('close', () => {
      const [head, body = ''] = raw.split('\r\n\r\n');
      const status = Number(head.match(/^HTTP\/\d\.\d\s+(\d+)/)?.[1]);
      resolveRequest({ status, body, raw });
    });
  });
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

    await expect((await fetch(`${base}/auth/me`, { headers: { cookie } })).json()).resolves.toEqual({ user: 'alice', instance: revokeBase });
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
    const me = await fetch(`${base}/auth/me`);
    expect(me.status).toBe(401);
    await expect(me.json()).resolves.toEqual({ error: 'unauthenticated', instance: 'https://nc.test' });
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

  it('rejects cross-origin logout without revoking or killing the session', async () => {
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const nextcloud = await upstream((req, res) => res.writeHead(200).end('{}'));
    const base = await appUrl({ nextcloud, sessions });

    const blocked = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: `sid=${sid}`, Origin: 'https://evil.example' } });
    const me = await fetch(`${base}/auth/me`, { headers: { cookie: `sid=${sid}` } });

    expect(blocked.status).toBe(403);
    await expect(me.json()).resolves.toEqual({ user: 'alice', instance: nextcloud });
    expect(upstreamCalls).toHaveLength(0);
  });

  it('caps unauthenticated login flows globally and per IP before calling Nextcloud', async () => {
    const client = { initLogin: vi.fn(async () => ({ loginUrl: 'https://nc/login', pollToken: `token-${client.initLogin.mock.calls.length}` })) };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions: makeSessions(), client, flowLimits: { global: 2, perIp: 1 } });

    expect((await rawRequest(base, { method: 'POST', path: '/auth/login', headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(200);
    expect((await rawRequest(base, { method: 'POST', path: '/auth/login', headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(429);
    expect((await rawRequest(base, { method: 'POST', path: '/auth/login', headers: { 'x-forwarded-for': '203.0.113.2' } })).status).toBe(200);
    expect((await rawRequest(base, { method: 'POST', path: '/auth/login', headers: { 'x-forwarded-for': '203.0.113.3' } })).status).toBe(429);
    expect(client.initLogin).toHaveBeenCalledTimes(2);
  });

  it('destroys an existing session before completing a re-login', async () => {
    const sessions = makeSessions();
    const oldSid = sessions.create('old-password', 'old-user');
    const client = {
      initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'new-token' }),
      poll: vi.fn().mockResolvedValue({ appPassword: 'new-password', loginName: 'new-user' }),
    };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions, client });
    const flow = cookieNamed(await fetch(`${base}/auth/login`, { method: 'POST' }), 'flow');

    const poll = await fetch(`${base}/auth/poll`, { headers: { cookie: `${flow}; sid=${oldSid}` } });

    expect(poll.status).toBe(200);
    expect(sessions.get(oldSid)).toBeNull();
    await expect((await fetch(`${base}/auth/me`, { headers: { cookie: cookieNamed(poll, 'sid') } })).json()).resolves.toMatchObject({ user: 'new-user' });
  });

  it('uses host-prefixed cookies over HTTPS and rejects duplicate session cookie names', async () => {
    const sessions = makeSessions();
    const hostSid = sessions.create('host-password', 'host-user');
    const plainSid = sessions.create('plain-password', 'plain-user');
    const client = { initLogin: vi.fn().mockResolvedValue({ loginUrl: 'https://nc/login', pollToken: 'flow-token' }) };
    const base = await appUrl({ nextcloud: 'https://nc.test', sessions, client });

    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'x-forwarded-proto': 'https', Origin: base.replace('http:', 'https:') } });
    const preferred = await fetch(`${base}/auth/me`, { headers: { cookie: `sid=${plainSid}; __Host-sid=${hostSid}` } });
    const duplicate = await fetch(`${base}/auth/me`, { headers: { cookie: `sid=${plainSid}; sid=${hostSid}` } });

    expect(login.headers.get('set-cookie')).toContain('__Host-flow=');
    expect(await preferred.json()).toMatchObject({ user: 'host-user' });
    expect(duplicate.status).toBe(400);
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

  it('returns a redacted JSON error instead of streaming upstream error bodies', async () => {
    const leaked = `failure Authorization: Basic ${Buffer.from('alice:app-password').toString('base64')}`;
    const nextcloud = await upstream((req, res) => res.writeHead(500, { 'Content-Type': 'text/plain' }).end(leaked));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });

    const res = await fetch(`${base}/api/deck/boards`, { headers: { cookie: `sid=${sid}` } });
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(body).not.toContain(Buffer.from('alice:app-password').toString('base64'));
    expect(JSON.parse(body)).toMatchObject({ error: 'upstream error', status: 500, message: 'failure Authorization: Basic [REDACTED]' });
  });

  it('blocks non-allowlisted and traversal paths after normalisation', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(200).end('should-not-hit'));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const cookie = { cookie: `sid=${sid}` };
    expect((await fetch(`${base}/api/ocs/cloud/users`, { headers: cookie })).status).toBe(403);
    expect((await fetch(`${base}/api/deck/%2e%2e%2f%2e%2e%2focs/cloud/users`, { headers: cookie })).status).toBe(403);
    expect((await fetch(`${base}/api/deck/%252f..%252f..%252focs/cloud/users`, { headers: cookie })).status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
  });

  it('requires an exact Origin on production-host mutating proxied requests', async () => {
    const nextcloud = await upstream((req, res) => res.writeHead(200).end('{}'));
    const sessions = makeSessions();
    const sid = sessions.create('app-password', 'alice');
    const base = await appUrl({ nextcloud, sessions });
    const target = new URL(base);
    const headers = { Host: 'deck.example.test', Cookie: `sid=${sid}` };

    expect((await rawRequest(base, { method: 'POST', path: '/api/deck/boards', headers })).status).toBe(403);
    expect((await rawRequest(base, { method: 'POST', path: '/api/deck/boards', headers: { ...headers, Origin: 'https://evil.test' } })).status).toBe(403);
    expect((await rawRequest(base, { method: 'POST', path: '/api/deck/boards', headers: { ...headers, Origin: `http://${headers.Host}` } })).status).toBe(200);
    expect(target.hostname).toBe('127.0.0.1');
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

describe('static client serving', () => {
  it('serves index.html at / with no-cache', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await fetch(`${base}/`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toContain('<div id="app">client</div>');
  });

  it('serves a hashed asset with content type and immutable caching', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await fetch(`${base}/assets/index-a1b2c3.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toContain('console.log');
  });

  it('falls back to index.html for extensionless SPA routes', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await fetch(`${base}/some/deep/route`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="app">client</div>');
  });

  it('returns 404 for missing asset paths instead of index.html', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await fetch(`${base}/assets/missing.js`);

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<div id="app">client</div>');
  });

  it.each(['/../server/app.js', '/%2e%2e/%2e%2e/package.json', '/....//package.json', '/assets/index-a1b2c3.js%00'])('refuses traversal attempt %s', async (path) => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await rawGet(base, path);

    expect(res.status).toBe(404);
    expect(res.body).not.toContain('createApp');
    expect(res.body).not.toContain('nextcloud-deckv2');
  });

  it('refuses traversal-shaped SPA fallback paths sent over a raw socket', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await rawSocketRequest(base, 'GET /%2e%2e/%2e%2e/%2e%2e/%2e%2e/etc/passwd HTTP/1.1');

    expect(res.status).toBe(404);
    expect(res.body).not.toContain('<div id="app">client</div>');
  });

  it('refuses symlink escapes from distDir', async () => {
    const distDir = fixtureDist();
    const outside = mkdtempSync(join(tmpdir(), 'deck-outside-'));
    writeFileSync(join(outside, 'secret.txt'), 'outside secret');
    symlinkSync(resolve(outside, 'secret.txt'), join(distDir, 'assets', 'escape.txt'));
    const base = await appUrl({ distDir });

    const res = await fetch(`${base}/assets/escape.txt`);

    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('outside secret');
  });

  it('leaves unauthenticated api routes as 401 JSON', async () => {
    const base = await appUrl({ distDir: fixtureDist(), nextcloud: 'https://nc.test', sessions: makeSessions() });

    const res = await fetch(`${base}/api/deck/boards`);

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'unauthenticated' });
  });

  it('keeps unknown POST paths as 404 JSON', async () => {
    const base = await appUrl({ distDir: fixtureDist() });

    const res = await fetch(`${base}/unknown`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    await expect(res.json()).resolves.toEqual({ error: 'not found' });
  });

  it('404s cleanly when distDir does not exist', async () => {
    const base = await appUrl({ distDir: join(tmpdir(), 'deck-missing-dist') });

    const res = await fetch(`${base}/`);

    expect(res.status).toBe(404);
  });
});
