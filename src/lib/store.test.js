import { describe, expect, it, vi } from 'vitest';
import { createBoardStore } from './store.svelte.js';

function boardStore() {
  const client = { getStacks: vi.fn() };
  const store = createBoardStore(client);
  store.state.stacks = [
    {
      id: 9,
      title: 'Doing',
      cards: [
        { id: 10193, title: 'Card detail QA', stackId: 9, order: 0, labels: [], commentsCount: 0, attachmentCount: 0 },
        { id: 10194, title: 'Second', stackId: 9, order: 1, labels: [] },
      ],
    },
    { id: 10, title: 'Done', cards: [] },
  ];
  store.state.loading = false;
  return store;
}

const cardIn = (store, stackId, id) =>
  store.state.stacks.find((s) => s.id === stackId).cards.find((c) => c.id === id);

describe('board store card reconciliation', () => {
  it('patches every tile-visible field in place', () => {
    const store = boardStore();

    store.replaceCard({
      id: 10193,
      title: 'Renamed',
      stackId: 9,
      duedate: '2030-01-01T10:00:00Z',
      labels: [{ id: 1, title: 'Bug', color: 'ff0000' }],
      commentsCount: 3,
      attachmentCount: 2,
    });

    const card = cardIn(store, 9, 10193);
    expect(card.title).toBe('Renamed');
    expect(card.duedate).toBe('2030-01-01T10:00:00Z');
    expect(card.labels).toHaveLength(1);
    expect(card.commentsCount).toBe(3);
    expect(card.attachmentCount).toBe(2);
  });

  it('never reloads all stacks to apply a patch', () => {
    const store = boardStore();
    const before = store.state.stacks;

    store.replaceCard({ id: 10193, title: 'Renamed', stackId: 9 });

    expect(store.state.stacks).toBe(before);
    expect(store.state.loading).toBe(false);
  });

  it('keeps stack and order even when the detail response disagrees', () => {
    const store = boardStore();

    store.replaceCard({ id: 10193, title: 'Renamed', stackId: 10, order: 999 });

    expect(cardIn(store, 9, 10193)).toBeDefined();
    expect(cardIn(store, 9, 10193).stackId).toBe(9);
    expect(cardIn(store, 9, 10193).order).toBe(0);
    expect(store.state.stacks.find((s) => s.id === 10).cards).toHaveLength(0);
  });

  it('preserves sibling position when patching', () => {
    const store = boardStore();

    store.replaceCard({ id: 10193, title: 'Renamed', stackId: 9 });

    expect(store.state.stacks[0].cards.map((c) => c.id)).toEqual([10193, 10194]);
  });

  it('ignores an unknown card and a null payload', () => {
    const store = boardStore();

    expect(store.replaceCard({ id: 999999, title: 'Ghost' })).toBeNull();
    expect(store.replaceCard(null)).toBeNull();
    expect(store.state.stacks[0].cards).toHaveLength(2);
  });

  it('applies rapid successive saves last-write-wins', () => {
    const store = boardStore();

    store.replaceCard({ id: 10193, title: 'First', stackId: 9 });
    store.replaceCard({ id: 10193, title: 'Second', stackId: 9 });
    store.replaceCard({ id: 10193, title: 'Third', stackId: 9 });

    expect(cardIn(store, 9, 10193).title).toBe('Third');
    expect(store.state.stacks[0].cards).toHaveLength(2);
  });

  it('removes a card for archive and delete', () => {
    const store = boardStore();

    const removed = store.removeCard(10193);

    expect(removed.id).toBe(10193);
    expect(store.state.stacks[0].cards.map((c) => c.id)).toEqual([10194]);
  });

  it('cannot resurrect a removed card with a late response', () => {
    const store = boardStore();
    store.removeCard(10193);

    const result = store.replaceCard({ id: 10193, title: 'Stale title', stackId: 9 });

    expect(result).toBeNull();
    expect(store.state.stacks[0].cards.map((c) => c.id)).toEqual([10194]);
  });

  it('ignores removal of an unknown card', () => {
    const store = boardStore();

    expect(store.removeCard(999999)).toBeNull();
    expect(store.state.stacks[0].cards).toHaveLength(2);
  });
});
