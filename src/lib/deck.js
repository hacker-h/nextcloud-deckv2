// Deck API client.
//
// Every rule here was verified against the live server during the M0 spike.
// See .sisyphus/M0-RESULTS.md. Deck's API has traps that look like success
// while doing nothing, so these notes are the only documentation that exists.

const API = '/api/deck';
const OCS = '/api/ocs';

export class DeckError extends Error {
  constructor(status, body, { method = 'GET', path = '', contentType = '' } = {}) {
    const parsed = parseErrorBody(body, contentType);
    const msg = parsed.message || `Deck API error ${status}`;
    super(msg);
    this.name = 'DeckError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = parsed.body;
  }
}

export class DeckAbortError extends Error {
  constructor(message = 'Deck API request aborted') {
    super(message);
    this.name = 'AbortError';
  }
}

function parseErrorBody(body, contentType) {
  if (!body) return { message: '', body: '' };
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(body);
      const message = parsed.message ?? parsed.ocs?.meta?.message ?? '';
      return { message, body: parsed };
    } catch {
      // Some Nextcloud errors lie about content-type; keep the safe text body.
    }
  }
  return { message: body, body };
}

const isLive = (x) => !x.archived && Number(x.deletedAt ?? 0) === 0;
// Boards shared with us read-only. Every mutation against them returns 403, so
// offering them as a drag target or in the switcher only produces errors
// (verified: board 109 "Antonia Aufgaben", owned by another user).
const canEdit = (b) => Boolean((b.permissions ?? {}).PERMISSION_EDIT);
const byOrder = (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0);

export class DeckClient {
  deck(path, options = {}) {
    return this.#request(API, path, { ...options, ocs: false });
  }

  ocs(path, options = {}) {
    return this.#request(OCS, path, { ...options, ocs: true, unwrapOcs: true });
  }

  async #request(prefix, path, options) {
    const {
      method = 'GET',
      body,
      etag,
      signal,
      responseType = 'json',
      ocs = false,
      unwrapOcs = false,
      headers: extraHeaders = {},
    } = options;

    const headers = { Accept: 'application/json', ...extraHeaders };
    // OCS endpoints expect this marker. The same-origin proxy also sets it, and
    // keeping the client header is harmless when it is forwarded.
    if (ocs) headers['OCS-APIRequest'] = 'true';

    // M0.4: If-Modified-Since returns HTTP 500. Conditional reads use ETags only.
    if (etag) headers['If-None-Match'] = etag;

    const init = { method, headers, credentials: 'same-origin', signal };
    if (body !== undefined) {
      if (isRawBody(body)) {
        init.body = body;
      } else {
        headers['Content-Type'] ??= 'application/json';
        init.body = typeof body === 'string' ? body : JSON.stringify(body);
      }
    }

    let res;
    try {
      res = await fetch(prefix + path, init);
    } catch (err) {
      if (err?.name === 'AbortError') throw new DeckAbortError();
      throw err;
    }

    // 304 has no body - must return before attempting to parse JSON.
    if (res.status === 304) return { notModified: true, etag };
    if (!res.ok) {
      // Upstream error bodies may echo the Authorization header injected by the
      // proxy; redact any credential-looking value before surfacing the message.
      const text = redact(await res.text().catch(() => ''));
      throw new DeckError(res.status, text, {
        method,
        path,
        contentType: res.headers.get('Content-Type') ?? '',
      });
    }

    const result = { data: await readResponse(res, responseType), etag: res.headers.get('ETag') };
    if (unwrapOcs && result.data?.ocs && Object.hasOwn(result.data.ocs, 'data')) {
      result.data = result.data.ocs.data;
    }
    return result;
  }

  async getBoards(etag) {
    const r = await this.deck('/boards', { etag });
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
    const r = await this.deck(`/boards/${boardId}/stacks`, { etag });
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

    const r = await this.deck(`/boards/${toBoardId}/stacks/${toStackId}/cards/${card.id}`, {
      method: 'PUT',
      body,
    });
    return r.data;
  }
}

function isRawBody(body) {
  return (
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
  );
}

function redact(text) {
  return String(text).replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
}

async function readResponse(res, responseType) {
  if (responseType === 'arrayBuffer') return res.arrayBuffer();
  if (responseType === 'blob') return res.blob();
  if (responseType === 'text') return res.text();
  if (res.status === 204) return null;
  return res.json();
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
