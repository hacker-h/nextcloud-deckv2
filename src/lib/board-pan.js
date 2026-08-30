const DEFAULT_THRESHOLD = 6;

export function boardPan(node, initialOptions = {}) {
  let options = initialOptions;
  let gesture = null;
  let clickSuppressTimer = null;

  function removeWindowListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }

  function suppressTrailingClick() {
    const suppress = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener('click', suppress, { capture: true, once: true });
    clickSuppressTimer = window.setTimeout(() => {
      node.removeEventListener('click', suppress, { capture: true });
      clickSuppressTimer = null;
    }, 0);
  }

  function finish({ cancelled = false, release = true } = {}) {
    if (!gesture) return;
    const completed = gesture;
    gesture = null;
    removeWindowListeners();
    node.classList.remove('panning');

    if (release && node.hasPointerCapture?.(completed.pointerId)) {
      try {
        node.releasePointerCapture(completed.pointerId);
      } catch {
        // Pointer capture may already have been released by the browser.
      }
    }

    if (completed.dragging) suppressTrailingClick();
    else if (!cancelled) options.onBackgroundClick?.();
  }

  function onPointerMove(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const delta = event.clientX - gesture.startX;
    if (!gesture.dragging && Math.abs(delta) < (options.threshold ?? DEFAULT_THRESHOLD)) return;

    if (!gesture.dragging) {
      gesture.dragging = true;
      node.classList.add('panning');
      try {
        node.setPointerCapture?.(gesture.pointerId);
      } catch {
        // Window listeners keep the gesture alive when capture is unavailable.
      }
    }

    event.preventDefault();
    node.scrollLeft = gesture.startScrollLeft - delta;
  }

  function onPointerUp(event) {
    if (gesture && event.pointerId === gesture.pointerId) finish();
  }

  function onPointerCancel(event) {
    if (gesture && event.pointerId === gesture.pointerId) finish({ cancelled: true });
  }

  function onLostPointerCapture(event) {
    if (gesture && event.pointerId === gesture.pointerId) finish({ cancelled: true, release: false });
  }

  function onPointerDown(event) {
    if (
      event.target !== node ||
      event.button !== 0 ||
      event.isPrimary === false ||
      (event.pointerType && event.pointerType !== 'mouse') ||
      options.isBlocked?.()
    ) return;

    finish({ cancelled: true });
    gesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: node.scrollLeft,
      dragging: false,
    };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('lostpointercapture', onLostPointerCapture);

  return {
    update(nextOptions) {
      options = nextOptions;
    },
    destroy() {
      finish({ cancelled: true });
      if (clickSuppressTimer != null) window.clearTimeout(clickSuppressTimer);
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('lostpointercapture', onLostPointerCapture);
    },
  };
}
