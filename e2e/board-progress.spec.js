import { test, expect } from './hermetic.js';

// The user's complaint was that a slow board load looked identical to a broken
// one: bare skeletons, no statement of what was being fetched or for how long.
// The mock backend answers instantly, so these specs slow the stacks endpoint
// down deliberately — the indicators only exist for the slow case.
async function slowStacks(page, ms) {
  await page.route(/\/api\/deck\/boards\/\d+\/stacks$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });
}

test('the active board load names the board and reports elapsed time', async ({ page, backend }) => {
  await slowStacks(page, 2500);
  await page.goto('/');

  const active = page.getByRole('progressbar', { name: 'Ladefortschritt des aktuellen Boards' });
  await expect(active).toBeVisible();

  // The board opened first is whichever the switcher's own ordering picks, so
  // the assertion is that the strip names *that* board - the point is that a
  // slow load is never ambiguous about which board it is waiting on.
  const opened = await active.getAttribute('aria-valuetext');
  const named = opened.match(/„(.+)“ wird geladen/)?.[1];
  expect(backend.boards.map((b) => b.title)).toContain(named);

  // The clock has to actually advance, or it is decoration rather than feedback.
  const strip = page.locator('.active-load');
  await expect(strip).toContainText(/\d+\.\d s/);
  const first = await strip.textContent();
  await page.waitForTimeout(700);
  expect(await strip.textContent()).not.toBe(first);

  await expect(page.locator('.board')).toBeVisible({ timeout: 15_000 });
  await expect(active).toBeHidden();
  await expect(page.locator('.topbar')).toContainText(named);
});

test('the topbar counts all boards and reveals card totals on hover', async ({ page, backend }) => {
  await slowStacks(page, 900);
  await page.goto('/');

  expect(backend.boards.length).toBeGreaterThan(1);
  const all = page.getByRole('progressbar', { name: 'Ladefortschritt aller Boards' });
  await expect(all).toBeVisible();

  await page.locator('.board').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(all).toHaveAttribute('aria-valuenow', /[1-9]/);

  await all.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('Karten geladen');
  await expect(tip).toContainText('Listen geladen');
  await expect(tip).toContainText('Lädt gerade');

  // The aggregate keeps its own clock: the active board has already painted by
  // now, and a shared clock froze here while boards were still streaming in.
  const first = await tip.textContent();
  await page.waitForTimeout(700);
  expect(await tip.textContent()).not.toBe(first);
});
