import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckError } from './deck.js';
import { createCardDetailStore } from './detail.svelte.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function card(id, overrides = {}) {
  return {
    id,
    title: `Card ${id}`,
    boardId: 116,
    stackId: 9,
    type: 'plain',
    owner: 'alice',
    description: '',
    order: 65536,
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const cardPath = (boardId, stackId, cardId) => `/boards/${boardId}/stacks/${stackId}/cards/${cardId}`;

function readyClient(openCard = card(77)) {
  return {
    deck: vi.fn((path) => {
      if (path.includes('/attachments')) return Promise.resolve({ data: [] });
      if (path === cardPath(openCard.boardId, openCard.stackId, openCard.id)) return Promise.resolve({ data: openCard });
      return Promise.resolve({ data: openCard });
    }),
    ocs: vi.fn(() => Promise.resolve({ data: [] })),
  };
}

async function openReady(store, target = { boardId: 116, stackId: 9, cardId: 77 }) {
  await store.open(target);
  expect(store.state.loading).toBe(false);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('card detail store', () => {
  it('opens and loads card-local state without touching the board spinner', async () => {
    const c = readyClient(card(77, { title: 'Loaded detail' }));
    const synced = vi.fn();
    const detail = createCardDetailStore(c, { currentUser: 'alice', onCard: synced });

    const loading = detail.open({ boardId: 116, stackId: 9, cardId: 77 });

    expect(detail.state.loading).toBe(true);
    expect(detail.state.cardId).toBe(77);
    await loading;

    expect(detail.state.loading).toBe(false);
    expect(detail.state.error).toBeNull();
    expect(detail.state.card.title).toBe('Loaded detail');
    expect(detail.state.comments).toEqual([]);
    expect(detail.state.attachments).toEqual([]);
    expect(synced).toHaveBeenCalledWith(expect.objectContaining({ id: 77 }));
  });

  it('discards an older rapid-switch response and keeps only the newer card', async () => {
    const a = deferred();
    const b = deferred();
    const signals = [];
    const c = {
      deck: vi.fn((path, options = {}) => {
        if (path.includes('/attachments')) return Promise.resolve({ data: [] });
        signals.push(options.signal);
        if (path === cardPath(116, 9, 1)) return a.promise;
        if (path === cardPath(116, 10, 2)) return b.promise;
        return Promise.reject(new Error(`unexpected ${path}`));
      }),
      ocs: vi.fn(() => Promise.resolve({ data: [] })),
    };
    const detail = createCardDetailStore(c);

    const first = detail.open({ boardId: 116, stackId: 9, cardId: 1 });
    const second = detail.open({ boardId: 116, stackId: 10, cardId: 2 });
    b.resolve({ data: card(2, { title: 'Newer B', stackId: 10 }) });
    await second;
    a.resolve({ data: card(1, { title: 'Stale A' }) });
    await first;

    expect(signals[0].aborted).toBe(true);
    expect(detail.state.cardId).toBe(2);
    expect(detail.state.card.title).toBe('Newer B');
    expect(detail.state.loading).toBe(false);
  });

  it('serializes two core edits for one card and gives each save a fresh GET', async () => {
    const get1 = deferred();
    const put1 = deferred();
    const get2 = deferred();
    const put2 = deferred();
    const calls = [];
    const c = readyClient(card(77, { title: 'Initial' }));
    c.deck = vi.fn((path, options = {}) => {
      calls.push([path, options.method ?? 'GET']);
      if (path.includes('/attachments')) return Promise.resolve({ data: [] });
      if (path === cardPath(116, 9, 77) && calls.length === 1) return Promise.resolve({ data: card(77, { title: 'Initial' }) });
      if (path === cardPath(116, 9, 77) && calls.filter(([p]) => p === cardPath(116, 9, 77)).length === 2) return get1.promise;
      if (path === cardPath(116, 9, 77) && options.method === 'PUT') return calls.filter(([, m]) => m === 'PUT').length === 1 ? put1.promise : put2.promise;
      if (path === cardPath(116, 9, 77)) return get2.promise;
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const detail = createCardDetailStore(c);
    await openReady(detail);

    const first = detail.saveCore({ title: 'First' });
    const second = detail.saveCore({ description: 'Second' });
    await flush();

    expect(calls.map(([, method]) => method)).toEqual(['GET', 'GET', 'GET']);
    get1.resolve({ data: card(77, { title: 'Fresh 1' }) });
    await Promise.resolve();
    expect(calls.map(([, method]) => method)).toEqual(['GET', 'GET', 'GET', 'PUT']);
    expect(calls.filter(([, method]) => method === 'GET')).toHaveLength(3);

    put1.resolve({ data: card(77, { title: 'First' }) });
    await first;
    await flush();
    expect(calls.filter(([, method]) => method === 'GET')).toHaveLength(4);

    get2.resolve({ data: card(77, { title: 'First' }) });
    await Promise.resolve();
    put2.resolve({ data: card(77, { title: 'First', description: 'Second' }) });
    await second;

    expect(detail.state.card).toMatchObject({ title: 'First', description: 'Second' });
  });

  it('rolls back a failed core edit and keeps the recoverable draft', async () => {
    let cardReads = 0;
    const c = readyClient(card(77, { title: 'Prior title' }));
    c.deck = vi.fn((path, options = {}) => {
      if (path.includes('/attachments')) return Promise.resolve({ data: [] });
      if (path === cardPath(116, 9, 77) && options.method === 'PUT') {
        throw new DeckError(500, JSON.stringify({ message: 'write exploded' }), {
          method: options.method,
          path,
          contentType: 'application/json',
        });
      }
      if (path === cardPath(116, 9, 77)) {
        cardReads += 1;
        return Promise.resolve({ data: card(77, { title: cardReads === 1 ? 'Prior title' : 'Server before PUT' }) });
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    const detail = createCardDetailStore(c);
    await openReady(detail);

    await expect(detail.saveCore({ title: 'Draft title' })).rejects.toMatchObject({ status: 500 });

    expect(detail.state.card.title).toBe('Prior title');
    expect(detail.state.error).toBe('write exploded');
    expect(detail.state.dirty).toBe(true);
    expect(detail.state.draft).toMatchObject({ title: 'Draft title' });
  });

  it('blocks dirty close until the draft is saved or discarded', async () => {
    const detail = createCardDetailStore(readyClient());
    await openReady(detail);

    detail.editDraft({ description: 'unsaved' });

    expect(detail.requestClose()).toBe(false);
    expect(detail.state.cardId).toBe(77);
    expect(detail.state.closeBlocked).toBe(true);

    detail.discardDraft();
    expect(detail.requestClose()).toBe(true);
    expect(detail.state.cardId).toBeNull();
  });

  it('aborts in-flight detail requests on close', async () => {
    const pending = deferred();
    const signals = [];
    const c = {
      deck: vi.fn((path, options = {}) => {
        if (path.includes('/attachments')) return Promise.resolve({ data: [] });
        signals.push(options.signal);
        options.signal.addEventListener('abort', () => pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        return pending.promise;
      }),
      ocs: vi.fn(() => Promise.resolve({ data: [] })),
    };
    const detail = createCardDetailStore(c);

    const opening = detail.open({ boardId: 116, stackId: 9, cardId: 77 });
    expect(detail.state.loading).toBe(true);
    expect(detail.close()).toBe(true);
    await opening;

    expect(signals[0].aborted).toBe(true);
    expect(detail.state.loading).toBe(false);
    expect(detail.state.cardId).toBeNull();
  });
});
