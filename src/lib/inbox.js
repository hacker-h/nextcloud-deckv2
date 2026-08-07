// Cross-board inbox (PLAN.md section 7).
//
// The inbox is a real Deck board, because Deck has no concept of a card that
// belongs to no board. The prefix marks it as ours and the suffix warns anyone
// who meets it in Deck's own UI, where it unavoidably appears in the board list.

export const INBOX_TITLE = '[deckv2] Inbox — managed, do not edit';
export const INBOX_STACK_TITLE = 'Inbox';
const INBOX_COLOR = '31CC7C';

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
