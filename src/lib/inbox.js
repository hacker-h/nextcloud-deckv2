// Cross-board inbox (PLAN.md section 7).

import { INBOX_COLOR, INBOX_STACK_TITLE, INBOX_TITLE } from '../../shared/inbox-board.js';

export { INBOX_STACK_TITLE, INBOX_TITLE };

const COLLAPSE_KEY = 'deckv2:inbox:collapsed';

export function isInboxBoard(board) {
  return board?.title === INBOX_TITLE;
}

export function withoutInbox(boards) {
  return boards.filter((b) => !isInboxBoard(b));
}

export function findInboxBoard(boards) {
  return boards.find(isInboxBoard) ?? null;
}

export function readCollapsed(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeCollapsed(collapsed, storage = globalThis.localStorage) {
  try {
    storage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    // A private-mode storage failure must not break the panel.
  }
}

export async function ensureInbox(client, boards) {
  const board = findInboxBoard(boards) ?? (await createInboxBoard(client));
  const stack = await ensureInboxStack(client, board.id);
  return { board, stack };
}

async function createInboxBoard(client) {
  const r = await client.deck('/boards', {
    method: 'POST',
    body: { title: INBOX_TITLE, color: INBOX_COLOR },
  });
  return r.data;
}

async function ensureInboxStack(client, boardId) {
  const { data: stacks } = await client.getStacks(boardId);
  if (stacks.length) return stacks[0];

  const r = await client.deck(`/boards/${boardId}/stacks`, {
    method: 'POST',
    body: { title: INBOX_STACK_TITLE, order: 0 },
  });
  return { ...r.data, cards: [] };
}
