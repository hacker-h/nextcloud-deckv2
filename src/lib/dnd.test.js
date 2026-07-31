import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HYSTERESIS, drag, draggable, insertionIndex, resetDrag, stackFromPoint } from './dnd.svelte.js';

function pointer(type, { x = 100, y = 100, button = 0, shiftKey = false } = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
    shiftKey,
  });
}

function cardNode() {
  const node = document.createElement('div');
  node.dataset.cardId = '77';
  node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 40, right: 210, bottom: 60 });
  document.body.append(node);
  return node;
}

function stackNode() {
  const stack = document.createElement('section');
  stack.dataset.stackId = '9';
  const cards = document.createElement('div');
  cards.dataset.cards = '';
  stack.append(cards);
  document.body.append(stack);
  return stack;
}

// A stack whose element ends above the pointer, i.e. a short list with empty
// space beneath it. flex-start sizes lanes to their content, so nothing is
// under the cursor down there.
function shortStackNode({ id = 9, left = 0, right = 272, top = 0, bottom = 120 } = {}) {
  const stack = document.createElement('section');
  stack.dataset.stackId = String(id);
  stack.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top });
  const cards = document.createElement('div');
  cards.dataset.cards = '';
  cards.getBoundingClientRect = () => ({ left, right, top, bottom, width: right - left, height: bottom - top });
  stack.append(cards);
  document.body.append(stack);
  return stack;
}

function cardIn(list, { id, top, height = 40 }) {
  const el = document.createElement('div');
  el.dataset.cardId = String(id);
  el.getBoundingClientRect = () => ({ left: 0, right: 272, top, bottom: top + height, width: 272, height });
  list.append(el);
  return el;
}

function attach(node, overrides = {}) {
  const onActivate = vi.fn();
  const onSelect = vi.fn();
  const onDrop = vi.fn();
  const action = draggable(node, () => ({
    card: { id: 77, title: 'Card' },
    onActivate,
    onSelect,
    onDrop,
    ...overrides,
  }));
  return { action, onActivate, onSelect, onDrop };
}

function dispatchClick(node) {
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  const nativeClick = vi.fn();
  node.addEventListener('click', nativeClick);
  node.dispatchEvent(click);
  return { click, nativeClick };
}

beforeEach(() => {
  Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [] });
  vi.spyOn(document, 'elementsFromPoint').mockReturnValue([]);
});

