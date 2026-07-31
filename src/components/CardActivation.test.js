import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Stack from './Stack.svelte';

const stack = {
  id: 9,
  title: 'Doing',
  cards: [
    { id: 10193, title: 'Card detail QA', stackId: 9, labels: [] },
    { id: 10194, title: 'Second card', stackId: 9, labels: [] },
  ],
};

function setup() {
  const onOpenCard = vi.fn();
  const onDrop = vi.fn();
  render(Stack, { props: { stack, onDrop, onOpenCard } });
  return { onOpenCard, onDrop };
}

const tile = (id) => document.querySelector(`[data-card-id="${id}"]`);

// jsdom has no PointerEvent constructor, so the gesture layer is driven with
// MouseEvents exactly as the dnd unit tests do.
function pointer(type, { x = 0, y = 0, shiftKey = false } = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    shiftKey,
  });
}

const press = (node, opts) => fireEvent(node, pointer('pointerdown', opts));
const move = (x, y) => fireEvent(window, pointer('pointermove', { x, y }));
const release = (x, y, opts = {}) => fireEvent(window, pointer('pointerup', { x, y, ...opts }));

beforeEach(() => {
  // jsdom has no hit testing; the gesture layer calls this on every release.
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('card activation wiring', () => {
  it('opens exactly one card on a plain click', async () => {
    const { onOpenCard } = setup();

    await press(tile(10193), { x: 10, y: 10 });
    await release(10, 10);

    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard.mock.calls[0][0].card.id).toBe(10193);
  });

  it('opens the clicked card, not a sibling', async () => {
    const { onOpenCard } = setup();

    await press(tile(10194), { x: 10, y: 10 });
    await release(10, 10);

    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard.mock.calls[0][0].card.id).toBe(10194);
  });

  it('opens nothing when the gesture exceeds the drag threshold', async () => {
    const { onOpenCard } = setup();

    await press(tile(10193), { x: 10, y: 10 });
    await move(30, 10);
    await release(30, 10);

    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it('opens nothing on Shift-click', async () => {
    const { onOpenCard } = setup();

    await press(tile(10193), { x: 10, y: 10, shiftKey: true });
    await release(10, 10, { shiftKey: true });

    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it('opens the focused card on Enter and on Space', async () => {
    const { onOpenCard } = setup();

    await fireEvent.keyDown(tile(10193), { key: 'Enter' });
    await fireEvent.keyDown(tile(10193), { key: ' ' });

    expect(onOpenCard).toHaveBeenCalledTimes(2);
    expect(onOpenCard.mock.calls.every((c) => c[0].card.id === 10193)).toBe(true);
  });

  it('ignores unrelated keys', async () => {
    const { onOpenCard } = setup();

    await fireEvent.keyDown(tile(10193), { key: 'a' });
    await fireEvent.keyDown(tile(10193), { key: 'Tab' });

    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it('exposes each card as a focusable control named by its title', () => {
    setup();

    const card = tile(10193);
    expect(card).toHaveAttribute('role', 'button');
    expect(card).toHaveAttribute('tabindex', '0');
    expect(card).toHaveAccessibleName('Card detail QA');
  });
});
