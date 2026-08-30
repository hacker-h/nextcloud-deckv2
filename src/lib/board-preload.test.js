import { describe, expect, it, vi } from 'vitest';
import { boardPreloadOrder, preloadBoards } from './board-preload.js';

describe('board preload ordering', () => {
  const boards = [
    { id: 1, stacks: [{}, {}, {}] },
    { id: 2, stacks: [{}] },
    { id: 3, stacks: [{}, {}] },
    { id: 4 },
  ];

  it('skips the active board, then prefers MRU boards before small boards', () => {
    expect(boardPreloadOrder(boards, 1, ['3']).map((board) => board.id)).toEqual([3, 2, 4]);
  });

  it('sorts untouched boards from fewest known stacks to largest', () => {
    expect(boardPreloadOrder(boards, 99).map((board) => board.id)).toEqual([2, 3, 1, 4]);
  });

  it('preloads sequentially in priority order and honors cancellation', async () => {
    const calls = [];
    let active = true;
    await preloadBoards({
      boards,
      activeId: 1,
      mru: ['3'],
      idle: async () => {},
      shouldContinue: () => active,
      preload: async (id) => {
        calls.push(id);
        if (id === 3) active = false;
      },
    });

    expect(calls).toEqual([3]);
  });

  it('bounds background fan-out to the cache capacity', async () => {
    const preload = vi.fn();
    await preloadBoards({
      boards: Array.from({ length: 60 }, (_, id) => ({ id, stacks: [] })),
      activeId: 0,
      idle: async () => {},
      shouldContinue: () => true,
      preload,
    });

    expect(preload).toHaveBeenCalledTimes(50);
  });
});
