import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckClient, DeckError } from './deck.js';
import { archiveCard, deleteCard, getCard, unarchiveCard, updateCard } from './cards.js';

function client() {
  return new DeckClient();
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
    ...init,
  });
}

function richCard() {
  return {
    id: 77,
    title: 'Preserve me',
    type: 'plain',
    owner: { uid: 'alice', displayName: 'Alice' },
    description: 'old description',
    order: 65536,
    duedate: '2026-08-01T12:00:00+00:00',
    done: false,
    archived: false,
    deletedAt: 0,
    labels: [{ id: 4, title: 'green' }],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('card API operations', () => {
  it('reads a card with an optional ETag', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(richCard(), { headers: { ETag: '"card-etag"' } }));

    await expect(getCard(client(), { boardId: 116, stackId: 9, cardId: 77, etag: '"old-etag"' })).resolves.toMatchObject({
      data: expect.objectContaining({ id: 77 }),
      etag: '"card-etag"',
    });

    expect(fetch.mock.calls[0][0]).toBe('/api/deck/boards/116/stacks/9/cards/77');
    expect(fetch.mock.calls[0][1].headers['If-None-Match']).toBe('"old-etag"');
  });

  it('preserves fresh server fields when editing only description', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(richCard(), { headers: { ETag: '"fresh"' } }))
      .mockResolvedValueOnce(json({ id: 77, description: 'new description' }));

    await updateCard(client(), {
      boardId: 116,
      stackId: 9,
      cardId: 77,
      changes: { description: 'new description' },
    });

    const body = JSON.parse(fetch.mock.calls[1][1].body);
    expect(body).toMatchObject({
      title: 'Preserve me',
      type: 'plain',
      owner: 'alice',
      description: 'new description',
      order: 65536,
      duedate: '2026-08-01T12:00:00+00:00',
      done: false,
      archived: false,
      labels: [{ id: 4, title: 'green' }],
    });
  });

  it('performs the fresh GET before the replacement PUT', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(richCard())).mockResolvedValueOnce(json(richCard()));

    await updateCard(client(), {
      boardId: 116,
      stackId: 9,
      cardId: 77,
      changes: { title: 'Fresh title' },
    });

    expect(fetch.mock.calls[0][0]).toBe(
      '/api/deck/boards/116/stacks/9/cards/77'
    );
    expect(fetch.mock.calls[0][1].method).toBe('GET');
    expect(fetch.mock.calls[1][0]).toBe(
      '/api/deck/boards/116/stacks/9/cards/77'
    );
    expect(fetch.mock.calls[1][1].method).toBe('PUT');
  });

  it('does not PUT when the fresh read fails', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'fresh read failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(
      updateCard(client(), {
        boardId: 116,
        stackId: 9,
        cardId: 77,
        changes: { description: 'must not write' },
      })
    ).rejects.toBeInstanceOf(DeckError);
    expect(fetch.mock.calls.filter(([, init]) => init.method === 'PUT')).toHaveLength(0);
  });

  it('normalizes owner objects to uid strings in replacement bodies', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(richCard())).mockResolvedValueOnce(json(richCard()));

    await updateCard(client(), {
      boardId: 116,
      stackId: 9,
      cardId: 77,
      changes: { owner: { uid: 'toni', displayName: 'Toni' } },
    });

    expect(JSON.parse(fetch.mock.calls[1][1].body).owner).toBe('toni');
  });

  it('archives, unarchives, and soft-deletes through the expected endpoints', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json({ id: 77 })));

    await archiveCard(client(), { boardId: 116, stackId: 9, cardId: 77 });
    await unarchiveCard(client(), { boardId: 116, stackId: 9, cardId: 77 });
    await deleteCard(client(), { boardId: 116, stackId: 9, cardId: 77 });

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/deck/boards/116/stacks/9/cards/77/archive', 'PUT'],
      ['/api/deck/boards/116/stacks/9/cards/77/unarchive', 'PUT'],
      ['/api/deck/boards/116/stacks/9/cards/77', 'DELETE'],
    ]);
  });

  it.each([
    ['archive', archiveCard],
    ['unarchive', unarchiveCard],
    ['delete', deleteCard],
  ])('surfaces typed %s failures', async (_name, operation) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(operation(client(), { boardId: 116, stackId: 9, cardId: 77 })).rejects.toMatchObject({
      name: 'DeckError',
      status: 403,
      message: 'denied',
    });
  });
});
