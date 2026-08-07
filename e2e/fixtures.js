import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_SESSION_SECRET = 'nextcloud-deckv2-e2e-session-secret';

function env() {
  const raw = readFileSync(resolve(root, '.env.local'), 'utf8');
  const out = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

export const TEST_BOARD_ID = 116;
export const TEST_STACKS = { inbox: 366, todo: 367, doing: 368, blocked: 369, done: 370 };
export const INBOX_TITLE = '[deckv2] Inbox — managed, do not edit';

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Card ids proven to live on the test board. Comment endpoints are addressed as
// /cards/{id}/comments with no board segment anywhere in the URL, so they can
// only be judged against a known-safe set rather than by reading the path.
const safeCards = new Set();

// The managed inbox board is a second legitimate write target. Its id is not
// known until it has been looked up, so it is registered at fixture setup
// rather than hardcoded, and mutations are still refused for every other board.
const safeBoards = new Set([TEST_BOARD_ID]);

export function registerTestBoard(boardId) {
  safeBoards.add(Number(boardId));
}

export function registerTestCard(cardId) {
  safeCards.add(Number(cardId));
}

export function forgetTestCards() {
  safeCards.clear();
}

export function asList(value) {
  return Array.isArray(value) ? value : value.data;
}

export async function loadTestBoardCards(deck) {
  const list = asList(await deck.request('GET', `/boards/${TEST_BOARD_ID}/stacks`));
  for (const stack of list) for (const card of stack.cards ?? []) registerTestCard(card.id);
}

// Board 113 holds the user's real data. Any mutation that is not unambiguously
// scoped to the throwaway test board is refused before it reaches the network.
export function assertBoardScoped(method, url) {
  if (!MUTATING.has(method.toUpperCase())) return;

  const refuse = () => {
    throw new Error(
      `Mutation target must be an approved board (${[...safeBoards].join(', ')}), refusing ${method} ${redact(url)}`
    );
  };

  // Read the path only. A board id appearing in the query string says nothing
  // about what the request mutates and must never satisfy this check.
  const path = new URL(String(url), 'http://local').pathname;

  if (
    (method.toUpperCase() === 'POST' && ['/auth/login', '/auth/logout'].includes(path)) ||
    (method.toUpperCase() === 'GET' && path === '/auth/poll')
  ) {
    return;
  }

  const boards = [...path.matchAll(/\/boards\/(\d+)/g)].map((m) => Number(m[1]));
  if (boards.length) {
    if (boards.some((id) => !safeBoards.has(id))) refuse();
    return;
  }

  const card = path.match(/\/cards\/(\d+)(?:\/|$)/);
  if (card && safeCards.has(Number(card[1]))) return;

  refuse();
}

export function redact(value) {
  return String(value).replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
}

export const test = base.extend({
  context: async ({ context }, use) => {
    const sid = execFileSync(process.execPath, [resolve(root, 'scripts/seed-session.js')], {
      cwd: root,
      env: { ...process.env, SESSION_SECRET: E2E_SESSION_SECRET },
      encoding: 'utf8',
    }).trim();

    await context.addCookies([{
      name: 'sid',
      value: sid,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Strict',
    }]);

    const probe = await fetch('http://localhost:5173/auth/me', { headers: { Cookie: `sid=${sid}` } });
    if (!probe.ok) {
      throw new Error(`Seeded E2E session was rejected by the server (${probe.status}); verify Playwright webServer.env SESSION_SECRET matches scripts/seed-session.js.`);
    }

    await use(context);
  },

  deck: async ({}, use) => {
    const e = env();
    const baseUrl = String(e.VITE_NC_URL).replace(/\/$/, '');
    const auth =
      'Basic ' + Buffer.from(`${e.VITE_NC_USER}:${e.VITE_NC_PASS}`).toString('base64');

    const send = async (method, path, body) => {
      const url = `${baseUrl}/index.php/apps/deck/api/v1.0${path}`;
      const headers = { Authorization: auth, Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Deck ${method} ${redact(path)} failed: ${res.status}`);
      return res.status === 204 ? null : res.json();
    };

    const request = async (method, path, body) => {
      assertBoardScoped(method, `${baseUrl}/index.php/apps/deck/api/v1.0${path}`);
      return send(method, path, body);
    };

    // Bypasses the board guard, which cannot judge a board-less path like
    // POST /boards. Reserved for fixture setup that establishes what the guard
    // will subsequently allow; tests use `request`.
    const rawRequest = send;

    await use({ request, rawRequest, boardId: TEST_BOARD_ID, stacks: TEST_STACKS });
  },

  // Creating the inbox is a legitimate first-run side effect, but it must not
  // happen behind the mutation guard's back. Resolving it here means the guard
  // learns the board id before the app ever renders.
  inbox: async ({ deck }, use) => {
    const boards = asList(await deck.rawRequest('GET', '/boards'));
    let board = boards.find((b) => b.title === INBOX_TITLE);
    if (!board) {
      board = await deck.rawRequest('POST', '/boards', {
        title: INBOX_TITLE,
        color: '31CC7C',
      });
    }
    registerTestBoard(board.id);

    let stacks = asList(await deck.request('GET', `/boards/${board.id}/stacks`));
    if (!stacks.length) {
      await deck.request('POST', `/boards/${board.id}/stacks`, { title: 'Inbox', order: 0 });
      stacks = asList(await deck.request('GET', `/boards/${board.id}/stacks`));
    }

    const stack = stacks[0];
    await use({ board, stack, cards: stack.cards ?? [] });
  },

  guardedPage: async ({ page, deck, inbox }, use) => {
    await loadTestBoardCards(deck);
    for (const card of inbox.cards) registerTestCard(card.id);
    const violations = await installMutationGuard(page);

    await use(page);
    expect(violations, `unsafe mutations: ${violations.join('; ')}`).toEqual([]);
  },
});

// Aborts the request before it reaches the network if anything aims a mutation
// at a board other than the test board. Returns the collected violations so the
// caller decides whether they are a failure or the expected outcome.
export async function installMutationGuard(page) {
  const violations = [];
  await page.route('**/*', (route, request) => {
    try {
      assertBoardScoped(request.method(), request.url());
    } catch (err) {
      violations.push(err.message);
      return route.abort();
    }
    return route.continue();
  });
  return violations;
}

export { expect };
