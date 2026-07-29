// Drag & drop engine.
//
// Pointer events, NOT the native HTML5 drag API. Trello uses Atlassian
// Pragmatic DnD over native HTML5 drag, but native drag cannot be driven by
// synthetic pointer events - which would make our own Playwright E2E tests
// impossible (verified: probes at 1-8px produced no drag). Pointer events also
// give full control over the drag preview and work identically on touch.
// See TRELLO-UX-SPEC.md section 3.

const THRESHOLD = 5; // px before a click becomes a drag

export const drag = $state({
  active: false,
  cardIds: [],        // cards being dragged (multi-select ready)
  card: null,         // primary card, for the preview
  count: 1,
  w: 0,
  h: 0,
  grabX: 0,           // pointer offset inside the card, so it doesn't jump
  grabY: 0,
  x: 0,
  y: 0,
  overStack: null,    // stack id under the pointer
  overIndex: null,    // insertion index within that stack
});

export function resetDrag() {
  drag.active = false;
  drag.cardIds = [];
  drag.card = null;
  drag.overStack = null;
  drag.overIndex = null;
}

// Returns the insertion index for a pointer position within a stack element,
// using each card's vertical midpoint. Cards being dragged are skipped so the
// placeholder does not fight with the source gap.
export function insertionIndex(stackEl, clientY, draggingIds) {
  const cards = [...stackEl.querySelectorAll('[data-card-id]')].filter(
    (el) => !draggingIds.includes(Number(el.dataset.cardId))
  );
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return i;
  }
  return cards.length;
}

// The in-flight gesture. Module scope on purpose: as soon as a drag starts the
// source card is filtered out of its stack, so Svelte destroys its component. If
// the pointermove/pointerup listeners lived on that node they would be torn
// down with it, freezing the drag on its first frame and never delivering the
// drop (verified with Playwright). The gesture must outlive the element that
// began it.
let g = null;

function onMove(e) {
  if (!g) return;

  if (!g.moved) {
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < THRESHOLD) return;
    g.moved = true;
    drag.active = true;
    drag.card = g.card;
    drag.cardIds = g.cardIds;
    drag.count = g.cardIds.length;
    drag.w = g.w;
    drag.h = g.h;
    drag.grabX = g.grabX;
    drag.grabY = g.grabY;
    document.body.style.cursor = 'grabbing';
  }

  drag.x = e.clientX;
  drag.y = e.clientY;

  // Hit-test stacks. elementsFromPoint sees through the preview because the
  // preview is pointer-events:none.
  const stackEl = document
    .elementsFromPoint(e.clientX, e.clientY)
    .find((el) => el.dataset?.stackId);

  if (stackEl) {
    drag.overStack = Number(stackEl.dataset.stackId);
    const list = stackEl.querySelector('[data-cards]') ?? stackEl;
    drag.overIndex = insertionIndex(list, e.clientY, drag.cardIds);
  } else {
    drag.overStack = null;
    drag.overIndex = null;
  }
}

function onUp() {
  if (!g) return;
  const gesture = g;
  g = null;

  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  document.body.style.cursor = '';

  if (!gesture.moved) { resetDrag(); return; }

  // Swallow the click that follows a drag, or the card opens in Deck. It has to
  // be caught on the window, because the source node no longer exists.
  const kill = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  window.addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 0);

  const toStackId = drag.overStack;
  const index = drag.overIndex;
  const cardIds = [...drag.cardIds];
  resetDrag();
  if (toStackId != null) gesture.onDrop({ cardIds, toStackId, index });
}

// Attaches drag behaviour to a card element. onDrop receives
// {cardIds, toStackId, index}.
export function draggable(node, opts) {
  function down(e) {
    // Left button only, and never start a second gesture.
    if (e.button !== 0 || g) return;

    const r = node.getBoundingClientRect();
    const o = opts();
    g = {
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      card: o.card,
      cardIds: o.cardIds ?? [o.card.id],
      onDrop: o.onDrop,
      w: r.width,
      h: r.height,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  // Cards are anchors; the browser's own link dragging would hijack the gesture.
  function nativeDrag(e) { e.preventDefault(); }

  node.addEventListener('pointerdown', down);
  node.addEventListener('dragstart', nativeDrag);
  return {
    destroy() {
      node.removeEventListener('pointerdown', down);
      node.removeEventListener('dragstart', nativeDrag);
      // Deliberately leaves the window listeners alone: this node is destroyed
      // as a side effect of starting the drag.
    },
  };
}
