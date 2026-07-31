// Card comments.
//
// These live on the OCS API, not the Deck REST API: different host prefix,
// different required headers, and an `ocs.data` envelope that the transport
// already unwraps. Never route them through client.deck().

const path = (cardId) => `/apps/deck/api/v1.0/cards/${cardId}/comments`;

export async function listComments(client, cardId, currentUser, { limit, offset } = {}) {
  const query = new URLSearchParams();
  if (limit !== undefined) query.set('limit', limit);
  if (offset !== undefined) query.set('offset', offset);
  const suffix = query.size ? `?${query}` : '';

  const r = await client.ocs(`${path(cardId)}${suffix}`);
  return (r.data ?? []).map((c) => normalizeComment(c, currentUser));
}

export async function createComment(client, cardId, message, { parentId, currentUser } = {}) {
  const body = { message };
  if (parentId !== undefined && parentId !== null) body.parentId = parentId;

  const r = await client.ocs(path(cardId), { method: 'POST', body });
  return normalizeComment(r.data, currentUser);
}

export async function updateComment(client, cardId, comment, message, currentUser) {
  assertOwnComment(comment, currentUser, 'edit');

  const r = await client.ocs(`${path(cardId)}/${comment.id}`, { method: 'PUT', body: { message } });
  return normalizeComment(r.data, currentUser);
}

export async function deleteComment(client, cardId, comment, currentUser) {
  assertOwnComment(comment, currentUser, 'delete');

  await client.ocs(`${path(cardId)}/${comment.id}`, { method: 'DELETE' });
  return comment.id;
}

// Deck itself enforces authorship server-side, but the UI must never render an
// edit affordance it cannot honour, so ownership is resolved client-side too.
export function normalizeComment(comment, currentUser) {
  const actorId = comment.actorId ?? comment.actor?.uid ?? comment.actor ?? null;

  return {
    id: comment.id,
    message: comment.message ?? '',
    actorId,
    actorDisplayName: comment.actorDisplayName ?? comment.actor?.displayName ?? actorId,
    creationDateTime: comment.creationDateTime ?? null,
    parentId: comment.parentId ?? null,
    mentions: comment.mentions ?? [],
    canEdit: Boolean(currentUser) && actorId === currentUser,
  };
}

function assertOwnComment(comment, currentUser, action) {
  if (!currentUser || comment.actorId !== currentUser) {
    throw new Error(`Cannot ${action} a comment authored by ${comment.actorId ?? 'another user'}`);
  }
}
