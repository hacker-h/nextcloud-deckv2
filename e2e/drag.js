// External (OS-originated) drag helpers.
//
// Why this file exists: the previous drag tests called
// `locator.dispatchEvent('dragenter')` on card A, then on card B, and asserted
// the overlay moved. That can only ever pass. A synthetic dispatch fires
// exactly the one event named and nothing else, so it cannot reproduce the
// reported bug, which is about `dragleave` NOT firing as the pointer crosses
// child element boundaries during continuous motion. The test asserted the
// thing it had itself simulated.
//
// Two strategies, because no single one works everywhere:
//
//   cdpDrag   - Chromium only. Input.dispatchDragEvent drives the browser's own
//               drag pipeline, so the DOM sees the real dragenter/dragleave/
//               dragover sequence including the boundary events. This is the
//               only mechanism that can reproduce the stale-overlay bug.
//   syntheticDrag - Firefox/WebKit fallback. Spec-complete: one shared
//               DataTransfer for the whole gesture, dragenter and dragover both
//               cancelled (per the HTML spec a drop is only delivered if the
//               target cancels both), and every card boundary crossed in order.
//
// Both sample an assertion callback at every intermediate step, because a bug
// that only exists mid-gesture is invisible to endpoint-only assertions.

const LINK_MIME = 'text/uri-list';

/** Centre point of a locator, as CDP/mouse coordinates. */
export async function centre(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('centre: element has no bounding box (not visible?)');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function dragData({ url, files }) {
  if (files?.length) {
    return { items: files.map((f) => ({ mimeType: f.mimeType, data: f.data })), files: files.map((f) => f.name) };
  }
  return {
    items: [
      { mimeType: LINK_MIME, data: url },
      { mimeType: 'text/plain', data: url },
    ],
  };
}

/**
 * True browser-level drag through CDP. Chromium only.
 *
 * `points` is the full path: the gesture enters each point in order, so passing
 * five card centres crosses four real boundaries. `onStep` runs after every
 * dragOver and is where the "exactly one overlay" invariant is checked.
 */
export async function cdpDrag(page, points, { url, files, drop = true, onStep } = {}) {
  const client = await page.context().newCDPSession(page);
  const data = { ...dragData({ url, files }), dragOperationsMask: 1 };

  const first = points[0];
  await client.send('Input.dispatchDragEvent', {
    type: 'dragEnter',
    x: first.x,
    y: first.y,
    data,
  });
  if (onStep) await onStep(0, first);

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    // Two dragOver per point: the first carries the pointer into the element,
    // the second is the resting frame a real user produces. Bugs that need a
    // repeated event to surface (depth counters, for one) need both.
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: p.x, y: p.y, data });
    await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: p.x, y: p.y, data });
    if (onStep) await onStep(i, p);
  }

  const last = points[points.length - 1];
  if (drop) {
    await client.send('Input.dispatchDragEvent', { type: 'drop', x: last.x, y: last.y, data });
  } else {
    await client.send('Input.dispatchDragEvent', { type: 'dragCancel', x: last.x, y: last.y, data });
  }
  await client.detach();
}

/**
 * Spec-complete synthetic drag for engines without CDP.
 *
 * Shares one DataTransfer across the whole gesture, as a real drag does, and
 * cancels dragenter/dragover so the drop is actually delivered. Fires
 * dragleave on the previous element before dragenter on the next, which is the
 * ordering the browser guarantees and the ordering the buggy code relied on
 * never happening.
 */
export async function syntheticDrag(page, points, { url, files, drop = true, onStep } = {}) {
  await page.evaluate(
    ({ url, files }) => {
      const dt = new DataTransfer();
      if (files?.length) {
        for (const f of files) {
          dt.items.add(new File([f.data ?? 'mock'], f.name, { type: f.mimeType }));
        }
      } else {
        dt.setData('text/uri-list', url);
        dt.setData('text/plain', url);
      }
      window.__e2eDragTransfer = dt;
      window.__e2eDragPrev = null;
    },
    { url, files }
  );

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    await page.evaluate(
      ({ x, y }) => {
        const dt = window.__e2eDragTransfer;
        const target = document.elementFromPoint(x, y);
        const prev = window.__e2eDragPrev;
        const mk = (type, related) =>
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: x,
            clientY: y,
            dataTransfer: dt,
            relatedTarget: related ?? null,
          });

        if (prev && prev !== target && prev.isConnected) prev.dispatchEvent(mk('dragleave', target));
        if (target && prev !== target) target.dispatchEvent(mk('dragenter', prev));
        if (target) {
          target.dispatchEvent(mk('dragover'));
          target.dispatchEvent(mk('dragover'));
        }
        window.__e2eDragPrev = target;
      },
      { x: p.x, y: p.y }
    );
    if (onStep) await onStep(i, p);
  }

  const last = points[points.length - 1];
  await page.evaluate(
    ({ x, y, drop }) => {
      const dt = window.__e2eDragTransfer;
      const target = document.elementFromPoint(x, y);
      const mk = (type) =>
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          dataTransfer: dt,
        });
      if (target && drop) target.dispatchEvent(mk('drop'));
      (target ?? document.body).dispatchEvent(mk('dragend'));
      window.__e2eDragTransfer = null;
      window.__e2eDragPrev = null;
    },
    { x: last.x, y: last.y, drop }
  );
}

/**
 * Drags across `points` using the most faithful mechanism the current engine
 * supports. Prefer this in specs; reach for cdpDrag directly only when a test
 * is explicitly Chromium-only.
 */
export async function dragAcross(page, browserName, points, options = {}) {
  if (browserName === 'chromium') return cdpDrag(page, points, options);
  return syntheticDrag(page, points, options);
}

/** Centres of the first `count` cards, in board order — a natural drag path. */
export async function cardPath(page, count) {
  const cards = page.locator('.card');
  const total = await cards.count();
  const n = Math.min(count, total);
  const points = [];
  for (let i = 0; i < n; i++) points.push(await centre(cards.nth(i)));
  return points;
}
