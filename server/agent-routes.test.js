import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { SessionStore } from './sessions.js';
import { AgentTokenStore } from './agent-tokens.js';

const secret = Buffer.alloc(32, 7);
let servers = [];
let state;

function tempFile(name) {
  return join(mkdtempSync(join(tmpdir(), 'deck-agent-route-')), name);
}

async function listen(handler) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

function freshState() {
  return {
    boards: [
      { id: 1, title: 'Work', color: 'ff0000', permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: true } },
      { id: 2, title: 'Personal', color: '00ff00', permissions: { PERMISSION_EDIT: true } },
    ],
    stacks: {
      1: [
        { id: 10, title: 'Todo', order: 0, cards: [card(100, 'Write spec', 0), card(101, 'Review PR', 1)] },
        { id: 11, title: 'Done', order: 1, cards: [card(102, 'Ship it', 0)] },
      ],
      2: [{ id: 20, title: 'Later', order: 0, cards: [card(200, 'Buy milk', 0)] }],
    },
    calls: [],
  };
}

function card(id, title, order) {
  return { id, title, description: `${title} body`, order, type: 'plain', owner: { uid: 'alice' }, duedate: null, labels: [], assignedUsers: [] };
}

function findCard(cardId) {
  for (const [boardId, stacks] of Object.entries(state.stacks)) {
    for (const stack of stacks) {
      const index = stack.cards.findIndex((entry) => entry.id === Number(cardId));
      if (index !== -1) return { boardId, stack, index, card: stack.cards[index] };
    }
  }
  return null;
}

async function fakeNextcloud() {
  return listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      const path = req.url.replace('/index.php/apps/deck/api/v1.0', '');
      state.calls.push({ method: req.method, path, body });
      const json = (status, payload) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
      };

      if (req.method === 'GET' && path === '/boards') return json(200, state.boards);

      let match = path.match(/^\/boards\/(\d+)\/stacks$/);
      if (match && req.method === 'GET') return json(200, state.stacks[match[1]] ?? []);
      if (match && req.method === 'POST') {
        const stack = { id: 99, title: body.title, order: body.order, cards: [] };
        (state.stacks[match[1]] ??= []).push(stack);
        return json(200, stack);
      }

      if (req.method === 'POST' && path === '/boards') {
        const board = { id: 3, title: body.title, color: body.color, permissions: { PERMISSION_EDIT: true, PERMISSION_MANAGE: true } };
        state.boards.push(board);
        state.stacks[3] = [];
        return json(200, board);
      }

      match = path.match(/^\/boards\/(\d+)\/stacks\/(\d+)\/cards$/);
      if (match && req.method === 'POST') {
        const created = { ...card(300, body.title, 0), description: body.description, duedate: body.duedate };
        state.stacks[match[1]].find((stack) => stack.id === Number(match[2])).cards.push(created);
        return json(200, created);
      }

      match = path.match(/^\/boards\/(\d+)\/stacks\/(\d+)\/cards\/(\d+)$/);
      if (match && req.method === 'GET') {
        const hit = findCard(match[3]);
        return hit ? json(200, hit.card) : json(404, { message: 'not found' });
      }
      if (match && req.method === 'PUT') {
        const hit = findCard(match[3]);
        if (!hit) return json(404, { message: 'not found' });
        hit.stack.cards.splice(hit.index, 1);
        const target = state.stacks[match[1]].find((stack) => stack.id === Number(match[2]));
        const updated = { ...hit.card, ...body, id: hit.card.id };
        target.cards.push(updated);
        target.cards.sort((a, b) => Number(a.order) - Number(b.order));
        return json(200, updated);
      }

      return json(404, { message: 'unhandled' });
    });
  });
}

