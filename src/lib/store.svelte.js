// Board state with optimistic mutations.
//
// PLAN.md section 4.1: mutate locally and render immediately, send in the
// background, roll back precisely on failure. Never a global loading state,
// never a spinner on the board. Measured server cost is ~1.2-1.5s per move, so
// anything that waits for the response feels broken.

import { ORDER_STEP } from './deck.js';

export function createBoardStore(client) {
  const s = $state({
    stacks: [],
    boardId: null,
    loading: true,
    error: null,
    toast: null,
    pending: 0,
  });

  function findCard(id) {
    for (const st of s.stacks) {
      const i = st.cards.findIndex((c) => c.id === id);
      if (i !== -1) return { stack: st, card: st.cards[i], index: i };
    }
    return null;
  }

  async function load(boardId) {
    s.boardId = boardId;
    s.loading = true;
    s.error = null;
    try {
      const { data } = await client.getStacks(boardId);
      s.stacks = data;
    } catch (e) {
      s.error = e.message;
      s.stacks = [];
    } finally {
      s.loading = false;
    }
  }

  // Re-reads the current board without the loading flag. Callers that mutate a
  // card out-of-band (a tile drop attaching a file, say) need the tile to pick
  // up the new attachment count, but flipping `loading` would blank the board
  // and undo section 4.1's "never a global loading state".
  async function refresh() {
    if (s.boardId == null) return;
    try {
      const { data } = await client.getStacks(s.boardId);
      s.stacks = data;
    } catch {
      // A failed refresh is cosmetic: the mutation itself already succeeded and
      // the stale tile corrects itself on the next load. Surfacing an error here
      // would contradict the success the caller is about to report.
    }
  }

  // Detail edits patch a single tile in place. Stack membership and order are
  // owned by drag-and-drop, so they are deliberately preserved here even when
  // the detail response carries different values.
  function replaceCard(card) {
    if (!card) return null;
    const found = findCard(card.id);
    if (!found) return null;

    const { stack, index, card: previous } = found;
    stack.cards[index] = { ...card, stackId: previous.stackId, order: previous.order };
    return stack.cards[index];
  }

  function removeCard(cardId) {
    const found = findCard(cardId);
    if (!found) return null;

    found.stack.cards.splice(found.index, 1);
    return found.card;
  }

  function failToast(failed) {
    s.toast = {
      text:
        failed.length === 1
          ? `Could not move "${failed[0].card.title}" - ${failed[0].error}`
          : `Could not move ${failed.length} cards`,
    };
    setTimeout(() => (s.toast = null), 6000);
  }

  // Move one or more cards into toStackId at index, preserving their relative
  // order (PLAN.md section 6).
  async function moveCards({ cardIds, toStackId, index, boardId }) {
    const dest = s.stacks.find((x) => x.id === toStackId);
    if (!dest) return;

    const moving = cardIds
      .map((id) => findCard(id))
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)
      .map((x) => x.card);
    if (!moving.length) return;

    // Dropped back exactly where it already was. `index` is expressed in the
    // list with the dragged cards removed, and removing a card does not shift
    // anything ahead of it, so its own position in that space is its old index.
    if (moving.length === 1) {
      const cur = findCard(moving[0].id);
      if (cur.stack.id === toStackId && index === cur.index) return;
    }

    // Snapshot for precise rollback. Card objects are shared with the live
    // state and we mutate order/stackId on them, so those fields have to be
    // captured explicitly - restoring the arrays alone would leave cards in the
    // right slot with the wrong order.
    const snapshot = {
      stacks: s.stacks.map((st) => ({ ...st, cards: [...st.cards] })),
      fields: new Map(s.stacks.flatMap((st) => st.cards.map((c) => [c, { order: c.order, stackId: c.stackId }]))),
    };
    const rollback = () => {
      for (const [card, f] of snapshot.fields) Object.assign(card, f);
      s.stacks = snapshot.stacks;
    };

    // --- optimistic local update ---
    for (const st of s.stacks) st.cards = st.cards.filter((c) => !cardIds.includes(c.id));
    const at = Math.min(index ?? dest.cards.length, dest.cards.length);
    dest.cards.splice(at, 0, ...moving);
    moving.forEach((c) => (c.stackId = toStackId));

    // --- assign orders (M0.4) ---
    // Every card whose `order` changes must be persisted, not just the ones the
    // user dragged: a re-space shifts its neighbours too, and skipping them
    // leaves the server sorting the card somewhere else than the UI shows it
    // (verified - the card landed last instead of second).
    const before = dest.cards[at - 1] ?? null;
    const after = dest.cards[at + moving.length] ?? null;
    const dirty = [];

    const lo = before
      ? Number(before.order)
      : after
        ? Number(after.order) - ORDER_STEP * (moving.length + 1)
        : 0;
    const hi = after ? Number(after.order) : lo + ORDER_STEP * (moving.length + 1);
    const room = hi - lo;

    if (room > moving.length + 1) {
      // Enough headroom to bisect: only the moved cards change.
      const step = Math.floor(room / (moving.length + 1));
      moving.forEach((c, i) => {
        c.order = lo + step * (i + 1);
        dirty.push(c);
      });
    } else {
      // Gap exhausted. Deck stores dense orders (0,1,2,...), so this is the
      // normal case for an insert between two neighbours, not an edge case.
      // Re-space forwards from the insertion point and stop as soon as the
      // remaining tail is already ordered correctly - that keeps this O(few)
      // instead of rewriting the whole stack the way reorder() does.
      let prev = lo;
      for (let i = at; i < dest.cards.length; i++) {
        const c = dest.cards[i];
        if (!cardIds.includes(c.id) && Number(c.order) > prev) break;
        c.order = prev + ORDER_STEP;
        prev = c.order;
        dirty.push(c);
      }
    }

    // --- send in background, bounded parallelism (M0.3: 6 parallel = 4.3s) ---
    s.pending += dirty.length;
    const failed = [];
    const queue = [...dirty];
    const worker = async () => {
      for (let card = queue.shift(); card; card = queue.shift()) {
        try {
          await client.moveCard({ card, toBoardId: boardId, toStackId, order: card.order });
        } catch (e) {
          failed.push({ card, error: e.message });
        } finally {
          s.pending -= 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, dirty.length) }, worker));

    if (failed.length) {
      rollback();
      failToast(failed);
    }
  }

  // --- cross-board transfer (PLAN.md section 7) ---
  //
  // The inbox owns a different board, so these hand cards across that boundary
  // without issuing any request: the inbox store performs the single PUT that
  // moves the card, and whichever side is losing the card drops it locally.

  function takeCard(cardId) {
    const found = findCard(cardId);
    if (!found) return null;
    found.stack.cards.splice(found.index, 1);
    return found.card;
  }

  function restoreCards(cards) {
    for (const card of cards) {
      const stack = s.stacks.find((x) => x.id === card.stackId);
      if (!stack) continue;
      const at = stack.cards.findIndex((c) => Number(c.order) > Number(card.order));
      stack.cards.splice(at === -1 ? stack.cards.length : at, 0, card);
    }
  }

  function removeCards(cardIds) {
    for (const id of cardIds) removeCard(id);
  }

  function insertCards({ cards, toStackId, index }) {
    const dest = s.stacks.find((x) => x.id === toStackId);
    if (!dest) return { order: 0 };

    const at = Math.min(index ?? dest.cards.length, dest.cards.length);
    const before = dest.cards[at - 1] ?? null;
    const order = before ? Number(before.order) + ORDER_STEP : 0;

    cards.forEach((card, i) => {
      card.stackId = toStackId;
      card.order = order + i;
    });
    dest.cards.splice(at, 0, ...cards);
    return { order };
  }

  return {
    state: s,
    load,
    refresh,
    moveCards,
    replaceCard,
    removeCard,
    takeCard,
    restoreCards,
    removeCards,
    insertCards,
  };
}
