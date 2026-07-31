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

describe('board store card moves', () => {
  function movableStore(moveCard = vi.fn().mockResolvedValue({})) {
    const client = { getStacks: vi.fn(), moveCard };
    const store = createBoardStore(client);
    store.state.stacks = [
      {
        id: 9,
        title: 'Doing',
        cards: [
          { id: 10193, title: 'First', stackId: 9, order: 0, labels: [] },
          { id: 10194, title: 'Second', stackId: 9, order: 1, labels: [] },
        ],
      },
      { id: 10, title: 'Done', cards: [] },
    ];
    store.state.loading = false;
    return { store, moveCard };
  }

  const idsIn = (store, stackId) =>
    store.state.stacks.find((s) => s.id === stackId).cards.map((c) => c.id);

  it('moves a card into the target stack and persists the new order', async () => {
    const { store, moveCard } = movableStore();

    await store.moveCards({ cardIds: [10193], toStackId: 10, index: 0, boardId: 116 });

    expect(idsIn(store, 9)).toEqual([10194]);
    expect(idsIn(store, 10)).toEqual([10193]);
    expect(cardIn(store, 10, 10193).stackId).toBe(10);
    expect(moveCard).toHaveBeenCalledTimes(1);
    expect(moveCard.mock.calls[0][0]).toMatchObject({ toBoardId: 116, toStackId: 10 });
  });

  it('sends no request when a card is dropped back onto its own position', async () => {
    const { store, moveCard } = movableStore();

    await store.moveCards({ cardIds: [10193], toStackId: 9, index: 0, boardId: 116 });

    expect(moveCard).not.toHaveBeenCalled();
    expect(idsIn(store, 9)).toEqual([10193, 10194]);
  });

  it('restores stack membership and every mutated card field when a move fails', async () => {
    const { store } = movableStore(vi.fn().mockRejectedValue(new Error('boom')));
    // Card objects are shared with live state and their order/stackId are
    // mutated in place, so a rollback that only restores the arrays would leave
    // the card in the right slot carrying the wrong values.
    const moved = cardIn(store, 9, 10193);
    const before = { order: moved.order, stackId: moved.stackId };

    await store.moveCards({ cardIds: [10193], toStackId: 10, index: 0, boardId: 116 });

    expect(idsIn(store, 9)).toEqual([10193, 10194]);
    expect(idsIn(store, 10)).toEqual([]);
    expect(cardIn(store, 9, 10193).stackId).toBe(before.stackId);
    expect(cardIn(store, 9, 10193).order).toBe(before.order);
  });

  it('settles pending back to zero after a failed move', async () => {
    const { store } = movableStore(vi.fn().mockRejectedValue(new Error('boom')));

    await store.moveCards({ cardIds: [10193], toStackId: 10, index: 0, boardId: 116 });

    expect(store.state.pending).toBe(0);
  });
});