async function harness({ scopes = ['boards:read', 'cards:read', 'cards:write', 'inbox:write'], boardIds = null, calendarIntegration = null, agentRate } = {}) {
  const ncUrl = await fakeNextcloud();
  const sessions = new SessionStore({ filePath: tempFile('sessions.json'), secret });
  const agentTokens = new AgentTokenStore({ filePath: tempFile('agent-tokens.json') });
  const sid = sessions.create('app-password', 'alice');
  const { token } = agentTokens.issue({ user: 'alice', sessionId: sid, label: 'test', scopes, boardIds });
  const base = await listen(createApp({ ncUrl, sessions, nextcloud: {}, calendarIntegration, agentTokens, agentRate, audit: () => {} }));
  return { base, token, sid, sessions, agentTokens };
}

function agentFetch(base, path, { token, method = 'GET', body } = {}) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  state = freshState();
});

afterEach(async () => {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  servers = [];
});

describe('agent authentication', () => {
  it('rejects requests without a bearer token', async () => {
    const { base } = await harness();
    const res = await agentFetch(base, '/agent/boards');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('rejects invalid and revoked tokens', async () => {
    const { base, token, agentTokens } = await harness();
    expect((await agentFetch(base, '/agent/boards', { token: 'deckv2_bad.secret' })).status).toBe(401);

    const [id] = agentTokens.list('alice');
    agentTokens.revoke('alice', id.id);
    expect((await agentFetch(base, '/agent/boards', { token })).status).toBe(401);
  });

  it('ignores session cookies so the surface cannot be driven by CSRF', async () => {
    const { base, sid } = await harness();
    const res = await fetch(`${base}/agent/boards`, { headers: { Cookie: `sid=${sid}` } });
    expect(res.status).toBe(401);
  });

  it('stops working once the originating session is destroyed', async () => {
    const { base, token, sessions, sid } = await harness();
    expect((await agentFetch(base, '/agent/boards', { token })).status).toBe(200);

    sessions.destroy(sid);
    const res = await agentFetch(base, '/agent/boards', { token });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('SESSION_EXPIRED');
  });

  it('returns 503 when the agent API is not configured', async () => {
    const sessions = new SessionStore({ filePath: tempFile('sessions.json'), secret });
    const base = await listen(createApp({ ncUrl: 'http://127.0.0.1:1', sessions, nextcloud: {} }));
    expect((await agentFetch(base, '/agent/boards', { token: 'deckv2_x.y' })).status).toBe(503);
  });

  it('rate limits per token', async () => {
    const { base, token } = await harness({ agentRate: { windowMs: 60_000, max: 2 } });
    await agentFetch(base, '/agent/whoami', { token });
    await agentFetch(base, '/agent/whoami', { token });
    const res = await agentFetch(base, '/agent/whoami', { token });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});

describe('agent scopes', () => {
  it('refuses actions outside the granted scopes', async () => {
    const { base, token } = await harness({ scopes: ['boards:read'] });
    const res = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100'], toBoardId: '1', toStackId: '11' } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('MISSING_SCOPE');
  });

  it('hides and refuses boards outside the board scope', async () => {
    const { base, token } = await harness({ boardIds: ['1'] });

    const boards = await (await agentFetch(base, '/agent/boards', { token })).json();
    expect(boards.boards.map((board) => board.id)).toEqual([1]);

    const res = await agentFetch(base, '/agent/board?boardId=2', { token });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('BOARD_OUT_OF_SCOPE');
  });

  it('never leaks out-of-scope cards through search', async () => {
    const { base, token } = await harness({ boardIds: ['1'] });
    const body = await (await agentFetch(base, '/agent/cards/search?q=milk', { token })).json();
    expect(body.results).toEqual([]);
  });
});

describe('agent read routes', () => {
  it('describes the token and its capabilities', async () => {
    const { base, token } = await harness({ boardIds: ['1'] });
    const who = await (await agentFetch(base, '/agent/whoami', { token })).json();
    expect(who).toMatchObject({ user: 'alice', label: 'test', boardIds: ['1'] });

    const caps = await (await agentFetch(base, '/agent/capabilities', { token })).json();
    expect(caps.calendar.available).toBe(false);
    expect(caps.routes.some((route) => route.path === '/agent/cards/move')).toBe(true);
  });

  it('returns the board ordered by stack and card order', async () => {
    const { base, token } = await harness();
    const body = await (await agentFetch(base, '/agent/board?boardId=1', { token })).json();
    expect(body.stacks.map((stack) => stack.title)).toEqual(['Todo', 'Done']);
    expect(body.stacks[0].cards.map((entry) => entry.title)).toEqual(['Write spec', 'Review PR']);
  });

  it('searches titles and descriptions and honours the limit', async () => {
    const { base, token } = await harness();
    const hit = await (await agentFetch(base, '/agent/cards/search?q=spec', { token })).json();
    expect(hit.results.map((entry) => entry.id)).toEqual(['100']);

    const limited = await (await agentFetch(base, '/agent/cards/search?q=body&limit=1', { token })).json();
    expect(limited.results).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('rejects an empty search query', async () => {
    const { base, token } = await harness();
    expect((await agentFetch(base, '/agent/cards/search?q=', { token })).status).toBe(400);
  });
});

describe('agent bulk move', () => {
  it('moves several cards into a lane preserving their relative order', async () => {
    const { base, token } = await harness();
    const res = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100', '101'], toBoardId: '1', toStackId: '11' } });

    expect(res.status).toBe(200);
    expect((await res.json()).moved).toHaveLength(2);

    const done = state.stacks[1].find((stack) => stack.id === 11);
    expect(done.cards.map((entry) => entry.title)).toEqual(['Ship it', 'Write spec', 'Review PR']);
  });

  it('moves cards across boards', async () => {
    const { base, token } = await harness();
    await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['200'], toBoardId: '1', toStackId: '10' } });

    expect(state.stacks[2][0].cards).toHaveLength(0);
    expect(state.stacks[1][0].cards.map((entry) => entry.title)).toContain('Buy milk');
  });

  it('preserves the card title and description that Deck would otherwise wipe', async () => {
    const { base, token } = await harness();
    await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100'], toBoardId: '1', toStackId: '11' } });

    const moved = state.stacks[1].find((stack) => stack.id === 11).cards.find((entry) => entry.id === 100);
    expect(moved.title).toBe('Write spec');
    expect(moved.description).toBe('Write spec body');
  });

  it('refuses unknown cards without moving anything', async () => {
    const { base, token } = await harness();
    const res = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100', '999'], toBoardId: '1', toStackId: '11' } });

    expect(res.status).toBe(404);
    expect(state.stacks[1].find((stack) => stack.id === 11).cards).toHaveLength(1);
  });

  it('refuses an unknown destination stack', async () => {
    const { base, token } = await harness();
    const res = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100'], toBoardId: '1', toStackId: '77' } });
    expect((await res.json()).error.code).toBe('STACK_NOT_FOUND');
  });

  it('validates ids and duplicates', async () => {
    const { base, token } = await harness();
    const duplicate = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['100', '100'], toBoardId: '1', toStackId: '11' } });
    expect((await duplicate.json()).error.code).toBe('DUPLICATE_IDS');

    const malformed = await agentFetch(base, '/agent/cards/move', { token, method: 'POST', body: { cardIds: ['../1'], toBoardId: '1', toStackId: '11' } });
    expect((await malformed.json()).error.code).toBe('INVALID_ID');
  });

  it('requires a JSON content type', async () => {
    const { base, token } = await harness();
    const res = await fetch(`${base}/agent/cards/move`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: 'cardIds=1' });
    expect(res.status).toBe(415);
  });
});

