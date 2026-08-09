import { test, expect } from './hermetic.js';
import { dragAcross, centre } from './drag.js';
import { assertOpaque } from './pixels.js';

// Screenshot baselines for the states that were reported as visually wrong.
// Every reported bug in the audit was something a person saw, so at least one
// assertion per bug has to be made against rendered pixels rather than against
// the DOM: getComputedStyle happily reports a background colour on an element
// that is fully transparent, behind another element, or clipped out of view.
//
// Baselines are per-engine and committed. maxDiffPixelRatio in the config
// tolerates font antialiasing without tolerating a colour or layout change.

const LINK = 'https://example.com/dropped-link';
const TROELLO_BLUE = [0, 87, 215];

test.describe('visual state of the drop overlay', () => {
  test('board with no drag in progress', async ({ board }) => {
    const { page } = board;
    await expect(page.locator('.board')).toHaveScreenshot('board-idle.png');
  });

  test('a single card under an active link drag', async ({ board, browserName }) => {
    const { page } = board;
    const card = page.locator('.card').first();
    const point = await centre(card);

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async () => {
        await expect(card).toHaveScreenshot('card-drag-link.png');
      },
    });
  });

  test('a single card under an active file drag', async ({ board, browserName }) => {
    const { page } = board;
    const card = page.locator('.card').first();
    const point = await centre(card);

    await dragAcross(page, browserName, [point], {
      files: [{ name: 'a.png', mimeType: 'image/png', data: 'x' }],
      drop: false,
      onStep: async () => {
        await expect(card).toHaveScreenshot('card-drag-file.png');
      },
    });
  });

  // The reported screenshot showed three cards lit at once. A whole-board
  // baseline is the only assertion that catches "one card too many", because a
  // per-card check passes on each card individually.
  test('mid-traverse, the whole board shows exactly one lit card', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const cards = page.locator('.card');
    const path = [await centre(cards.nth(0)), await centre(cards.nth(1)), await centre(cards.nth(2))];

    await dragAcross(page, browserName, path, {
      url: LINK,
      drop: false,
      onStep: async (i) => {
        if (i === path.length - 1) {
          await expect(page.locator('.board')).toHaveScreenshot('board-mid-drag.png');
        }
      },
    });
  });

  test('the overlay colour is the measured Trello blue in real pixels', async ({
    board,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'colour scan is calibrated on one engine');
    const { page } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async () => {
        await assertOpaque(page, '.card-drop-overlay', {
          expected: TROELLO_BLUE,
          exclude: ['.card-drop-overlay span'],
        });
      },
    });
  });
});

test.describe('visual state of the card detail modal', () => {
  test.beforeEach(async ({ board }) => {
    const { page } = board;
    await page.locator('.card').first().click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="detail-skeleton"]')).toHaveCount(0);
  });

  test('the modal renders without a duplicated sidebar', async ({ board }) => {
    const { page } = board;
    await expect(page.locator('[role="dialog"]').first()).toHaveScreenshot('detail-modal.png');
  });

  // Audit bug 4: the action pill row offered Labels and Datum while the sidebar
  // offered the same settings again a few hundred pixels away, and neither pill
  // did anything when clicked. Each setting must now have exactly one route.
  test('no setting is offered twice', async ({ board }) => {
    const { page } = board;
    const dialog = page.locator('[role="dialog"]').first();

    await expect(dialog.getByRole('button', { name: /^Labels$/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Datum$/ })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Labels bearbeiten' })).toHaveCount(1);
  });

  // Audit bug 5: `<input type="datetime-local">` is drawn by the OS. Its
  // calendar glyph and TT.MM.JJJJ placeholder ignore the dark theme entirely,
  // which is why it read as unstyled next to everything around it.
  test('the due date is a styled pill, not a native datetime input', async ({ board }) => {
    const { page } = board;
    const dialog = page.locator('[role="dialog"]').first();

    await expect(dialog.locator('input[type="datetime-local"]')).toHaveCount(0);

    const pill = dialog.getByLabel('Ablaufdatum');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveScreenshot('due-pill.png');
  });

  // Found by looking at the first generated baseline rather than by a failing
  // assertion: the bottom nav dock (z-index 45) painted over the modal backdrop
  // (40) and covered the comment composer. A screenshot is the only assertion
  // that catches "correct element, wrong layer".
  test('nothing paints over the open modal', async ({ board }) => {
    const { page } = board;
    const nav = page.locator('.dock');
    if ((await nav.count()) === 0) test.skip(true, 'no bottom nav rendered');

    const box = await nav.boundingBox();
    const covered = await page.evaluate(
      ({ x, y }) => {
        const stack = document.elementsFromPoint(x, y);
        const modalIndex = stack.findIndex((el) => el.classList?.contains('backdrop'));
        const navIndex = stack.findIndex((el) => el.classList?.contains('dock'));
        // Lower index means closer to the viewer.
        return navIndex !== -1 && (modalIndex === -1 || navIndex < modalIndex);
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    );

    expect(covered, 'the bottom nav must not sit above the open card modal').toBe(false);
  });

  test('the date picker popover opens from the pill', async ({ board }) => {
    const { page } = board;
    await page.getByLabel('Ablaufdatum').click();

    const popover = page.locator('.popover');
    await expect(popover).toBeVisible();
    await expect(popover).toHaveScreenshot('date-popover.png');
  });
});
