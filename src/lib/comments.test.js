import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckClient, DeckError } from './deck.js';
import { createComment, deleteComment, listComments, updateComment } from './comments.js';

const CARD = 10193;
const OCS_BASE = '/api/ocs/apps/deck/api/v1.0/cards/10193/comments';

function client() {
  return new DeckClient();
}

function ocs(data, status = 200) {
  return new Response(JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: status }, data } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function comment(overrides = {}) {
  return {
    id: 501,
    message: 'Card detail QA',
    actorId: 'alice',
    actorDisplayName: 'Alice',
    creationDateTime: '2026-01-05T10:00:00+00:00',
    parentId: null,
    mentions: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OCS comment operations', () => {
  it('sends the OCS marker and returns an empty list unchanged', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ocs([]));

    await expect(listComments(client(), CARD, 'alice')).resolves.toEqual([]);

    expect(fetch.mock.calls[0][0]).toBe(OCS_BASE);
    expect(fetch.mock.calls[0][1].headers['OCS-APIRequest']).toBe('true');
  });

  it('unwraps the ocs envelope exactly once', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ocs([comment()]));

    const [first] = await listComments(client(), CARD, 'alice');

    expect(first).toMatchObject({ id: 501, message: 'Card detail QA', actorId: 'alice' });
    expect(first).not.toHaveProperty('ocs');
  });

  it('creates a comment and a threaded reply', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ocs(comment()))
      .mockResolvedValueOnce(ocs(comment({ id: 502, message: 'Acknowledged', parentId: 501 })));
    const c = client();

    const created = await createComment(c, CARD, 'Card detail QA', { currentUser: 'alice' });
    const reply = await createComment(c, CARD, 'Acknowledged', { parentId: 501, currentUser: 'alice' });

    expect(created).toMatchObject({ id: 501, actorDisplayName: 'Alice', creationDateTime: '2026-01-05T10:00:00+00:00' });
    expect(reply).toMatchObject({ id: 502, parentId: 501 });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ message: 'Card detail QA' });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ message: 'Acknowledged', parentId: 501 });
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(['POST', 'POST']);
  });

  it('edits and deletes the current user own comment', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(ocs(comment({ message: 'Card detail QA updated' })))
      .mockResolvedValueOnce(ocs(null, 200));
    const c = client();
    const own = { ...comment(), canEdit: true };

    await expect(updateComment(c, CARD, own, 'Card detail QA updated', 'alice')).resolves.toMatchObject({
      message: 'Card detail QA updated',
      canEdit: true,
    });
    await expect(deleteComment(c, CARD, own, 'alice')).resolves.toBe(501);

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${OCS_BASE}/501`, 'PUT'],
      [`${OCS_BASE}/501`, 'DELETE'],
    ]);
  });

  it('marks a foreign comment as non-editable and dispatches no write', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(ocs([comment({ actorId: 'antonia' })]));

    const [foreign] = await listComments(client(), CARD, 'alice');
    expect(foreign.canEdit).toBe(false);

    await expect(updateComment(client(), CARD, foreign, 'hijacked', 'alice')).rejects.toThrow(/antonia/);
    await expect(deleteComment(client(), CARD, foreign, 'alice')).rejects.toThrow(/antonia/);

    expect(fetch.mock.calls.filter(([, init]) => init.method !== 'GET')).toHaveLength(0);
  });

  it('surfaces typed OCS failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ocs: { meta: { message: 'not permitted' } } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    await expect(createComment(client(), CARD, 'nope', { currentUser: 'alice' })).rejects.toMatchObject({
      name: 'DeckError',
      status: 403,
      message: 'not permitted',
    });
    await expect(listComments(client(), CARD, 'alice')).rejects.toBeInstanceOf(DeckError);
  });
});