describe('agent card updates', () => {
  it('updates title, description and due date', async () => {
    const { base, token } = await harness();
    const res = await agentFetch(base, '/agent/cards/update', {
      token,
      method: 'POST',
      body: { updates: [{ boardId: '1', stackId: '10', cardId: '100', title: 'Renamed', duedate: '2026-09-01T10:00:00.000Z' }] },
    });

    expect(res.status).toBe(200);
    const updated = findCard(100).card;
    expect(updated.title).toBe('Renamed');
    expect(updated.duedate).toBe('2026-09-01T10:00:00.000Z');
  });

  it('clears a due date when null is sent', async () => {
    const { base, token } = await harness();
    await agentFetch(base, '/agent/cards/update', { token, method: 'POST', body: { updates: [{ boardId: '1', stackId: '10', cardId: '100', duedate: null }] } });
    expect(findCard(100).card.duedate).toBeNull();
  });

  it('rejects an update that changes nothing and an invalid date', async () => {
    const { base, token } = await harness();
    const empty = await agentFetch(base, '/agent/cards/update', { token, method: 'POST', body: { updates: [{ boardId: '1', stackId: '10', cardId: '100' }] } });
    expect((await empty.json()).error.code).toBe('EMPTY_UPDATE');

    const bad = await agentFetch(base, '/agent/cards/update', { token, method: 'POST', body: { updates: [{ boardId: '1', stackId: '10', cardId: '100', duedate: 'soon' }] } });
    expect((await bad.json()).error.code).toBe('INVALID_DATE');
  });
});

