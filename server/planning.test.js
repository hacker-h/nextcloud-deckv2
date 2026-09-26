import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanningStore, handlePlanning } from './planning.js';
import { period, normalizePlan, monthWeeks, suggestTime } from '../shared/planning.js';

it('normalizes date-only periods across month/year and DST boundaries', () => {
  expect(period('week', '2027-01-01')).toEqual({ granularity: 'week', start: '2026-12-28', end: '2027-01-04' });
  expect(period('month', '2028-02-29').end).toBe('2028-03-01');
  expect(period('day', '2026-03-29').end).toBe('2026-03-30');
  expect(monthWeeks('2026-09-26')[0][0]).toBe('2026-08-31');
  expect(() => normalizePlan({ granularity: 'day', start: '2026-02-31' })).toThrow();
  expect(() => normalizePlan({ granularity: 'week', start: '2026-09-26', time: '09:00' })).toThrow();
  expect(() => normalizePlan({ granularity: 'day', start: '2026-09-26', time: '25:00' })).toThrow();
});
it('suggests an unoccupied 30 minute slot', () => {
  expect(suggestTime('2026-09-26', [{ start: '2026-09-26T09:00:00', end: '2026-09-26T10:15:00' }])).toBe('10:15');
});
it('persists per-user plans atomically and rejects stale revisions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'deck-planning-'));
  try {
    const file = join(dir, 'plans.json'); const store = new PlanningStore(file);
    const saved = store.put('alice', 7, { granularity: 'month', start: '2026-09-26' }, null);
    expect(new PlanningStore(file).get('alice', 7)).toEqual(saved);
    expect(store.get('bob', 7).plan).toBeNull();
    expect(() => store.put('alice', 7, null, null)).toThrow('inzwischen');
    expect(store.put('alice', 7, null, saved.revision).plan).toBeNull();
  } finally { rmSync(dir, { recursive: true }); }
});
describe('planning authorization', () => {
  async function request({ method = 'PUT', writable = true, cardId = 7, body = { plan: { granularity: 'day', start: '2026-09-26' }, revision: null } } = {}) {
    let status; let response;
    const req = { method, headers: { 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
    const res = { writeHead: (code) => status = code, end: (raw) => response = JSON.parse(raw) };
    const deck = { boards: async () => [{ id: 1, permissions: { PERMISSION_EDIT: writable } }], stacks: async () => [{ cards: [{ id: 7 }] }] };
    const store = { get: () => ({ plan: null, revision: null }), put: () => ({ ok: true }) };
    await handlePlanning({ req, res, url: new URL(`http://test/planning/boards/1${method === 'GET' ? '' : `/cards/${cardId}`}`), user: 'alice', deck, store });
    return { status, response };
  }
  it('allows reading, rejects readonly writes and cards from another board', async () => {
    expect((await request({ method: 'GET', writable: false })).status).toBe(200);
    expect((await request({ writable: false })).status).toBe(403);
    expect((await request({ cardId: 99 })).status).toBe(404);
    expect((await request()).status).toBe(200);
    expect((await request({ body: { plan: {} } })).status).toBe(400);
  });
});

it('protects planning routes with session and origin checks', async () => {
  const { createApp } = await import('./app.js');
  const { SessionStore } = await import('./sessions.js');
  const { createServer } = await import('node:http');
  const dir = mkdtempSync(join(tmpdir(), 'deck-planning-auth-'));
  const sessions = new SessionStore({ filePath: join(dir, 'sessions.json'), secret: Buffer.alloc(32, 2) });
  const app = createApp({ ncUrl: 'https://unused.test', sessions });
  const server = createServer(app);
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/planning/boards/1`);
    expect(response.status).toBe(401);
    const session = sessions.create('test-only', 'alice');
    const denied = await fetch(`${base}/planning/boards/1/cards/7`, { method: 'PUT', headers: { Cookie: `sid=${session}`, Origin: 'https://evil.test', 'Content-Type': 'application/json' }, body: '{}' });
    expect(denied.status).toBe(403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true });
  }
});
