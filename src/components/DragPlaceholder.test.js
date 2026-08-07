import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import Stack from './Stack.svelte';
import { drag, resetDrag, measureHeights } from '../lib/dnd.svelte.js';

const card = (id, title) => ({ id, title, stackId: 1 });

const stack = {
  id: 1,
  title: 'Doing',
  cards: [card(1, 'One'), card(2, 'Two'), card(3, 'Three'), card(4, 'Four')],
};

function beginDrag({ cardIds, heights, overIndex = 0 }) {
  drag.active = true;
  drag.cardIds = cardIds;
  drag.card = card(cardIds[0], 'One');
  drag.count = cardIds.length;
  drag.h = heights[0];
  drag.heights = heights;
  drag.overStack = stack.id;
  drag.overIndex = overIndex;
}

const slots = (container) => [...container.querySelectorAll('.placeholder')];

afterEach(() => resetDrag());

describe('drop placeholders', () => {
  it('opens one slot per dragged card', () => {
    beginDrag({ cardIds: [1, 2, 3], heights: [36, 36, 36] });

    const { container } = render(Stack, { props: { stack } });

    expect(slots(container)).toHaveLength(3);
  });

  it('opens a single slot for a single card', () => {
    beginDrag({ cardIds: [1], heights: [36] });

    const { container } = render(Stack, { props: { stack } });

    expect(slots(container)).toHaveLength(1);
  });

  it('sizes each slot to the card it will hold', () => {
    beginDrag({ cardIds: [1, 2, 3], heights: [36, 84, 52] });

    const { container } = render(Stack, { props: { stack } });

    expect(slots(container).map((el) => el.style.height)).toEqual(['36px', '84px', '52px']);
  });

  it('opens no slot in a lane the pointer has left', () => {
    beginDrag({ cardIds: [1, 2], heights: [36, 36] });
    drag.overStack = 999;

    const { container } = render(Stack, { props: { stack } });

    expect(slots(container)).toHaveLength(0);
  });

  it('appends the slots when dropping past the last card', () => {
    beginDrag({ cardIds: [1, 2], heights: [36, 36], overIndex: 2 });

    const { container } = render(Stack, { props: { stack } });
    const children = [...container.querySelectorAll('.placeholder, [data-card-id]')];

    expect(children.slice(-2).every((el) => el.classList.contains('placeholder'))).toBe(true);
    expect(slots(container)).toHaveLength(2);
  });

  it('hides the dragged cards so the slots take their place', () => {
    beginDrag({ cardIds: [1, 2], heights: [36, 36] });

    const { container } = render(Stack, { props: { stack } });
    const ids = [...container.querySelectorAll('[data-card-id]')].map((el) => el.dataset.cardId);

    expect(ids).toEqual(['3', '4']);
  });

  it('shows no slot at all when nothing is being dragged', () => {
    const { container } = render(Stack, { props: { stack } });

    expect(slots(container)).toHaveLength(0);
  });
});

describe('measureHeights', () => {
  it('measures each dragged card and falls back for anything unrendered', () => {
    document.body.innerHTML = `
      <div data-card-id="1"></div>
      <div data-card-id="2"></div>
    `;
    const nodes = document.querySelectorAll('[data-card-id]');
    nodes[0].getBoundingClientRect = () => ({ height: 36 });
    nodes[1].getBoundingClientRect = () => ({ height: 84 });

    expect(measureHeights([1, 2, 99], 36)).toEqual([36, 84, 36]);
    document.body.innerHTML = '';
  });
});
