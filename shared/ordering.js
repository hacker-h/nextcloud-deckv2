// Sparse ordering for card insertion (M0.4, see deck.js).
//
// Deck's card update writes exactly the `order` it is given and never reindexes
// the target stack, so assigning orders is the client's job. This module is the
// single implementation of that assignment: the board store uses it for drag
// and drop, and the agent API uses it for programmatic bulk moves. Both must
// produce identical results or the same move would land differently depending
// on who issued it.

export const ORDER_STEP = 65536;

// `cards` is the destination lane as it looks AFTER the moved cards were
// inserted at `at`. Returns every card whose order has to be persisted - not
// just the moved ones, because a re-space shifts its neighbours too and
// skipping them leaves the server sorting cards differently than the UI shows.
export function planOrders({ cards, at, movingCount }) {
  const moving = cards.slice(at, at + movingCount);
  if (!moving.length) return [];

  const before = cards[at - 1] ?? null;
  const after = cards[at + movingCount] ?? null;
  const dirty = [];

  const lo = before
    ? Number(before.order)
    : after
      ? Number(after.order) - ORDER_STEP * (movingCount + 1)
      : 0;
  const hi = after ? Number(after.order) : lo + ORDER_STEP * (movingCount + 1);
  const room = hi - lo;

  if (room > movingCount + 1) {
    // Enough headroom to bisect: only the moved cards change.
    const step = Math.floor(room / (movingCount + 1));
    moving.forEach((card, i) => dirty.push({ card, order: lo + step * (i + 1) }));
    return dirty;
  }

  // Gap exhausted. Deck stores dense orders (0,1,2,...), so this is the normal
  // case for an insert between two neighbours rather than an edge case.
  // Re-space forwards from the insertion point and stop as soon as the
  // remaining tail is already ordered correctly, which keeps this O(few)
  // instead of rewriting the whole stack.
  const movingSet = new Set(moving);
  let prev = lo;
  for (let i = at; i < cards.length; i++) {
    const card = cards[i];
    if (!movingSet.has(card) && Number(card.order) > prev) break;
    prev += ORDER_STEP;
    dirty.push({ card, order: prev });
  }
  return dirty;
}
