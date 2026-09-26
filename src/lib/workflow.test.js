import { describe, expect, it, vi } from 'vitest';
import { createBoardStore } from './store.svelte.js';
import { createMoveHistory } from './move-history.svelte.js';
import { matchesCard } from './card-search.js';
import { preloadBoards } from './board-preload.js';
import { createPreferences } from './preferences.svelte.js';
import { DeckClient } from './deck.js';

const initial = () => [{ id: 1, title: 'Todo', cards: [{ id: 7, stackId: 1, title: 'Test', order: 0, done: null, duedate: '2020-01-01T00:00:00Z' }] }, { id: 2, title: 'Done', cards: [] }];
async function setup(enabled = true) {
  const client = { getStacks: vi.fn().mockResolvedValue({ data: initial() }), moveCard: vi.fn().mockImplementation(async ({ card }) => ({ ...card })) };
  const store = createBoardStore(client, { autoCompleteDone: () => enabled });
  await store.load(1);
  return { store, client };
}
const move = (store) => store.moveCards({ cardIds: [7], toStackId: 2, index: 0, boardId: 1 });
describe('Done and options', () => {
  it('defaults on, persists per user and keeps timing and deadline prompts off', () => {
    const values = new Map();
    vi.stubGlobal('localStorage', { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) });
    const prefs = createPreferences('alice');
    expect(prefs.state).toMatchObject({ autoCompleteDone: true, timedPlanning: false, askDeadline: false });
    prefs.set('autoCompleteDone', false);
    expect(createPreferences('alice').state.autoCompleteDone).toBe(false);
    expect(createPreferences('bob').state.autoCompleteDone).toBe(true);
    vi.unstubAllGlobals();
  });
  it('completes on entry, preserves due date and does not reopen on exit', async () => {
    const { store, client } = await setup(); await move(store);
    expect(client.moveCard.mock.calls[0][0].card.done).toMatch(/^\d{4}-/);
    expect(store.state.stacks[1].cards[0].duedate).toBe('2020-01-01T00:00:00Z');
    const done = store.state.stacks[1].cards[0].done;
    await store.moveCards({ cardIds: [7], toStackId: 1, index: 0, boardId: 1 });
    expect(store.state.stacks[0].cards[0].done).toBe(done);
  });
  it('respects opt-out', async () => {
    const { store, client } = await setup(false); await move(store);
    expect(client.moveCard.mock.calls[0][0].card.done).toBeNull();
  });
  it('rolls back completion on failure without corrupting another board', async () => {
    const { store, client } = await setup();
    let reject; client.moveCard.mockImplementation(() => new Promise((_, fail) => reject = fail));
    const moving = move(store);
    client.getStacks.mockResolvedValue({ data: [{ id: 50, cards: [] }] }); await store.load(5);
    reject(new Error('offline')); await moving;
    expect(store.state.stacks[0].id).toBe(50);
    client.getStacks.mockImplementation(() => new Promise(() => {}));
    void store.load(1);
    expect(store.state.stacks[0].cards[0].done).toBeNull();
  });
  it('sends completion with the real Deck move payload and reports failed writes', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
    const onWrite = vi.fn(); const client = new DeckClient({ onWrite });
    await client.moveCard({ card: { id: 7, title: 'x', done: '2026-09-26T10:00:00Z' }, toBoardId: 1, toStackId: 2, order: 0 });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).done).toBe('2026-09-26T10:00:00Z');
    expect(onWrite.mock.calls.at(-1)[0]).toEqual({ pending: 0, failed: 0, saved: true });
    fetcher.mockRejectedValue(new Error('offline'));
    await expect(client.deck('/test', { method: 'PUT', body: {} })).rejects.toThrow('offline');
    expect(onWrite.mock.calls.at(-1)[0].failed).toBe(1);
    fetcher.mockRestore();
  });
});
it('does not announce cached preloads as loading', async () => {
  const onProgress = vi.fn(); const preload = vi.fn();
  await preloadBoards({ boards: [{ id: 1 }, { id: 2 }], activeId: 1, isCached: () => true, idle: async () => {}, shouldContinue: () => true, preload, onProgress });
  expect(preload).not.toHaveBeenCalled(); expect(onProgress).not.toHaveBeenCalled();
});
it('searches text and labels, only matches assigned tasks and honors completion', () => {
  const card = { title: 'Rechnung', description: 'April', labels: [{ title: 'Finanzen' }], assignedUsers: [{ participant: { uid: 'alice' }, type: 0 }] };
  expect(matchesCard(card, { query: 'april finanzen', mine: true, user: 'alice' })).toBe(true);
  expect(matchesCard(card, { mine: true, user: 'bob' })).toBe(false);
  expect(matchesCard({ ...card, done: '2026-01-01' }, { openOnly: true })).toBe(false);
});
describe('move undo', () => {
  it('keeps freshly edited descriptions and restores old completion', async () => {
    const card = { id: 7, stackId: 2, order: 65536, done: '2026-01-01T00:00:00Z', description: 'new description' };
    const client = { getStacks: vi.fn().mockResolvedValue({ data: [{ id: 2, cards: [card] }] }), moveCard: vi.fn().mockResolvedValue({}) };
    const history = createMoveHistory(client, vi.fn());
    history.record(1, new Map([[7, { stackId: 1, order: 0, done: null }]]), [card]);
    await history.undo();
    expect(client.moveCard.mock.calls[0][0].card).toMatchObject({ stackId: 1, order: 0, done: null, description: 'new description' });
    expect(history.state.entries).toHaveLength(0);
  });
  it('refuses to overwrite a subsequent remote move', async () => {
    const card = { id: 7, stackId: 2, order: 10, done: null };
    const client = { getStacks: vi.fn().mockResolvedValue({ data: [{ id: 3, cards: [card] }] }), moveCard: vi.fn() };
    const history = createMoveHistory(client, vi.fn());
    history.record(1, new Map([[7, { stackId: 1, order: 0 }]]), [card]); await history.undo();
    expect(client.moveCard).not.toHaveBeenCalled(); expect(history.state.error).toContain('inzwischen');
  });
});
