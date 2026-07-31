import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckClient } from './deck.js';
import {
  GROUP_TYPE,
  USER_TYPE,
  assignLabel,
  assignUser,
  getBoardAssignmentOptions,
  removeLabel,
  unassignUser,
} from './assignments.js';

const TARGET = { boardId: 116, stackId: 366, cardId: 10193 };
const BASE = 'https://nextcloud-alice.example/index.php/apps/deck/api/v1.0';

function client() {
  return new DeckClient({ baseUrl: 'https://nextcloud-alice.example', username: 'alice', password: 'app-password' });
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function error(status, message) {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function calls(fetch) {
  return fetch.mock.calls.map(([url, init]) => [url, init.method, init.body ? JSON.parse(init.body) : undefined]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('label and assignee operations', () => {
  it('lists board labels and eligible participants from one board read', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        id: 116,
        labels: [{ id: 42, title: 'urgent', color: 'ff0000', boardId: 116 }],
        acl: [{ type: USER_TYPE, participant: { uid: 'antonia', displayName: 'Antonia' } }],
      })
    );

    const { data } = await getBoardAssignmentOptions(client(), 116);

    expect(data.labels).toEqual([{ id: 42, title: 'urgent', color: 'ff0000', boardId: 116 }]);
    expect(data.participants).toEqual([{ id: 'antonia', displayName: 'Antonia', type: USER_TYPE }]);
  });

  it('assigns then removes a label and a user with the exact endpoint sequence', async () => {
    const card = { id: 10193, title: 'Detail QA' };
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json(card)));
    const c = client();

    await expect(assignLabel(c, TARGET, 42)).resolves.toEqual({ ok: true, card });
    await expect(assignUser(c, TARGET, 'antonia')).resolves.toEqual({ ok: true, card });
    await expect(removeLabel(c, TARGET, 42)).resolves.toEqual({ ok: true, card });
    await expect(unassignUser(c, TARGET, 'antonia')).resolves.toEqual({ ok: true, card });

    expect(calls(fetch)).toEqual([
      [`${BASE}/boards/116/stacks/366/cards/10193/assignLabel`, 'PUT', { labelId: 42 }],
      [`${BASE}/boards/116/stacks/366/cards/10193/assignUser`, 'PUT', { userId: 'antonia', type: USER_TYPE }],
      [`${BASE}/boards/116/stacks/366/cards/10193/removeLabel`, 'PUT', { labelId: 42 }],
      [`${BASE}/boards/116/stacks/366/cards/10193/unassignUser`, 'PUT', { userId: 'antonia', type: USER_TYPE }],
    ]);
  });

  it('preserves the participant type for group assignment', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json({ id: 10193 })));

    await assignUser(client(), TARGET, 'developers', GROUP_TYPE);
    await unassignUser(client(), TARGET, 'developers', GROUP_TYPE);

    expect(calls(fetch).map(([, , body]) => body)).toEqual([
      { userId: 'developers', type: GROUP_TYPE },
      { userId: 'developers', type: GROUP_TYPE },
    ]);
  });

  it('reports a non-member assignee as a readable error without local residue', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(error(400, 'The user is not part of the board'));

    await expect(assignUser(client(), TARGET, 'not-a-member')).resolves.toEqual({
      ok: false,
      code: 'not-a-member',
      message: 'The user is not part of the board',
      status: 400,
    });
  });

  it('treats a repeated assignment as an idempotent non-fatal outcome', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(error(400, 'Label is already assigned to the card'));

    await expect(assignLabel(client(), TARGET, 42)).resolves.toMatchObject({
      ok: true,
      duplicate: true,
      code: 'duplicate',
    });
  });

  it('surfaces other failures as typed errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(error(403, 'denied'));

    await expect(removeLabel(client(), TARGET, 42)).resolves.toEqual({
      ok: false,
      code: 'error',
      message: 'denied',
      status: 403,
    });
  });
});
