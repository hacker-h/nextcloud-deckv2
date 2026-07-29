// Deck API client.
//
// Every rule here was verified against the live server during the M0 spike.
// See .sisyphus/M0-RESULTS.md. Deck's API has traps that look like success
// while doing nothing, so these notes are the only documentation that exists.

const API = '/index.php/apps/deck/api/v1.0';

export class DeckError extends Error {
  constructor(status, body) {
    let msg = `Deck API error ${status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) msg = parsed.message;
    } catch {
      // body was not JSON; keep the generic message
    }
    super(msg);
    this.name = 'DeckError';
    this.status = status;
  }
}

const isLive = (x) => !x.archived && Number(x.deletedAt ?? 0) === 0;
// Boards shared with us read-only. Every mutation against them returns 403, so
// offering them as a drag target or in the switcher only produces errors
// (verified: board 109 "Antonia Aufgaben", owned by another user).
const canEdit = (b) => Boolean((b.permissions ?? {}).PERMISSION_EDIT);
const byOrder = (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0);

export class DeckClient {
  #auth;
  #base;

  constructor({ baseUrl, username, password }) {
    this.#base = String(baseUrl).replace(/\/$/, '');
    this.#auth = 'Basic ' + btoa(`${username}:${password}`);
  }

  async #get(path, etag) {
    // M0.1: only Authorization + Accept may be sent. `OCS-APIRequest` is NOT in
    // access-control-allow-headers, so sending it fails CORS preflight. Verified
    // unnecessary: GET /boards without it returns 200 and valid JSON.
    const headers = { Authorization: this.#auth, Accept: 'application/json' };

    // M0.4: If-Modified-Since returns HTTP 500 here (Nextcloud's
    // Util::parseHTTPDate rejects the standard header format). ETags only.
    if (etag) headers['If-None-Match'] = etag;

    const res = await fetch(this.#base + API + path, { headers });

    // 304 has no body - must return before attempting to parse JSON.
    if (res.status === 304) return { notModified: true, etag };
    if (!res.ok) throw new DeckError(res.status, await res.text().catch(() => ''));

    return { data: await res.json(), etag: res.headers.get('ETag') };
  }

  async getBoards(etag) {
    const r = await this.#get('/boards', etag);
    if (r.notModified) return r;
    return { ...r, data: r.data.filter((b) => isLive(b) && canEdit(b)) };
  }

  // Returns stacks sorted by `order`, each with its cards sorted by `order`.
  //
  // M1: the API returns these in ARBITRARY order. Verified on board 113, where
  // the raw response starts with order=5 ("Doing") and returns order=0 ("Inbox")
  // second. Rendering the response as-is scrambles the board.
  //
  // NOTE: this endpoint sends NO ETag. StackApiController::index() never calls
  // setETag() - only the single-stack get() does, and GET /boards does. So the
  // `etag` argument is accepted for symmetry but the server will always answer
  // 200. Cheap change-detection therefore has to be driven from /boards
  // (whose ETag covers board lastModified), not from this endpoint.
  async getStacks(boardId, etag) {
    const r = await this.#get(`/boards/${boardId}/stacks`, etag);
    if (r.notModified) return r;

    const stacks = r.data
      .filter((s) => Number(s.deletedAt ?? 0) === 0)
      .slice()
      .sort(byOrder)
      .map((s) => ({
        ...s,
        cards: (s.cards ?? []).filter(isLive).slice().sort(byOrder),
      }));

    return { ...r, data: stacks };
  }

  // Move / reorder a card.
  //
  // M0.2 THE TRAP: `stackId` comes from the URL PATH, not the body.
  // CardApiController::update() reads it via request->getParam(), and the path
  // parameter wins. Sending the target stack only in the body returns HTTP 200
  // with the card UNMOVED - a silent no-op that looks like success.
  //
  // M0.2/M0.3: this endpoint (not /cards/{id}/reorder) is the right one. It is
  // ~5x faster (1.2s vs 6.5s on a 40-card stack, because reorder() rewrites
  // every card in the stack), it is the only CORS-enabled path, and it rebinds
  // labels correctly on cross-board moves.
  //
  // Read-modify-write is mandatory: update() overwrites title/type/owner/
  // description, so current values must be resent or they are destroyed.
  async moveCard({ card, toBoardId, toStackId, order }) {
    const body = {
      title: card.title,
      type: card.type ?? 'plain',
      owner: typeof card.owner === 'object' ? card.owner.uid : card.owner,
      description: card.description ?? '',
      order,
    };
    if (card.duedate) body.duedate = card.duedate;

    const res = await fetch(
      `${this.#base}${API}/boards/${toBoardId}/stacks/${toStackId}/cards/${card.id}`,
      {
        method: 'PUT',
        headers: {
          Authorization: this.#auth,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new DeckError(res.status, await res.text().catch(() => ''));
    return res.json();
  }

  // Deep-link into Deck's own UI for anything out of scope (PLAN.md §2.3).
  cardUrl(boardId, cardId) {
    return `${this.#base}/index.php/apps/deck/board/${boardId}/card/${cardId}`;
  }
}

// Sparse ordering (M0.4). Deck's update() does NOT reindex the target stack -
// it writes exactly the `order` given. That is what makes it fast, but it means
// ordering is the client's job. Measured: six parallel moves all sending
// order:0 produced six cards sharing order=0, rendering arbitrarily.
//
// Trello's model: space wide, bisect on insert, re-space when a gap runs out.
// Ordering is assigned in store.svelte.js, which also knows which neighbours a
// re-space made dirty and therefore have to be persisted too.
export const ORDER_STEP = 65536;
