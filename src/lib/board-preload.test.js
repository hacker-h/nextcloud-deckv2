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

  it('preloads in priority order and honors cancellation', async () => {
    const calls = [];
    let active = true;
    await preloadBoards({
      boards,
      activeId: 1,
      mru: ['3'],
      idle: async () => {},
      shouldContinue: () => active,
      concurrency: 1,
      preload: async (id) => {
        calls.push(id);
        if (id === 3) active = false;
      },
    });

    expect(calls).toEqual([3]);
  });

  it('starts the highest priority boards first when running in parallel', async () => {
    const started = [];
    await preloadBoards({
      boards,
      activeId: 1,
      mru: ['3'],
      idle: async () => {},
      shouldContinue: () => true,
      concurrency: 3,
      preload: async (id) => { started.push(id); },
    });

    expect(started).toEqual([3, 2, 4]);
  });

  it('never runs more preloads at once than the concurrency bound', async () => {
    const release = [];
    let inFlight = 0;
    let peak = 0;

    const run = preloadBoards({
      boards: Array.from({ length: 12 }, (_, id) => ({ id: id + 1, stacks: [] })),
      activeId: 0,
      idle: async () => {},
      shouldContinue: () => true,
      concurrency: 3,
      preload: () => new Promise((resolve) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        release.push(() => { inFlight -= 1; resolve([]); });
      }),
    });

    // Drain in waves so the pool has to refill rather than fan out at once.
    for (let i = 0; i < 12; i += 1) {
      await vi.waitFor(() => expect(release.length).toBeGreaterThan(i));
      release[i]();
    }
    await run;

    expect(peak).toBe(3);
  });

  it('reports progress from zero to the full queue length', async () => {
    const events = [];
    await preloadBoards({
      boards,
      activeId: 1,
      mru: ['3'],
      idle: async () => {},
      shouldContinue: () => true,
      concurrency: 1,
      preload: async (id) => (id === 4 ? null : []),
      onProgress: (event) => events.push(event),
    });

    expect(events).toEqual([
      { done: 0, total: 3 },
      { done: 1, total: 3, boardId: 3, status: 'loaded' },
      { done: 2, total: 3, boardId: 2, status: 'loaded' },
      { done: 3, total: 3, boardId: 4, status: 'failed' },
    ]);
  });

  it('reports no progress when every board is already active', async () => {
    const onProgress = vi.fn();
    await preloadBoards({
      boards: [{ id: 1 }],
      activeId: 1,
      idle: async () => {},
      shouldContinue: () => true,
      preload: vi.fn(),
      onProgress,
    });

    expect(onProgress).not.toHaveBeenCalled();
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
