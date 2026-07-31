// Card label and assignee operations.
//
// Deck exposes these as PUT verbs on the card path rather than as REST
// sub-resources, and the board payload is the only source for the option lists.

export const USER_TYPE = 0;
export const GROUP_TYPE = 1;

// Labels and eligible participants both live on the board payload, so a single
// read backs both pickers.
export async function getBoardAssignmentOptions(client, boardId, etag) {
  const r = await client.deck(`/boards/${boardId}`, { etag });
  if (r.notModified) return r;

  return {
    ...r,
    data: {
      labels: (r.data.labels ?? []).map(normalizeLabel),
      participants: (r.data.acl ?? []).map(normalizeParticipant),
    },
  };
}

export function assignLabel(client, target, labelId) {
  return cardAction(client, target, 'assignLabel', { labelId });
}

export function removeLabel(client, target, labelId) {
  return cardAction(client, target, 'removeLabel', { labelId });
}

export function assignUser(client, target, userId, type = USER_TYPE) {
  return cardAction(client, target, 'assignUser', { userId, type });
}

export function unassignUser(client, target, userId, type = USER_TYPE) {
  return cardAction(client, target, 'unassignUser', { userId, type });
}

async function cardAction(client, { boardId, stackId, cardId }, action, body) {
  const path = `/boards/${boardId}/stacks/${stackId}/cards/${cardId}/${action}`;
  try {
    const r = await client.deck(path, { method: 'PUT', body });
    return { ok: true, card: r.data };
  } catch (err) {
    return normalizeAssignmentError(err);
  }
}

// Deck answers an already-assigned label/user with a 400 rather than succeeding
// quietly. Callers reconcile from the server, so reporting this as a distinct
// non-fatal outcome keeps local state from being rolled back incorrectly.
export function normalizeAssignmentError(err) {
  if (err?.name !== 'DeckError') throw err;

  const message = err.message ?? '';
  if (err.status === 400 && /already assigned/i.test(message)) {
    return { ok: true, duplicate: true, code: 'duplicate', message, card: null };
  }
  if (/not.*(member|part of)/i.test(message)) {
    return { ok: false, code: 'not-a-member', message, status: err.status };
  }
  return { ok: false, code: 'error', message, status: err.status };
}

function normalizeLabel(label) {
  return { id: label.id, title: label.title, color: label.color, boardId: label.boardId };
}

function normalizeParticipant(entry) {
  return {
    id: entry.participant?.uid ?? entry.participant,
    displayName: entry.participant?.displayName ?? entry.participant?.uid ?? entry.participant,
    type: entry.type ?? USER_TYPE,
  };
}