describe('agent inbox capture', () => {
  it('creates the managed inbox board on first capture and reuses it after', async () => {
    const { base, token } = await harness();
    const first = await (await agentFetch(base, '/agent/inbox/capture', { token, method: 'POST', body: { title: 'Idea' } })).json();
    expect(first.card.title).toBe('Idea');

    const inbox = state.boards.filter((board) => board.title.startsWith('[deckv2] Inbox'));
    expect(inbox).toHaveLength(1);

    await agentFetch(base, '/agent/inbox/capture', { token, method: 'POST', body: { title: 'Second' } });
    expect(state.boards.filter((board) => board.title.startsWith('[deckv2] Inbox'))).toHaveLength(1);
  });

  it('rejects an empty title', async () => {
    const { base, token } = await harness();
    const res = await agentFetch(base, '/agent/inbox/capture', { token, method: 'POST', body: { title: '  ' } });
    expect((await res.json()).error.code).toBe('INVALID_TEXT');
  });
});

describe('agent calendar routes', () => {
  const calendar = {
    status: async () => ({ enabled: true, connected: true }),
    planner: async (_user, range) => ({ events: [], range }),
    schedule: async (_user, entry) => ({ event: { id: 'evt-1' }, mapping: { entryKey: `card:${entry.boardId}:${entry.cardId}` } }),
    sync: async () => ({ created: [], updated: [] }),
    unlink: async () => ({ removed: true }),
    calendars: async () => [],
  };

  it('returns 503 when the calendar integration is absent', async () => {
    const { base, token } = await harness({ scopes: ['calendar:read'] });
    expect((await agentFetch(base, '/agent/calendar/status', { token })).status).toBe(503);
  });

  it('exposes status and planner to a calendar:read token', async () => {
    const { base, token } = await harness({ scopes: ['calendar:read'], calendarIntegration: calendar });
    expect((await (await agentFetch(base, '/agent/calendar/status', { token })).json()).connected).toBe(true);
    expect((await agentFetch(base, '/agent/calendar/planner?start=2026-08-01&end=2026-08-10', { token })).status).toBe(200);
  });

  it('requires calendar:write to schedule', async () => {
    const { base, token } = await harness({ scopes: ['calendar:read'], calendarIntegration: calendar });
    const res = await agentFetch(base, '/agent/calendar/schedule', { token, method: 'POST', body: { entry: { boardId: '1', stackId: '10', cardId: '100', title: 'x', dueAt: '2026-08-02' } } });
    expect((await res.json()).error.code).toBe('MISSING_SCOPE');
  });

  it('enforces the board scope when scheduling', async () => {
    const { base, token } = await harness({ scopes: ['calendar:write'], boardIds: ['1'], calendarIntegration: calendar });
    const res = await agentFetch(base, '/agent/calendar/schedule', { token, method: 'POST', body: { entry: { boardId: '2', stackId: '20', cardId: '200', title: 'x', dueAt: '2026-08-02' } } });
    expect((await res.json()).error.code).toBe('BOARD_OUT_OF_SCOPE');
  });

  it('enforces the board scope for every synced entry', async () => {
    const { base, token } = await harness({ scopes: ['calendar:write'], boardIds: ['1'], calendarIntegration: calendar });
    const res = await agentFetch(base, '/agent/calendar/sync', {
      token,
      method: 'POST',
      body: { entries: [{ boardId: '1', stackId: '10', cardId: '100', title: 'a' }, { boardId: '2', stackId: '20', cardId: '200', title: 'b' }] },
    });
    expect((await res.json()).error.code).toBe('BOARD_OUT_OF_SCOPE');
  });
});

