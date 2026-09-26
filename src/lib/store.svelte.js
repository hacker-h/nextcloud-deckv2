// Board state with optimistic mutations.
//
// PLAN.md section 4.1: mutate locally and render immediately, send in the
// background, roll back precisely on failure. Never a global loading state,
// never a spinner on the board. Measured server cost is ~1.2-1.5s per move, so
// anything that waits for the response feels broken.

import { createMoveHistory } from './move-history.svelte.js';
import { ORDER_STEP, planOrders } from '../../shared/ordering.js';

export function createBoardStore(client, { autoCompleteDone = () => true } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const mutationEpochs = new Map();
  let loadToken = 0;
  const s = $state({
    stacks: [],
    boardId: null,
    loading: true,
    error: null,
    toast: null,
    pending: 0,
  });

  const history = createMoveHistory(client, (boardId, stacks) => {
    mutationEpochs.set(boardId, epochFor(boardId) + 1);
    cacheStacks(boardId, stacks);
    if (s.boardId === boardId) s.stacks = stacks;
  });

  function findCard(id) {
    for (const st of s.stacks) {
      const i = st.cards.findIndex((c) => c.id === id);
      if (i !== -1) return { stack: st, card: st.cards[i], index: i };
    }
    return null;
  }

  const cloneStacks = (stacks) => JSON.parse(JSON.stringify(stacks));
  const epochFor = (boardId) => mutationEpochs.get(boardId) ?? 0;

  function cacheStacks(boardId, stacks) {
    cache.delete(boardId);
    cache.set(boardId, cloneStacks(stacks));
    if (cache.size > 50) cache.delete(cache.keys().next().value);
    return stacks;
  }

  function cachedStacks(boardId) {
    const cached = cache.get(boardId);
    if (!cached) return null;
    cache.delete(boardId);
    cache.set(boardId, cached);
    return cloneStacks(cached);
  }

  function commitLocal(boardId = s.boardId) {
    if (boardId == null || s.boardId !== boardId) return;
    mutationEpochs.set(boardId, epochFor(boardId) + 1);
    cacheStacks(boardId, s.stacks);
  }

  function fetchStacks(boardId) {
    if (inflight.has(boardId)) return inflight.get(boardId);
    const epoch = epochFor(boardId);
    const request = client.getStacks(boardId)
      .then(({ data }) => {
        if (epochFor(boardId) === epoch) cacheStacks(boardId, data);
        return { stacks: data, epoch };
      })
      .finally(() => inflight.delete(boardId));
    inflight.set(boardId, request);
    return request;
  }

  async function load(boardId) {
    const token = ++loadToken;
    s.boardId = boardId;
    s.error = null;
    const cached = cachedStacks(boardId);
    if (cached) {
      s.stacks = cached;
      s.loading = false;
    } else {
      s.loading = true;
    }

    try {
      const { stacks, epoch } = await fetchStacks(boardId);
      if (token !== loadToken || s.boardId !== boardId) return;
      if (epochFor(boardId) !== epoch) return;
      s.stacks = stacks;
    } catch (e) {
      if (token !== loadToken || s.boardId !== boardId) return;
      if (e?.status === 403 || e?.status === 404) {
        cache.delete(boardId);
        s.error = e.message;
        s.stacks = [];
      } else if (!cached) {
        s.error = e.message;
        s.stacks = [];
      }
    } finally {
      if (token === loadToken && s.boardId === boardId) s.loading = false;
    }
  }

  function preload(boardId) {
    const cached = cachedStacks(boardId);
    if (cached) return Promise.resolve(cached);
    return fetchStacks(boardId)
      .then(({ stacks }) => stacks)
      .catch((error) => {
        if (error?.status === 403 || error?.status === 404) cache.delete(boardId);
        return null;
      });
  }

  // Re-reads the current board without the loading flag. Callers that mutate a
  // card out-of-band (a tile drop attaching a file, say) need the tile to pick
  // up the new attachment count, but flipping `loading` would blank the board
  // and undo section 4.1's "never a global loading state".
  async function refresh() {
    if (s.boardId == null) return;
    const boardId = s.boardId;
    const epoch = epochFor(boardId);
    try {
      const { data } = await client.getStacks(boardId);
      if (epochFor(boardId) !== epoch) return;
      cacheStacks(boardId, data);
      if (s.boardId === boardId) s.stacks = data;
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
    commitLocal();
    return stack.cards[index];
  }

  function removeCard(cardId) {
    const found = findCard(cardId);
    if (!found) return null;

    found.stack.cards.splice(found.index, 1);
    commitLocal();
    return found.card;
  }

  function addCard({ boardId, stackId, card }) {
    if (!card || s.boardId !== boardId) return null;
    const stack = s.stacks.find((candidate) => candidate.id === stackId);
    if (!stack) return null;
    const added = { ...card, stackId };
    stack.cards.push(added);
    commitLocal(boardId);
    return added;
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
    if (s.pending || history.state.busy) {
      s.toast = { text: 'Die vorherige Verschiebung wird noch gespeichert. Bitte kurz warten.' };
      return;
    }
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
      fields: new Map(s.stacks.flatMap((st) => st.cards.map((c) => [c, { order: c.order, stackId: c.stackId, done: c.done }]))),
    };
    const rollback = () => {
      for (const [card, f] of snapshot.fields) Object.assign(card, f);
      cacheStacks(boardId, snapshot.stacks);
      mutationEpochs.set(boardId, epochFor(boardId) + 1);
      if (s.boardId === boardId || s.boardId == null) s.stacks = snapshot.stacks;
    };

    // --- optimistic local update ---
    for (const st of s.stacks) st.cards = st.cards.filter((c) => !cardIds.includes(c.id));
    const at = Math.min(index ?? dest.cards.length, dest.cards.length);
    dest.cards.splice(at, 0, ...moving);
    moving.forEach((c) => {
      if (c.stackId !== toStackId && autoCompleteDone() && dest.title?.trim().toLowerCase() === 'done' && !c.done) {
        c.done = new Date().toISOString();
      }
      c.stackId = toStackId;
    });

    // --- assign orders (M0.4, see ordering.js) ---
    const dirty = planOrders({ cards: dest.cards, at, movingCount: moving.length }).map(({ card, order }) => {
      card.order = order;
      return card;
    });
    commitLocal(boardId);

    // --- send in background, bounded parallelism (M0.3: 6 parallel = 4.3s) ---
    s.pending += dirty.length;
    const failed = [];
    const queue = [...dirty];
    const worker = async () => {
      for (let card = queue.shift(); card; card = queue.shift()) {
        try {
          const saved = await client.moveCard({ card, toBoardId: boardId, toStackId, order: card.order });
          if (saved && Object.hasOwn(saved, 'done')) card.done = saved.done;
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
      if (failed.length < dirty.length) {
        // A multi-card move is not a server transaction: reconcile successful
        // writes rather than claiming the entire batch was rolled back.
        try {
          const { data } = await client.getStacks(boardId);
          cacheStacks(boardId, data);
          if (s.boardId === boardId) s.stacks = data;
        } catch { /* Failure remains visible; the next board load reconciles. */ }
      }
      failToast(failed);
    } else {
      const before = new Map([...snapshot.fields].map(([card, fields]) => [card.id, fields]));
      commitLocal(boardId);
      history.record(boardId, before, dirty);
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
    commitLocal();
    return found.card;
  }

  function restoreCards(cards) {
    let restored = false;
    for (const card of cards) {
      const stack = s.stacks.find((x) => x.id === card.stackId);
      if (!stack) continue;
      const at = stack.cards.findIndex((c) => Number(c.order) > Number(card.order));
      stack.cards.splice(at === -1 ? stack.cards.length : at, 0, card);
      restored = true;
    }
    if (restored) commitLocal();
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
    commitLocal();
    return { order };
  }

  return {
    state: s,
    history,
    load,
    preload,
    isCached: (boardId) => cache.has(boardId),
    refresh,
    moveCards,
    replaceCard,
    addCard,
    removeCard,
    takeCard,
    restoreCards,
    removeCards,
    insertCards,
  };
}
