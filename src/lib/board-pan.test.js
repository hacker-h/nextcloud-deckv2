import { afterEach, describe, expect, it, vi } from 'vitest';
import { boardPan } from './board-pan.js';

function pointer(type, init = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, button: init.button ?? 0 });
  Object.defineProperties(event, {
    pointerId: { value: init.pointerId ?? 1 },
    pointerType: { value: init.pointerType ?? 'mouse' },
    isPrimary: { value: init.isPrimary ?? true },
  });
  return event;
}

function setup(options = {}) {
  const node = document.createElement('div');
  node.scrollLeft = 100;
  document.body.append(node);
  const action = boardPan(node, options);
  return { node, action };
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('board background panning', () => {
  it('scrolls after the pointer crosses the drag threshold', () => {
    const { node } = setup();

    node.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 70 }));

    expect(node.scrollLeft).toBe(130);
    expect(node).toHaveClass('panning');
  });

  it('keeps a short background press as the existing clear-selection click', () => {
    const onBackgroundClick = vi.fn();
    const { node } = setup({ onBackgroundClick });

    node.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 96 }));
    window.dispatchEvent(pointer('pointerup', { clientX: 96 }));

    expect(node.scrollLeft).toBe(100);
    expect(onBackgroundClick).toHaveBeenCalledOnce();
  });

  it('ignores pointerdowns from descendants', () => {
    const child = document.createElement('button');
    const { node } = setup();
    node.append(child);

    child.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 20 }));
    expect(node.scrollLeft).toBe(100);
  });

  it('leaves touch panning to the native scroll container', () => {
    const { node } = setup();

    node.dispatchEvent(pointer('pointerdown', { clientX: 100, pointerType: 'touch' }));
    window.dispatchEvent(pointer('pointermove', { clientX: 20, pointerType: 'touch' }));
    expect(node.scrollLeft).toBe(100);
  });

  it('does not pan while a card drag is active', () => {
    const { node } = setup({ isBlocked: () => true });

    node.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 20 }));
    expect(node.scrollLeft).toBe(100);
  });

  it('cleans up a cancelled drag without clearing selection', () => {
    const onBackgroundClick = vi.fn();
    const { node } = setup({ onBackgroundClick });

    node.dispatchEvent(pointer('pointerdown', { clientX: 100 }));
    window.dispatchEvent(pointer('pointermove', { clientX: 70 }));
    window.dispatchEvent(pointer('pointercancel', { clientX: 70 }));

    expect(node).not.toHaveClass('panning');
    expect(onBackgroundClick).not.toHaveBeenCalled();
  });
});
