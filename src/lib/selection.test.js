import { describe, expect, it } from 'vitest';
import { applyCardClick, applyShiftClick, emptySelection, isSelected, orderedSelection } from './selection.js';

const STACK_A = 1;
const STACK_B = 2;
const A = [10, 11, 12, 13, 14, 15];

function shift(selection, cardId, stackId = STACK_A, stackCardIds = A) {
  return applyShiftClick(selection, { cardId, stackId, stackCardIds });
}

describe('plain click selection mode', () => {
  it('signals openDetail when selection is empty', () => {
    const res = applyCardClick(emptySelection(), { cardId: 12, stackId: STACK_A, stackCardIds: A });
    expect(res.openDetail).toBe(true);
  });

  it('toggles selection and suppresses detail when selection is non-empty', () => {
    const s1 = shift(emptySelection(), 12);
    const res = applyCardClick(s1, { cardId: 14, stackId: STACK_A, stackCardIds: A });
    expect(res.openDetail).toBe(false);
    expect(res.selection.ids).toEqual([12, 14]);

    const res2 = applyCardClick(res.selection, { cardId: 12, stackId: STACK_A, stackCardIds: A });
    expect(res2.openDetail).toBe(false);
    expect(res2.selection.ids).toEqual([14]);

    const res3 = applyCardClick(res2.selection, { cardId: 14, stackId: STACK_A, stackCardIds: A });
    expect(res3.openDetail).toBe(false);
    expect(res3.selection.ids).toEqual([]);
  });
});

describe('shift+click selection (PLAN.md §6, measured from Trello)', () => {
  it('selects a single card and makes it the anchor when nothing is selected', () => {
    const s = shift(emptySelection(), 12);

    expect(s.ids).toEqual([12]);
    expect(s.anchor).toBe(12);
  });

  it('selects the whole range when shift+clicking another card in the same stack', () => {
    const s = shift(shift(emptySelection(), 12), 15);

    expect(s.ids).toEqual([12, 13, 14, 15]);
  });

  it('unions rather than replaces when shift+clicking backwards past the anchor', () => {
    const s = shift(shift(shift(emptySelection(), 12), 15), 10);

    expect(s.ids.slice().sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15]);
  });

  it('toggles a single card off when shift+clicking an already-selected card', () => {
    const s = shift(shift(shift(emptySelection(), 12), 15), 13);

    expect(s.ids).toEqual([12, 14, 15]);
  });

  it('adds only the clicked card when shift+clicking into a different stack', () => {
    const ranged = shift(shift(emptySelection(), 12), 15);

    const s = applyShiftClick(ranged, { cardId: 20, stackId: STACK_B, stackCardIds: [20, 21, 22] });

    expect(s.ids).toEqual([12, 13, 14, 15, 20]);
    expect(s.anchor).toBe(20);
  });

  it('never spans stacks even when the next shift+click extends in the new stack', () => {
    const crossed = applyShiftClick(shift(emptySelection(), 12), {
      cardId: 20,
      stackId: STACK_B,
      stackCardIds: [20, 21, 22],
    });

    const s = applyShiftClick(crossed, { cardId: 22, stackId: STACK_B, stackCardIds: [20, 21, 22] });

    expect(s.ids).toEqual([12, 20, 21, 22]);
  });

  it('reproduces the exact sequence documented in PLAN.md §6', () => {
    let s = shift(emptySelection(), 12);
    expect(s.ids).toEqual([12]);

    s = shift(s, 15);
    expect(s.ids).toEqual([12, 13, 14, 15]);

    s = shift(s, 10);
    expect(s.ids.slice().sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15]);

    s = shift(s, 13);
    expect(s.ids).not.toContain(13);
    expect(s.ids).toHaveLength(5);
  });
});

describe('selection helpers', () => {
  it('reports membership', () => {
    const s = shift(emptySelection(), 12);

    expect(isSelected(s, 12)).toBe(true);
    expect(isSelected(s, 13)).toBe(false);
  });

  it('orders a selection by board position, not click order', () => {
    const stacks = [
      { id: STACK_A, cards: [{ id: 10 }, { id: 11 }, { id: 12 }] },
      { id: STACK_B, cards: [{ id: 20 }, { id: 21 }] },
    ];
    const selection = { ids: [21, 10, 12], anchor: 21, anchorStackId: STACK_B };

    expect(orderedSelection(selection, stacks)).toEqual([10, 12, 21]);
  });

  it('treats an empty selection as empty', () => {
    expect(orderedSelection(emptySelection(), [])).toEqual([]);
    expect(isSelected(emptySelection(), 1)).toBe(false);
  });
});
