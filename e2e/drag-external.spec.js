import { test, expect } from './hermetic.js';
import { dragAcross, cardPath, centre } from './drag.js';
import { assertOpaque } from './pixels.js';

// The three bugs reported from the live site, each written so that it FAILS
// against the buggy build. The previous version of this suite passed against
// that same build, which is the only reason these tests exist.

const LINK = 'https://example.com/dropped-link';
const TROELLO_BLUE = [0, 87, 215];
const NEUTRAL_TOAST = 'rgb(40, 46, 51)';
const ERROR_TOAST = 'rgb(93, 31, 26)';

async function expectBottomLeftToast(page, toast) {
  await expect(toast).toBeVisible();

  const layout = await toast.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      bottom: window.innerHeight - rect.bottom,
      left: rect.left,
      position: style.position,
      transform: style.transform,
    };
  });

  expect(layout.position).toBe('fixed');
  expect(layout.left).toBeCloseTo(24, 0);
  expect(layout.bottom).toBeCloseTo(24, 0);
  expect(layout.transform).toBe('none');

  const dock = page.locator('.dock');
  await expect(dock).toHaveCount(1);
  const [toastBox, dockBox] = await Promise.all([toast.boundingBox(), dock.boundingBox()]);
  expect(toastBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(
    toastBox.x + toastBox.width <= dockBox.x || toastBox.x >= dockBox.x + dockBox.width,
    'toast must not overlap the bottom navigation dock'
  ).toBe(true);
}

test.describe('external drag onto board cards', () => {
  test('exactly one overlay exists at every point of a five-card traverse', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const points = await cardPath(page, 5);
    expect(points.length, 'need 5 cards to reproduce the reported bug').toBe(5);

    const overlays = page.locator('.card-drop-overlay');
    const seen = [];

    await dragAcross(page, browserName, points, {
      url: LINK,
      drop: false,
      // The bug lives between the endpoints: dragging 1→2→3→4→5 left an overlay
      // stuck on every card passed. Sampling only at the end cannot see it.
      onStep: async (i) => {
        seen.push({ step: i, count: await overlays.count() });
      },
    });

    const bad = seen.filter((s) => s.count !== 1);
    expect(
      bad,
      `overlay count must be exactly 1 at every step; got ${JSON.stringify(seen)}`
    ).toEqual([]);
  });

  test('no overlay survives the end of the gesture', async ({ board, browserName }) => {
    const { page } = board;
    const points = await cardPath(page, 5);

    await dragAcross(page, browserName, points, { url: LINK, drop: true });

    await expect(page.locator('.card-drop-overlay')).toHaveCount(0);
  });

  test('a cancelled drag also clears every overlay', async ({ board, browserName }) => {
    const { page } = board;
    const points = await cardPath(page, 4);

    await dragAcross(page, browserName, points, { url: LINK, drop: false });

    await expect(page.locator('.card-drop-overlay')).toHaveCount(0);
  });

  // Found by instrumenting a real CDP drag rather than by reading the code: the
  // pointer leaving a card for empty board background fires dragleave with
  // relatedTarget = .board, not null, so the "left the window" check never ran
  // and the overlay stayed lit until reload. This is the most likely path by
  // which the reported stale overlays were produced.
  test('dragging off a card onto empty board background clears the overlay', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const card = await centre(page.locator('.card').first());
    const box = await page.locator('.board').boundingBox();
    const empty = { x: box.x + box.width - 20, y: box.y + box.height - 20 };

    await dragAcross(page, browserName, [card, empty], { url: LINK, drop: false });

    await expect(page.locator('.card-drop-overlay')).toHaveCount(0);
  });

  test('dropping a link fires the attachment request and both toasts', async ({
    board,
    browserName,
  }) => {
    const { page, backend } = board;
    const target = page.locator('.card').first();
    const point = await centre(target);

    await dragAcross(page, browserName, [point], { url: LINK, drop: true });

    // The old test asserted only that *a* toast appeared. A drop that shows a
    // toast and then silently does nothing is exactly the reported bug, so the
    // request itself is the assertion that matters.
    await expect
      .poll(() => backend.find('/attachments', 'POST').length, {
        message: 'link drop must POST an attachment',
      })
      .toBe(1);

    const toast = page.locator('.toast.success');
    await expectBottomLeftToast(page, toast);
    await expect(toast).toContainText('Erfolgreich');
    await expect(toast).toHaveCSS('background-color', NEUTRAL_TOAST);
    await expect(page).toHaveScreenshot('tile-link-success-toast.png');
  });

  test('dropping a file fires the upload request', async ({ board, browserName }) => {
    const { page, backend } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], {
      files: [{ name: 'shot.png', mimeType: 'image/png', data: 'not-really-a-png' }],
      drop: true,
    });

    await expect
      .poll(() => backend.find('/attachments', 'POST').length, {
        message: 'file drop must POST an attachment',
      })
      .toBe(1);
    await expect(page.locator('.toast.success')).toBeVisible();
  });

  test('a failed drop surfaces an error toast and does not claim success', async ({
    board,
    browserName,
  }) => {
    const { page, backend } = board;
    backend.failNext = '/attachments';
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], { url: LINK, drop: true });

    const toast = page.locator('.toast.error');
    await expectBottomLeftToast(page, toast);
    await expect(toast).toHaveCSS('background-color', ERROR_TOAST);
    await expect(page.locator('.toast.success')).toHaveCount(0);
  });

  test('the overlay labels a link drag as a link, not a file upload', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async () => {
        await expect(page.locator('.card-drop-overlay')).toHaveText('Link anhängen');
      },
    });
  });

  test('the overlay labels a file drag as a file upload', async ({ board, browserName }) => {
    const { page } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], {
      files: [{ name: 'a.png', mimeType: 'image/png', data: 'x' }],
      drop: false,
      onStep: async () => {
        await expect(page.locator('.card-drop-overlay')).toHaveText('Dateien für Upload ablegen.');
      },
    });
  });

  // Computed style says nothing about what reached the screen: a translucent
  // ancestor, a stacking context, or a sibling can change the rendered result
  // while backgroundColor stays identical. The repo already learned this when a
  // dropdown passed an elementsFromPoint check while being see-through.
  test('the drop overlay is opaque in rendered pixels, not just in computed style', async ({
    board,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'pixel scan is calibrated on one engine');
    const { page } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async () => {
        await assertOpaque(page, '.card-drop-overlay', {
          expected: TROELLO_BLUE,
          // The label text is legitimately a different colour.
          exclude: ['.card-drop-overlay span'],
        });
      },
    });
  });
});
