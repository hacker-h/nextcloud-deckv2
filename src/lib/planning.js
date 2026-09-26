export async function planningRequest(boardId, { cardId, plan, revision } = {}) {
  const response = await fetch(`/planning/boards/${boardId}${cardId == null ? '' : `/cards/${cardId}`}`, {
    method: cardId == null ? 'GET' : 'PUT', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(cardId == null ? {} : { body: JSON.stringify({ plan, revision }) }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Planung fehlgeschlagen');
  return data;
}
