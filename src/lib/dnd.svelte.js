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

// Edge auto-scroll. Without it any lane outside the viewport is simply
// unreachable by dragging - on the test board 6 of 10 lanes were off-screen.
// Trello scrolls the board horizontally and the hovered list vertically once
// the pointer comes within a margin of an edge, accelerating as it gets closer.
const EDGE = 64;        // px from an edge where scrolling kicks in
const MAX_SPEED = 18;   // px per frame at the very edge

let raf = 0;

function edgeVelocity(pos, min, max) {
  if (pos < min + EDGE) return -MAX_SPEED * Math.min(1, (min + EDGE - pos) / EDGE);
  if (pos > max - EDGE) return MAX_SPEED * Math.min(1, (pos - (max - EDGE)) / EDGE);
  return 0;
}

function scrollTick() {
  if (!drag.active) { raf = 0; return; }

  const board = document.querySelector('[data-board]');
  if (board) {
    const r = board.getBoundingClientRect();
    const vx = edgeVelocity(drag.x, r.left, r.right);
    if (vx) board.scrollLeft += vx;
  }

  // Vertical scrolling applies to the list under the cursor, not the board.
  const list = document
    .elementsFromPoint(drag.x, drag.y)
    .find((el) => el.hasAttribute?.('data-cards'));
  if (list && list.scrollHeight > list.clientHeight) {
    const r = list.getBoundingClientRect();
    const vy = edgeVelocity(drag.y, r.top, r.bottom);
    if (vy) list.scrollTop += vy;
  }

  raf = requestAnimationFrame(scrollTick);
}

function startAutoScroll() {
  if (!raf) raf = requestAnimationFrame(scrollTick);
}

function stopAutoScroll() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

// The in-flight gesture. Module scope on purpose: as soon as a drag starts the
// source card is filtered out of its stack, so Svelte destroys its component. If
// the pointermove/pointerup listeners lived on that node they would be torn
// down with it, freezing the drag on its first frame and never delivering the
// drop (verified with Playwright). The gesture must outlive the element that
// began it.
let g = null;

function swallowNextClick() {
  const kill = (ev) => { ev.preventDefault(); ev.stopPropagation(); };
  window.addEventListener('click', kill, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', kill, { capture: true }), 0);
}

function modifierContext(event) {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

function gestureContext(gesture, event) {
  return {
    card: gesture.card,
    cardIds: [...gesture.cardIds],
    event,
    ...modifierContext(event),
    shiftKey: gesture.shiftKey || event.shiftKey,
  };
}

function finishGesture() {
  const gesture = g;
  g = null;

  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  document.body.style.cursor = '';
  stopAutoScroll();
  return gesture;
}

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
    startAutoScroll();
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

function onCancel() {
  if (!g) return;
  finishGesture();
  resetDrag();
}

function onUp(e) {
  if (!g) return;
  const gesture = finishGesture();

  if (!gesture.moved) {
    resetDrag();
    swallowNextClick();
    const context = gestureContext(gesture, e);
    const select = gesture.onSelect ?? gesture.onSelectReserved;
    if (context.shiftKey) select?.(context);
    else gesture.onActivate?.(context);
    return;
  }

  // Browser click synthesis happens after pointerup; drag has already consumed it.
  swallowNextClick();

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
    if (e.button !== 0 || e.isPrimary === false || g) return;

    const r = node.getBoundingClientRect();
    const o = opts();
    g = {
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      card: o.card,
      cardIds: o.cardIds ?? [o.card.id],
      onActivate: o.onActivate,
      onSelect: o.onSelect,
      onSelectReserved: o.onSelectReserved,
      onDrop: o.onDrop,
      shiftKey: e.shiftKey,
      w: r.width,
      h: r.height,
      grabX: e.clientX - r.left,
      grabY: e.clientY - r.top,
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
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
