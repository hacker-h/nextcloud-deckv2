// Hermetic backend for E2E.
//
// Every spec used to need a live Nextcloud plus a gitignored .env.local, which
// meant the suite could not run in CI and could not run on a fresh worktree at
// all. Worse, tests that mutate a real board have to be serialised and guarded,
// so the drag suite could never assert "the attachment request fired" without
// actually attaching something to real data.
//
// This intercepts the app's own proxy routes (/auth/*, /api/deck/*, /api/ocs/*)
// in the browser, so the app under test is byte-identical to production while
// the backend is deterministic. Requests are recorded, which is what lets a
// drop test assert the API call happened rather than assuming a visible toast
// implies one.

import { MOCK_BOARDS, MOCK_STACKS } from './mock-board.js';

export const MOCK_USER = { id: 'e2e', displayName: 'E2E Runner' };

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// Deck returns 200 with an ETag on collections; the client sends If-None-Match
// and treats 304 as "unchanged". Always answering 200 keeps the store simple
// and still exercises the real parsing path.
function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { ETag: `"mock-${Date.now()}"` },
    body: JSON.stringify(body),
  });
}

export class MockBackend {
  constructor() {
    this.boards = clone(MOCK_BOARDS).map((b) => ({
      ...b,
      permissions: { PERMISSION_READ: true, PERMISSION_EDIT: true, PERMISSION_MANAGE: true },
      deletedAt: 0,
    }));
    this.stacks = clone(MOCK_STACKS).map((s) => ({
      ...s,
      boardId: this.boards[0].id,
      deletedAt: 0,
      cards: (s.cards ?? []).map((c) => ({
        ...c,
        stackId: s.id,
        boardId: this.boards[0].id,
        deletedAt: 0,
        attachments: c.attachments ?? [],
        attachmentCount: c.attachmentCount ?? 0,
      })),
    }));
    // Every intercepted request, in order. Specs assert against this instead of
    // inferring backend activity from UI state.
    this.requests = [];
    this.nextAttachmentId = 9000;
    // Set by a spec to make the next matching request fail, so error paths are
    // reachable without a broken server.
    this.failNext = null;
  }

  record(method, url, body) {
    this.requests.push({ method, url, path: new URL(url).pathname, body });
  }

  /** Requests whose path contains `fragment`, optionally filtered by method. */
  find(fragment, method) {
    return this.requests.filter(
      (r) => r.path.includes(fragment) && (!method || r.method === method.toUpperCase())
    );
  }

  card(cardId) {
    for (const stack of this.stacks) {
      const found = stack.cards.find((c) => Number(c.id) === Number(cardId));
      if (found) return found;
    }
    return null;
  }
}

/**
 * Installs the mock backend on a Playwright page. Returns the backend so the
 * spec can assert on recorded requests and mutate fixture state.
 *
 * Routes are registered most-specific-first because Playwright matches the
 * most recently registered handler first; ordering mistakes here surface as a
 * confusing 404 rather than a wrong body.
 */
export async function installMockBackend(page, { backend = new MockBackend() } = {}) {
  await page.route('**/auth/me', (route) =>
    json(route, { user: MOCK_USER, instance: 'mock.local' })
  );
  await page.route('**/auth/poll', (route) => json(route, { user: MOCK_USER }));
  await page.route('**/auth/logout', (route) => json(route, {}));

  await page.route('**/api/deck/**', async (route, request) => {
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/deck', '');
    const method = request.method();
    let body = null;
    if (!['GET', 'HEAD'].includes(method)) {
      // Attachment uploads are multipart; postData() is still a useful record
      // of what was sent even though it is not JSON.
      const raw = request.postData();
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = raw;
      }
    }
    backend.record(method, request.url(), body);

    if (backend.failNext && path.includes(backend.failNext)) {
      backend.failNext = null;
      return json(route, { message: 'Mock failure' }, 500);
    }

    if (method === 'GET' && path === '/boards') {
      return json(route, backend.boards);
    }

    const stacksMatch = path.match(/^\/boards\/(\d+)\/stacks$/);
    if (method === 'GET' && stacksMatch) {
      return json(route, backend.stacks);
    }

    // POST .../attachments — link or file. Deck distinguishes by the `type`
    // field, and the client sends multipart in both cases.
    const attachMatch = path.match(/^\/boards\/(\d+)\/stacks\/(\d+)\/cards\/(\d+)\/attachments$/);
    if (method === 'POST' && attachMatch) {
      const card = backend.card(attachMatch[3]);
      const attachment = {
        id: backend.nextAttachmentId++,
        cardId: Number(attachMatch[3]),
        type: 'deck_file',
        data: 'mock-attachment',
        createdAt: Date.now(),
      };
      if (card) {
        card.attachments.push(attachment);
        card.attachmentCount = card.attachments.length;
      }
      return json(route, attachment);
    }
    if (method === 'GET' && attachMatch) {
      const card = backend.card(attachMatch[3]);
      return json(route, card?.attachments ?? []);
    }

    // PUT card — reorder, move, or field update.
    const cardMatch = path.match(/^\/boards\/(\d+)\/stacks\/(\d+)\/cards\/(\d+)$/);
    if (cardMatch) {
      const card = backend.card(cardMatch[3]);
      if (method === 'PUT' && card && body && typeof body === 'object') Object.assign(card, body);
      return json(route, card ?? {});
    }

    if (method === 'GET' && path.includes('/comments')) {
      return json(route, { ocs: { data: [] } });
    }

    return json(route, []);
  });

  await page.route('**/api/ocs/**', (route, request) => {
    backend.record(request.method(), request.url(), null);
    return json(route, { ocs: { meta: { status: 'ok' }, data: [] } });
  });

  return backend;
}