afterEach(() => {
  resetDrag();
  document.body.style.cursor = '';
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('dropping into the empty space of a short list', () => {
  it('resolves a pointer below the last card to that lane instead of nothing', () => {
    const stack = shortStackNode({ id: 9, left: 0, right: 272, top: 0, bottom: 120 });

    // Pointer is inside the lane horizontally but 300px down, well past the
    // element's bottom edge - exactly where a short list has empty space.
    expect(stackFromPoint(100, 300)).toBe(stack);
  });

  it('ignores a pointer outside the lane horizontally', () => {
    shortStackNode({ id: 9, left: 0, right: 272, top: 0, bottom: 120 });

    expect(stackFromPoint(600, 300)).toBeNull();
  });

  it('drops into an empty lane when released below its last card', () => {
    const node = cardNode();
    const stack = shortStackNode({ id: 9 });
    // elementsFromPoint sees nothing: the lane simply is not that tall.
    document.elementsFromPoint.mockReturnValue([]);
    const { onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown', { x: 100, y: 300 }));
    window.dispatchEvent(pointer('pointermove', { x: 100, y: 320 }));
    window.dispatchEvent(pointer('pointerup', { x: 100, y: 320 }));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0]).toMatchObject({ cardIds: [77], toStackId: 9 });
    expect(stack.dataset.stackId).toBe('9');
  });
});

describe('insertion hysteresis', () => {
  it('keeps a deadband wide enough to absorb hand tremor', () => {
    expect(HYSTERESIS).toBeGreaterThanOrEqual(4);
  });

  it('holds the committed slot until the pointer clears the midpoint by a margin', () => {
    const stack = shortStackNode({ id: 9 });
    const list = stack.querySelector('[data-cards]');
    cardIn(list, { id: 1, top: 0 });    // midpoint 20
    cardIn(list, { id: 2, top: 50 });   // midpoint 70

    // With no committed slot the raw midpoint decides.
    expect(insertionIndex(list, 21, [])).toBe(1);

    // Sitting 1px past the midpoint must NOT flip away from slot 1.
    expect(insertionIndex(list, 21, [], 1, HYSTERESIS)).toBe(1);
    expect(insertionIndex(list, 19, [], 1, HYSTERESIS)).toBe(1);

    // Clearing the margin commits the change. Slot 2 lies past card 2's
    // midpoint (70), so the pointer must reach 78 - not merely leave slot 1.
    expect(insertionIndex(list, 79, [], 1, HYSTERESIS)).toBe(2);
    expect(insertionIndex(list, 11, [], 1, HYSTERESIS)).toBe(0);
  });

  it('does not let sub-pixel jitter around a boundary change the slot', () => {
    const stack = shortStackNode({ id: 9 });
    const list = stack.querySelector('[data-cards]');
    cardIn(list, { id: 1, top: 0 });

    const seen = new Set();
    for (const y of [19.6, 20.1, 19.8, 20.4, 19.9, 20.2]) {
      seen.add(insertionIndex(list, y, [], 1, HYSTERESIS));
    }

    expect([...seen]).toEqual([1]);
  });
});

describe('draggable pointer gesture arbitration', () => {
  it('activates exactly once on a 0px primary click and suppresses the native follow-up click', () => {
    const node = cardNode();
    const { onActivate, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointerup'));
    const { click, nativeClick } = dispatchClick(node);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0][0]).toMatchObject({ card: { id: 77 }, shiftKey: false });
    expect(onDrop).not.toHaveBeenCalled();
    expect(nativeClick).not.toHaveBeenCalled();
    expect(click.defaultPrevented).toBe(true);
  });

  it('keeps 4.9px jitter below the measured threshold as activation', () => {
    const node = cardNode();
    const { onActivate, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointermove', { x: 104.9, y: 100 }));
    window.dispatchEvent(pointer('pointerup', { x: 104.9, y: 100 }));

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onDrop).not.toHaveBeenCalled();
    expect(drag.active).toBe(false);
  });

  it('treats a 5px move as drag and never activates', () => {
    const node = cardNode();
    const stack = stackNode();
    document.elementsFromPoint.mockReturnValue([stack]);
    const { onActivate, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointermove', { x: 105, y: 100 }));
    window.dispatchEvent(pointer('pointerup', { x: 105, y: 100 }));

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop.mock.calls[0][0]).toMatchObject({ cardIds: [77], toStackId: 9 });
  });

  it('reserves Shift-click for selection and never activates', () => {
    const node = cardNode();
    const { onActivate, onSelect, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown', { shiftKey: true }));
    window.dispatchEvent(pointer('pointerup', { shiftKey: true }));

    expect(onActivate).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ card: { id: 77 }, shiftKey: true });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('cancels without activation and resets state and cursor', () => {
    const node = cardNode();
    const { onActivate, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointermove', { x: 105, y: 100 }));
    expect(drag.active).toBe(true);
    expect(document.body.style.cursor).toBe('grabbing');

    window.dispatchEvent(pointer('pointercancel', { x: 105, y: 100 }));

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(drag.active).toBe(false);
    expect(document.body.style.cursor).toBe('');
  });

  it('drops on an invalid target without activation or drop callback', () => {
    const node = cardNode();
    const { onActivate, onDrop } = attach(node);

    node.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointermove', { x: 105, y: 100 }));
    window.dispatchEvent(pointer('pointerup', { x: 105, y: 100 }));

    expect(onActivate).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    expect(drag.active).toBe(false);
    expect(document.body.style.cursor).toBe('');
  });

  it('suppresses the duplicate native click after both activation and drag paths', () => {
    const clickNode = cardNode();
    const { onActivate } = attach(clickNode);
    clickNode.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointerup'));
    const clickPath = dispatchClick(clickNode);

    const dragNode = cardNode();
    const stack = stackNode();
    document.elementsFromPoint.mockReturnValue([stack]);
    const { onActivate: dragActivate, onDrop } = attach(dragNode);
    dragNode.dispatchEvent(pointer('pointerdown'));
    window.dispatchEvent(pointer('pointermove', { x: 105, y: 100 }));
    window.dispatchEvent(pointer('pointerup', { x: 105, y: 100 }));
    const dragPath = dispatchClick(dragNode);

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(clickPath.nativeClick).not.toHaveBeenCalled();
    expect(clickPath.click.defaultPrevented).toBe(true);
    expect(dragActivate).not.toHaveBeenCalled();
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(dragPath.nativeClick).not.toHaveBeenCalled();
    expect(dragPath.click.defaultPrevented).toBe(true);
  });
});
