export function getCard(client, cardId, etag) {
  return client.deck(`/cards/${cardId}`, { etag });
}

export async function updateCard(client, { boardId, stackId, cardId, changes }) {
  const fresh = await getCard(client, cardId);
  const body = buildCardPayload(fresh.data, changes);

  return client.deck(`/boards/${boardId}/stacks/${stackId}/cards/${cardId}`, {
    method: 'PUT',
    body,
  });
}

export function archiveCard(client, cardId) {
  return client.deck(`/cards/${cardId}/archive`, { method: 'PUT' });
}

export function unarchiveCard(client, cardId) {
  return client.deck(`/cards/${cardId}/unarchive`, { method: 'PUT' });
}

export function deleteCard(client, cardId) {
  return client.deck(`/cards/${cardId}`, { method: 'DELETE' });
}

export function buildCardPayload(card, changes = {}) {
  const merged = { ...card, ...changes };
  const body = {};

  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) body[key] = value;
  }

  // M0: Deck's PUT is replace-style and owner objects must be flattened; keep
  // every server field unless the caller intentionally changes it.
  if (Object.hasOwn(merged, 'owner')) body.owner = normalizeOwner(merged.owner);

  return body;
}

function normalizeOwner(owner) {
  if (owner && typeof owner === 'object') return owner.uid;
  return owner;
}