describe('agent token administration', () => {
  async function adminHarness() {
    const ncUrl = await fakeNextcloud();
    const sessions = new SessionStore({ filePath: tempFile('sessions.json'), secret });
    const agentTokens = new AgentTokenStore({ filePath: tempFile('agent-tokens.json') });
    const sid = sessions.create('app-password', 'alice');
    const base = await listen(createApp({ ncUrl, sessions, nextcloud: { poll: async () => null }, agentTokens, audit: () => {} }));
    return { base, sid, agentTokens };
  }

  it('requires a session cookie', async () => {
    const { base } = await adminHarness();
    expect((await fetch(`${base}/auth/agent-tokens`)).status).toBe(401);
  });

  it('issues a token that immediately works against the agent API', async () => {
    const { base, sid } = await adminHarness();
    const created = await fetch(`${base}/auth/agent-tokens`, {
      method: 'POST',
      headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'my-cli', scopes: ['boards:read'] }),
    });
    expect(created.status).toBe(201);
    const { token, record } = await created.json();
    expect(record.scopes).toEqual(['boards:read']);
    expect((await agentFetch(base, '/agent/boards', { token })).status).toBe(200);
  });

  it('lists tokens without exposing secrets and revokes on request', async () => {
    const { base, sid } = await adminHarness();
    const { record } = await (await fetch(`${base}/auth/agent-tokens`, {
      method: 'POST',
      headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'temp', scopes: ['boards:read'] }),
    })).json();

    const listed = await (await fetch(`${base}/auth/agent-tokens`, { headers: { Cookie: `sid=${sid}` } })).json();
    expect(listed.tokens).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('hash');

    const revoked = await fetch(`${base}/auth/agent-tokens/${record.id}`, { method: 'DELETE', headers: { Cookie: `sid=${sid}` } });
    expect(revoked.status).toBe(200);
    expect((await (await fetch(`${base}/auth/agent-tokens`, { headers: { Cookie: `sid=${sid}` } })).json()).tokens).toEqual([]);
  });

  it('rejects an out-of-range expiry', async () => {
    const { base, sid } = await adminHarness();
    const res = await fetch(`${base}/auth/agent-tokens`, {
      method: 'POST',
      headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'x', scopes: ['boards:read'], expiresInDays: 4000 }),
    });
    expect((await res.json()).error.code).toBe('INVALID_TTL');
  });

  it('revokes every token of a session when that session logs out', async () => {
    const { base, sid } = await adminHarness();
    const { token } = await (await fetch(`${base}/auth/agent-tokens`, {
      method: 'POST',
      headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'x', scopes: ['boards:read'] }),
    })).json();

    await fetch(`${base}/auth/logout`, { method: 'POST', headers: { Cookie: `sid=${sid}` } });
    const res = await agentFetch(base, '/agent/boards', { token });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('INVALID_TOKEN');
  });
});
