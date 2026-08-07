import { ORDER_STEP } from './deck.js';
import { ensureInbox } from './inbox.js';

// Holds the inbox stack's cards. Separate from the board store because the
// inbox lives on its own Deck board and stays mounted while the user switches
// boards underneath it.
export function createInboxStore(client) {
  const s = $state({
    board: null,
    stack: null,
    cards: [],
    ready: false,
    error: null,
    pending: 0,
  });

  async function init(boards) {
    try {
      const { board, stack } = await ensureInbox(client, boards);
      s.board = board;
      s.stack = stack;
      s.cards = stack.cards ?? [];
      s.ready = true;
      s.error = null;
    } catch (e) {
      s.error = e.message;
      s.ready = false;
    }
    return s.board;
  }

  async function reload() {
    if (!s.board || !s.stack) return;
    const { data } = await client.getStacks(s.board.id);
    const fresh = data.find((x) => x.id === s.stack.id);
    if (fresh) s.cards = fresh.cards ?? [];
  }

  function orderAt(index) {
    const before = s.cards[index - 1];
    return before ? Number(before.order) + ORDER_STEP : 0;
  }

  // Accepts cards dragged in from any board. The source board has already
  // dropped them optimistically, so `restore` hands back whichever ones failed
  // instead of leaving a card that exists in neither place.
  async function receive({ cards, index = s.cards.length, restore }) {
    if (!s.ready || !cards.length) return;

    const at = Math.min(index, s.cards.length);
    s.cards.splice(at, 0, ...cards);
    s.pending += cards.length;

    const failed = [];
    await Promise.all(
      cards.map(async (card, i) => {
        const order = orderAt(at + i);
        try {
          await client.moveCard({
            card,
            toBoardId: s.board.id,
            toStackId: s.stack.id,
            order,
          });
          card.stackId = s.stack.id;
          card.order = order;
        } catch (e) {
          failed.push(card);
        } finally {
          s.pending -= 1;
        }
      })
    );

    if (failed.length) {
      s.cards = s.cards.filter((c) => !failed.includes(c));
      restore?.(failed);
    }
  }

  // Hands cards to a board stack. The caller owns the destination state, so the
  // PUT happens here and placement there.
  async function release({ cards, toBoardId, toStackId, order }) {
    s.cards = s.cards.filter((c) => !cards.includes(c));
    s.pending += cards.length;

    const failed = [];
    await Promise.all(
      cards.map(async (card, i) => {
        try {
          await client.moveCard({ card, toBoardId, toStackId, order: order + i });
        } catch {
          failed.push(card);
        } finally {
          s.pending -= 1;
        }
      })
    );

    if (failed.length) s.cards = [...s.cards, ...failed];
    return failed;
  }

  async function reorderWithin({ cards, index }) {
    const remaining = s.cards.filter((c) => !cards.includes(c));
    const at = Math.min(index ?? remaining.length, remaining.length);
    remaining.splice(at, 0, ...cards);
    s.cards = remaining;

    s.pending += cards.length;
    await Promise.all(
      cards.map(async (card) => {
        const order = s.cards.indexOf(card) * ORDER_STEP;
        try {
          await client.moveCard({
            card,
            toBoardId: s.board.id,
            toStackId: s.stack.id,
            order,
          });
          card.order = order;
        } catch {
          // Order is cosmetic within the inbox; a failed reorder self-corrects
          // on the next reload rather than yanking the card out from under the
          // pointer.
        } finally {
          s.pending -= 1;
        }
      })
    );
  }

  function cardsByIds(ids) {
    return s.cards.filter((c) => ids.includes(c.id));
  }

  return { state: s, init, reload, receive, release, reorderWithin, cardsByIds };
}
