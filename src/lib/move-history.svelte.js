// Undo records only fields owned by a move. Fresh server cards supply all other
// fields, so undo cannot overwrite a title/description edited in the meantime.
const position = (card) => ({ stackId: card.stackId, order: card.order, done: card.done || null });
const doneTime = (value) => value ? Math.floor(new Date(value).getTime() / 1000) : null;
const same = (a, b) => Number(a.stackId) === Number(b.stackId) && Number(a.order) === Number(b.order) && doneTime(a.done) === doneTime(b.done);
export function createMoveHistory(client, onStacks) {
  const state = $state({ entries: [], busy: false, error: null });
  function record(boardId, before, after) {
    state.entries = [...state.entries.slice(-19), { boardId, cards: after.map((card) => ({ id: card.id, before: position(before.get(card.id)), after: position(card) })) }];
    state.error = null;
  }
  async function undo() {
    const entry = state.entries.at(-1);
    if (!entry || state.busy) return;
    state.busy = true; state.error = null;
    try {
      const { data } = await client.getStacks(entry.boardId);
      const cards = new Map(data.flatMap((stack) => stack.cards.map((card) => [card.id, { ...card, stackId: stack.id }])));
      for (const item of entry.cards) {
        if (!cards.has(item.id) || !same(cards.get(item.id), item.after)) {
          throw new Error('Karte wurde inzwischen verschoben oder ihr Status geändert. Rückgängig würde diese Änderung überschreiben.');
        }
      }
      for (const item of [...entry.cards]) {
        const card = { ...cards.get(item.id), ...item.before };
        await client.moveCard({ card, toBoardId: entry.boardId, toStackId: card.stackId, order: card.order });
        entry.cards = entry.cards.filter((candidate) => candidate.id !== item.id);
      }
      state.entries = state.entries.slice(0, -1);
    } catch (error) {
      state.error = error.message;
    } finally {
      try { const { data } = await client.getStacks(entry.boardId); onStacks(entry.boardId, data); }
      catch { state.error ??= 'Änderung gesendet, Board konnte nicht neu geladen werden.'; }
      state.busy = false;
    }
  }
  return { state, record, undo };
}
