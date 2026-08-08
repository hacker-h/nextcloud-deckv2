// Card attachments.
//
// Deck stores these either as plain files on the card ("deck_file") or as
// references into the user's Files app ("file"); the type is required on upload
// and must survive round-trips or the server rejects later updates.

export const DECK_FILE = 'deck_file';

const path = ({ boardId, stackId, cardId }) => `/boards/${boardId}/stacks/${stackId}/cards/${cardId}/attachments`;

export async function listAttachments(client, target, { signal } = {}) {
  const r = await client.deck(path(target), { signal });
  return (r.data ?? []).map(normalizeAttachment);
}

export async function uploadAttachment(client, target, file, { type = DECK_FILE, signal } = {}) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file, file.name);

  const r = await client.deck(path(target), { method: 'POST', body: form, signal });
  return normalizeAttachment(r.data);
}

export async function addLinkAttachment(client, target, linkUrl, { signal } = {}) {
  const form = new FormData();
  form.append('type', 'deck_link');
  form.append('link', linkUrl);

  const r = await client.deck(path(target), { method: 'POST', body: form, signal });
  return normalizeAttachment(r.data);
}

export async function updateAttachment(client, target, attachmentId, file, { type = DECK_FILE, signal } = {}) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file, file.name);

  const r = await client.deck(`${path(target)}/${attachmentId}`, { method: 'PUT', body: form, signal });
  return normalizeAttachment(r.data);
}

export async function deleteAttachment(client, target, attachmentId) {
  await client.deck(`${path(target)}/${attachmentId}`, { method: 'DELETE' });
  return attachmentId;
}

export async function restoreAttachment(client, target, attachmentId) {
  const r = await client.deck(`${path(target)}/${attachmentId}/restore`, { method: 'PUT' });
  return normalizeAttachment(r.data);
}

// Downloads go through the authenticated transport rather than a plain <a href>
// so credentials stay in the Authorization header and never reach the URL,
// browser history, or proxy logs.
export function downloadAttachment(client, target, attachmentId, { signal } = {}) {
  return client
    .deck(`${path(target)}/${attachmentId}`, { responseType: 'blob', signal })
    .then((r) => r.data);
}

function normalizeAttachment(attachment) {
  if (!attachment) return null;

  return {
    id: attachment.id,
    cardId: attachment.cardId,
    type: attachment.type ?? DECK_FILE,
    data: attachment.data ?? '',
    name: attachment.extendedData?.info?.filename
      ? `${attachment.extendedData.info.filename}${attachment.extendedData.info.extension ? `.${attachment.extendedData.info.extension}` : ''}`
      : (attachment.data ?? ''),
    mimetype: attachment.extendedData?.mimetype ?? null,
    size: attachment.extendedData?.filesize ?? null,
    createdBy: attachment.createdBy ?? null,
    deletedAt: Number(attachment.deletedAt ?? 0),
  };
}
