const DECK_API = '/index.php/apps/deck/api/v1.0';

export class AgentDeckClient {
  constructor({ ncUrl, user, appPassword, fetchImpl = fetch, timeoutMs = 30_000 }) {
    this.ncUrl = ncUrl;
    this.user = user;
    this.appPassword = appPassword;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body } = {}) {
    const headers = {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${this.user}:${this.appPassword}`).toString('base64')}`,
      'OCS-APIRequest': 'true',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(`${this.ncUrl}${DECK_API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const text = redact(await res.text().catch(() => ''));
      throw deckError(res.status, 'DECK_UPSTREAM_ERROR', text.slice(0, 300) || `Deck responded ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async boards() {
    const boards = await this.request('/boards');
    return boards.filter((board) => !board.archived && Number(board.deletedAt ?? 0) === 0);
  }

  async stacks(boardId) {
    const stacks = await this.request(`/boards/${boardId}/stacks`);
    return stacks
      .filter((stack) => Number(stack.deletedAt ?? 0) === 0)
      .sort(byOrder)
      .map((stack) => ({
        ...stack,
        cards: (stack.cards ?? []).filter((card) => !card.archived && Number(card.deletedAt ?? 0) === 0).sort(byOrder),
      }));
  }

  createStack(boardId, { title, order = 0 }) {
    return this.request(`/boards/${boardId}/stacks`, { method: 'POST', body: { title, order } });
  }

  createBoard({ title, color }) {
    return this.request('/boards', { method: 'POST', body: { title, color } });
  }

  createCard({ boardId, stackId, title, description = '', duedate = null }) {
    return this.request(`/boards/${boardId}/stacks/${stackId}/cards`, {
      method: 'POST',
      body: { title, description, duedate, type: 'plain' },
    });
  }

  card({ boardId, stackId, cardId }) {
    return this.request(`/boards/${boardId}/stacks/${stackId}/cards/${cardId}`);
  }

  // Deck's card update is replace-style and reads the target stack from the URL
  // path, not the body: sending the stack only in the body returns 200 with the
  // card unmoved. Title/type/owner/description must be resent or they are wiped.
  moveCard({ card, toBoardId, toStackId, order }) {
    const body = {
      title: card.title,
      type: card.type ?? 'plain',
      owner: typeof card.owner === 'object' ? card.owner?.uid : card.owner,
      description: card.description ?? '',
      order,
    };
    if (card.duedate) body.duedate = card.duedate;
    return this.request(`/boards/${toBoardId}/stacks/${toStackId}/cards/${card.id}`, { method: 'PUT', body });
  }

  async updateCard({ boardId, stackId, cardId, changes }) {
    const current = await this.card({ boardId, stackId, cardId });
    const merged = { ...current, ...changes };
    const body = {};
    for (const [key, value] of Object.entries(merged)) {
      if (value !== undefined) body[key] = value;
    }
    if (merged.owner && typeof merged.owner === 'object') body.owner = merged.owner.uid;
    return this.request(`/boards/${boardId}/stacks/${stackId}/cards/${cardId}`, { method: 'PUT', body });
  }
}

function byOrder(a, b) {
  return Number(a.order ?? 0) - Number(b.order ?? 0);
}

function redact(text) {
  return String(text).replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
}

function deckError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
