import { test, expect } from './hermetic.js';

// Animation is the one thing a screenshot cannot assert: `animations: 'disabled'`
// fast-forwards every finite transition to its end state precisely so baselines
// are stable, which means a visual test proves the final frame and says nothing
// about the motion that got there. These assert the timings themselves, read
// from the live computed style rather than from the stylesheet, so a rule that
// is overridden or never applied fails here.

// Trello's card tiles measure transition-duration 0s. A tile that eases into
// its hover or selected state feels laggy at the exact moment the UI is meant
// to feel instant, and the repo's own comment in Card.svelte calls this out as
// a deliberate constraint rather than an omission.
test('card tiles have no transition, because instant feedback is the point', async ({ board }) => {
  const { page } = board;

  const durations = await page.locator('.card').first().evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      transition: style.transitionDuration,
      animation: style.animationDuration,
    };
  });

  expect(durations.transition).toMatch(/^0s(,\s*0s)*$/);
  expect(durations.animation).toMatch(/^0s(,\s*0s)*$/);
});

test('the drag placeholder animates in, and does so quickly', async ({ board }) => {
  const { page } = board;

  // Read the keyframed rule off the stylesheet: the placeholder only exists
  // mid-drag, and a pointer drag would race the assertion. Svelte scopes
  // keyframe names ("s-b3WsXoxrYYmv-grow"), so match the suffix rather than the
  // authored name - asserting the bare name silently found nothing and the test
  // would have passed on an empty result had it not been checked for null.
  const grow = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet
      }
      for (const rule of rules) {
        if (rule.type === CSSRule.KEYFRAMES_RULE && rule.name.endsWith('grow')) {
          return { name: rule.name, keys: [...rule.cssRules].map((k) => k.keyText) };
        }
      }
    }
    return null;
  });

  expect(grow, 'the placeholder grow keyframes must exist').not.toBeNull();
  expect(grow.keys).toContain('0%');

  // The keyframes existing proves nothing on their own; the placeholder rule
  // has to actually reference them at the intended duration.
  const usage = await page.evaluate((name) => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of rules) {
        if (rule.type === CSSRule.STYLE_RULE && rule.selectorText?.includes('placeholder')) {
          const a = rule.style.animation || '';
          if (a.includes(name)) return a;
        }
      }
    }
    return null;
  }, grow.name);

  expect(usage, 'the placeholder must use the grow animation').not.toBeNull();
  expect(usage).toContain('120ms');
});

test('respects prefers-reduced-motion', async ({ page, browser }) => {
  // A fresh context, because the media preference is a context-level setting
  // and the shared fixture page is already open.
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const reduced = await context.newPage();
  const { installMockBackend } = await import('./mock-server.js');
  await installMockBackend(reduced);
  await reduced.goto('/');
  await reduced.waitForSelector('.board', { state: 'visible' });

  // Nothing in the app opts out of motion yet. This asserts the board is usable
  // under the preference rather than claiming a reduced-motion implementation
  // that does not exist - if one is added, tighten this to assert 0s.
  await expect(reduced.locator('.card').first()).toBeVisible();
  await context.close();
});

test('the checklist progress bar animates its width', async ({ board }) => {
  const { page } = board;
  await page.locator('.card').first().click();
  await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="detail-skeleton"]')).toHaveCount(0);

  const bar = page.locator('.progress-bar-fill').first();
  if ((await bar.count()) === 0) {
    test.skip(true, 'fixture card has no checklist');
  }

  const duration = await bar.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(duration).toContain('0.3s');
});
