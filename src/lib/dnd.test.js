import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { drag, draggable, resetDrag } from './dnd.svelte.js';

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
