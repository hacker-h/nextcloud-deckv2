// Shift+click selection semantics, measured from Trello (TRELLO-UX-SPEC.md).
// Shift is the only modifier: Cmd/Ctrl+click opens a browser tab before the page
// sees the event, so it is not implementable and Trello does not use it.

export function emptySelection() {
  return { ids: [], anchor: null, anchorStackId: null };
}

export function applyShiftClick(selection, { cardId, stackId, stackCardIds }) {
  const ids = selection.ids ?? [];

  // Toggling off never moves the anchor: Trello keeps extending from the
  // original anchor after a card is removed from the middle of a range.
  if (ids.includes(cardId)) {
    return { ...selection, ids: ids.filter((id) => id !== cardId) };
  }

  const sameStack = selection.anchorStackId === stackId;
  const anchorIndex = sameStack ? stackCardIds.indexOf(selection.anchor) : -1;
  const targetIndex = stackCardIds.indexOf(cardId);

  if (anchorIndex === -1 || targetIndex === -1) {
    return { ids: [...ids, cardId], anchor: cardId, anchorStackId: stackId };
  }

  const from = Math.min(anchorIndex, targetIndex);
  const to = Math.max(anchorIndex, targetIndex);
  const range = stackCardIds.slice(from, to + 1);

  // Union, not replacement: shift+clicking backwards past the anchor keeps the
  // existing range and adds the new one.
  const merged = [...ids];
  for (const id of range) if (!merged.includes(id)) merged.push(id);

  return { ids: merged, anchor: selection.anchor, anchorStackId: stackId };
}

export function isSelected(selection, cardId) {
  return (selection.ids ?? []).includes(cardId);
}

// Orders a selection by its on-board position so a bulk move preserves the
// relative order the user sees, rather than click order.
export function orderedSelection(selection, stacks) {
  const ids = selection.ids ?? [];
  const ordered = [];
  for (const stack of stacks) {
    for (const card of stack.cards ?? []) {
      if (ids.includes(card.id)) ordered.push(card.id);
    }
  }
  return ordered;
}
