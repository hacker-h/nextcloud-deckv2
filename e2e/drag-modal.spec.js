import { test, expect } from './hermetic.js';
import { dragAcross, centre } from './drag.js';

// Audit bug 3: dragging a file into the card detail modal lit up blue overlays
// on the board cards behind it. The modal stops propagation, but stopPropagation
// only silences the bubble phase - it cannot prevent the board's own state from
// having been set on a previous card, and it does nothing about a card that is
// still claiming the overlay from before the modal opened.

const LINK = 'https://example.com/dropped-link';

async function openFirstCard(page) {
  await page.locator('.card').first().click();
  const dialog = page.locator('[role="dialog"]').first();
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-testid="detail-skeleton"]')).toHaveCount(0);
  return dialog;
}

test.describe('external drag with the detail modal open', () => {
  test('dragging over the modal never lights a board card behind it', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const dialog = await openFirstCard(page);

    const point = await centre(dialog);
    const seen = [];

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async (i) => {
        seen.push({ step: i, board: await page.locator('.card-drop-overlay').count() });
      },
    });

    expect(
      seen.filter((s) => s.board !== 0),
      `no board card may show an overlay while the modal is open; got ${JSON.stringify(seen)}`
    ).toEqual([]);
  });

  test('the modal shows its own drop overlay', async ({ board, browserName }) => {
    const { page } = board;
    const dialog = await openFirstCard(page);
    const point = await centre(dialog);

    await dragAcross(page, browserName, [point], {
      url: LINK,
      drop: false,
      onStep: async () => {
        await expect(page.locator('.drop-overlay')).toBeVisible();
      },
    });
  });

  // The reported screenshot showed stuck overlays *underneath* an open modal,
  // which is what happens when a drag starts over a card and the modal appears
  // mid-gesture: the card never receives another event, so nothing clears it.
  test('a card overlay does not survive the modal opening mid-drag', async ({
    board,
    browserName,
  }) => {
    const { page } = board;
    const point = await centre(page.locator('.card').first());

    await dragAcross(page, browserName, [point], { url: LINK, drop: false });
    await openFirstCard(page);

    await expect(page.locator('.card-drop-overlay')).toHaveCount(0);
  });

  test('dropping a link on the modal attaches it and reports success', async ({
    board,
    browserName,
  }) => {
    const { page, backend } = board;
    const dialog = await openFirstCard(page);
    const point = await centre(dialog);

    await dragAcross(page, browserName, [point], { url: LINK, drop: true });

    await expect
      .poll(() => backend.find('/attachments', 'POST').length, {
        message: 'modal drop must POST an attachment',
      })
      .toBe(1);
    await expect(page.locator('.toast.success')).toBeVisible();
  });

  test('closing the modal leaves no overlay anywhere', async ({ board, browserName }) => {
    const { page } = board;
    const dialog = await openFirstCard(page);

    await dragAcross(page, browserName, [await centre(dialog)], { url: LINK, drop: false });
    await page.getByLabel('Kartendetails schließen').click();

    await expect(page.locator('.card-drop-overlay')).toHaveCount(0);
    await expect(page.locator('.drop-overlay')).toHaveCount(0);
  });
});
