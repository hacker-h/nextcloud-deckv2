import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckClient } from './deck.js';
import {
  DECK_FILE,
  deleteAttachment,
  downloadAttachment,
  listAttachments,
  restoreAttachment,
  updateAttachment,
  uploadAttachment,
} from './attachments.js';

const CARD = 10193;
const BASE = 'https://nextcloud-alice.example/index.php/apps/deck/api/v1.0/cards/10193/attachments';

function client() {
  return new DeckClient({ baseUrl: 'https://nextcloud-alice.example', username: 'alice', password: 'app-password' });
}

function json(data, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function serverAttachment(overrides = {}) {
  return {
    id: 88,
    cardId: CARD,
    type: DECK_FILE,
    data: 'detail-test.txt',
    createdBy: 'alice',
    deletedAt: 0,
    extendedData: {
      filesize: 17,
      mimetype: 'text/plain',
      info: { filename: 'detail-test', extension: 'txt' },
    },
    ...overrides,
  };
}

function textFile(name = 'detail-test.txt', content = 'card detail QA\n') {
  return new File([content], name, { type: 'text/plain' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('attachment operations', () => {
  it('uploads a text file as multipart and retains name, type, and size', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(serverAttachment()));

    const uploaded = await uploadAttachment(client(), CARD, textFile());

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(BASE);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.body.get('type')).toBe(DECK_FILE);
    expect(init.body.get('file').name).toBe('detail-test.txt');
    // The transport must not set Content-Type so the browser can add the boundary.
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(url).not.toMatch(/Basic |password|Authorization/);

    expect(uploaded).toMatchObject({
      id: 88,
      name: 'detail-test.txt',
      mimetype: 'text/plain',
      size: 17,
      type: DECK_FILE,
    });
  });

  it('uploads a zero-byte file without special casing', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(json(serverAttachment({ extendedData: { filesize: 0, mimetype: 'text/plain', info: { filename: 'empty', extension: 'txt' } } })));

    await expect(uploadAttachment(client(), CARD, textFile('empty.txt', ''))).resolves.toMatchObject({
      name: 'empty.txt',
      size: 0,
    });
    expect(fetch.mock.calls[0][1].body.get('file').size).toBe(0);
  });

  it('reports an oversized upload as a typed error and leaves the list untouched', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json([serverAttachment()]))
      .mockResolvedValueOnce(json({ message: 'file is too big' }, 413))
      .mockResolvedValueOnce(json([serverAttachment()]));
    const c = client();

    const before = await listAttachments(c, CARD);
    await expect(uploadAttachment(c, CARD, textFile('huge.bin'))).rejects.toMatchObject({
      name: 'DeckError',
      status: 413,
      message: 'file is too big',
    });

    await expect(listAttachments(c, CARD)).resolves.toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports a duplicate name conflict and a server failure as typed errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ message: 'File already exists' }, 409))
      .mockResolvedValueOnce(json({ message: 'boom' }, 500));
    const c = client();

    await expect(uploadAttachment(c, CARD, textFile())).rejects.toMatchObject({ status: 409 });
    await expect(uploadAttachment(c, CARD, textFile())).rejects.toMatchObject({ status: 500 });
  });

  it('maps a cancelled upload to an abort error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const controller = new AbortController();
    controller.abort();

    await expect(
      uploadAttachment(client(), CARD, textFile(), { signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('renames, deletes, and restores through the expected endpoints', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(json(serverAttachment())));
    const c = client();

    await updateAttachment(c, CARD, 88, textFile('detail-renamed.txt'));
    await deleteAttachment(c, CARD, 88);
    await restoreAttachment(c, CARD, 88);

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      [`${BASE}/88`, 'PUT'],
      [`${BASE}/88`, 'DELETE'],
      [`${BASE}/88/restore`, 'PUT'],
    ]);
  });

  it('downloads through the authenticated transport with no credentials in the URL', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('card detail QA\n', { status: 200, headers: { 'Content-Type': 'text/plain' } }));

    const blob = await downloadAttachment(client(), CARD, 88);

    expect(blob).toBeInstanceOf(Blob);
    expect(fetch.mock.calls[0][0]).toBe(`${BASE}/88`);
    expect(fetch.mock.calls[0][0]).not.toContain('app-password');
    expect(fetch.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
  });
});
