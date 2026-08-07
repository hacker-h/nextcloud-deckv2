import { describe, it, expect, vi } from 'vitest';
import {
  INBOX_TITLE,
  INBOX_STACK_TITLE,
  isInboxBoard,
  withoutInbox,
  findInboxBoard,
  ensureInbox,
  readCollapsed,
  writeCollapsed,
} from './inbox.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
    data,
  };
}

function fakeClient({ stacks = [], createdBoard, createdStack } = {}) {
  const calls = [];
  return {
    calls,
    getStacks: vi.fn(async () => ({ data: stacks })),
    deck: vi.fn(async (path, options = {}) => {
      calls.push({ path, method: options.method ?? 'GET', body: options.body });
      if (path === '/boards') return { data: createdBoard };
      return { data: createdStack };
    }),
  };
}

describe('inbox board identity', () => {
  it('recognises the managed inbox board by its exact title', () => {
    expect(isInboxBoard({ title: INBOX_TITLE })).toBe(true);
    expect(isInboxBoard({ title: 'Inbox' })).toBe(false);
    expect(isInboxBoard(null)).toBe(false);
  });

  it('hides the inbox board from the switcher list', () => {
    const boards = [{ id: 1, title: 'Work' }, { id: 2, title: INBOX_TITLE }];
    expect(withoutInbox(boards)).toEqual([{ id: 1, title: 'Work' }]);
  });

  it('finds the inbox board among ordinary boards', () => {
    const inbox = { id: 2, title: INBOX_TITLE };
    expect(findInboxBoard([{ id: 1, title: 'Work' }, inbox])).toBe(inbox);
    expect(findInboxBoard([{ id: 1, title: 'Work' }])).toBeNull();
  });
});

describe('ensureInbox', () => {
  it('reuses an existing board and its existing stack without writing', async () => {
    const board = { id: 7, title: INBOX_TITLE };
    const stack = { id: 70, title: INBOX_STACK_TITLE, cards: [] };
    const client = fakeClient({ stacks: [stack] });

    const result = await ensureInbox(client, [board]);

    expect(result).toEqual({ board, stack });
    expect(client.deck).not.toHaveBeenCalled();
  });

  it('creates the board when none exists', async () => {
    const created = { id: 9, title: INBOX_TITLE };
    const client = fakeClient({ createdBoard: created, createdStack: { id: 90 } });

    const result = await ensureInbox(client, [{ id: 1, title: 'Work' }]);

    expect(result.board).toBe(created);
    const post = client.calls.find((c) => c.path === '/boards');
    expect(post.method).toBe('POST');
    expect(post.body.title).toBe(INBOX_TITLE);
  });

  it('creates the stack when the board exists but is empty', async () => {
    const board = { id: 7, title: INBOX_TITLE };
    const client = fakeClient({ stacks: [], createdStack: { id: 70, title: INBOX_STACK_TITLE } });

    const result = await ensureInbox(client, [board]);

    expect(result.stack.id).toBe(70);
    expect(result.stack.cards).toEqual([]);
    const post = client.calls.find((c) => c.path === '/boards/7/stacks');
    expect(post.method).toBe('POST');
    expect(post.body.title).toBe(INBOX_STACK_TITLE);
  });
});

describe('collapse persistence', () => {
  it('defaults to expanded', () => {
    expect(readCollapsed(memoryStorage())).toBe(false);
  });

  it('round-trips the collapsed flag', () => {
    const storage = memoryStorage();
    writeCollapsed(true, storage);
    expect(readCollapsed(storage)).toBe(true);
    writeCollapsed(false, storage);
    expect(readCollapsed(storage)).toBe(false);
  });

  it('survives a storage that throws', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readCollapsed(hostile)).toBe(false);
    expect(() => writeCollapsed(true, hostile)).not.toThrow();
  });
});
