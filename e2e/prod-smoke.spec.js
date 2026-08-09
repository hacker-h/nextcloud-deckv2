// Post-deploy smoke against the real deployment.
//
// Every bug in the audit was reported against https://deckv2.xhacker.de while
// the entire E2E suite pointed at localhost:5173. A suite that never touches
// the deployed artifact cannot tell you the deploy worked - it tells you the
// source tree would work if it were deployed, which is a different claim.
//
// Unauthenticated by design: it asserts the shipped bundle loads, is the build
// that was just pushed, and is not serving a stale or broken artifact. Anything
// requiring a session belongs in the hermetic suite, where it does not depend
// on a live Nextcloud that could be down for unrelated reasons.
//
// Run explicitly: npx playwright test --project=prod-smoke

import { test, expect } from '@playwright/test';

test.describe('deployed application', () => {
  test('serves the app shell over HTTPS', async ({ page, baseURL }) => {
    expect(baseURL?.startsWith('https://'), 'production must be HTTPS').toBe(true);

    const response = await page.goto('/');
    expect(response?.status(), 'the app shell must not 4xx/5xx').toBeLessThan(400);
    await expect(page).toHaveTitle(/./);
  });

  test('the JS bundle loads and boots without throwing', async ({ page }) => {
    const errors = [];
    const failed = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText ?? ''}`));

    await page.goto('/', { waitUntil: 'networkidle' });

    // Svelte only ever writes into the mount point; an empty root means the
    // bundle 404'd or threw before mounting, which is the exact failure a
    // "container is running" health check cannot see.
    const mounted = await page.evaluate(() => {
      const root = document.getElementById('app') ?? document.body.firstElementChild;
      return (root?.childElementCount ?? 0) > 0;
    });

    expect(errors, `page threw on load: ${errors.join(' | ')}`).toEqual([]);
    expect(failed.filter((f) => !f.includes('favicon'))).toEqual([]);
    expect(mounted, 'the app did not mount').toBe(true);
  });

  test('reaches the login screen rather than an error page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // Unauthenticated, so either the login affordance or the board itself is
    // acceptable; a server error page is not.
    const body = await page.locator('body').innerText();
    expect(body).not.toMatch(/502 Bad Gateway|503 Service|Cannot GET|Internal Server Error/i);
    expect(body.trim().length, 'the page rendered no text at all').toBeGreaterThan(0);
  });

  test('serves the expected build when RELEASE_SHA is set', async ({ page }) => {
    // The CI deploy job exports the commit it published. Without it the check
    // is skipped rather than silently asserting nothing, so a green run never
    // implies a version was verified when it was not.
    const sha = process.env.RELEASE_SHA;
    test.skip(!sha, 'RELEASE_SHA not set; version pinning not verified');
    const short = sha.slice(0, 7);

    // The sha is a Vite compile-time define, so it exists only inside the JS
    // bundle and in the DOM that bundle renders - never in the served HTML
    // shell. Checking response headers or page source would pass vacuously
    // against any build, which is worse than not checking at all.
    //
    // The deploy is pull-based: the new image is not live the moment the push
    // finishes. Poll the rendered tag instead of sleeping a fixed guess.
    const tag = page.locator('.version-tag');

    await expect
      .poll(
        async () => {
          await page.goto('/', { waitUntil: 'domcontentloaded' });
          return (await tag.textContent().catch(() => null))?.trim() ?? '';
        },
        {
          message: `deployed build never reported ${short}`,
          timeout: 5 * 60_000,
          intervals: [10_000],
        }
      )
      .toContain(short);
  });
});
