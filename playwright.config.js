import { defineConfig, devices } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const E2E_SESSION_SECRET = 'nextcloud-deckv2-e2e-session-secret';

function localEnv() {
  const path = resolve('.env.local');
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = localEnv();
const NC_URL = process.env.NC_URL ?? env.VITE_NC_URL;

// Specs that intercept the backend in the browser. They need no credentials and
// no live Nextcloud, which is what lets them run in CI and on a fresh worktree.
const HERMETIC = [
  'hermetic-smoke.spec.js',
  'drag-external.spec.js',
  'drag-modal.spec.js',
  'visual-overlay.spec.js',
  'motion.spec.js',
];

// Specs that mutate a real Deck board. Skipped entirely when no credentials are
// configured rather than failing, so a contributor without a Nextcloud can
// still run the suite that matters for UI behaviour.
const LIVE = [
  'smoke.spec.js',
  'card-detail.spec.js',
  'inbox.spec.js',
  'interaction.spec.js',
  'selection.spec.js',
  'selection-drag.spec.js',
];

const PROD_URL = process.env.PROD_URL ?? 'https://deckv2.xhacker.de';

const hermeticProjects = ['chromium', 'firefox', 'webkit'].map((name) => ({
  name: `hermetic-${name}`,
  testMatch: HERMETIC,
  use: { ...devices[{ chromium: 'Desktop Chrome', firefox: 'Desktop Firefox', webkit: 'Desktop Safari' }[name]] },
}));

const liveProjects = NC_URL
  ? [{ name: 'live-chromium', testMatch: LIVE, use: { ...devices['Desktop Chrome'] } }]
  : [];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Live Deck mutations against one shared board cannot run concurrently, and
  // the hermetic specs share a dev server, so serial is correct for both.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    // Every attempt is traced and all of them are kept when any attempt fails.
    // 'on-first-retry' loses the trace for the original failure, which is the
    // one that matters when a bug is intermittent.
    trace: 'retain-on-failure-and-retries',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      // Animations are the top cause of flaky visual diffs. Finite ones are
      // fast-forwarded, infinite ones cancelled, so a baseline is comparable.
      // Specs that test motion itself opt out per-call.
      animations: 'disabled',
      caret: 'hide',
      // Hides the build-sha version tag, which is baked in at compile time and
      // would otherwise change every baseline on every commit.
      stylePath: './e2e/screenshot.css',
      maxDiffPixelRatio: 0.002,
    },
  },
  projects: [
    ...hermeticProjects,
    ...liveProjects,
    // Post-deploy smoke against the real deployment. Not part of the default
    // run: selected explicitly with `--project=prod-smoke`, and it never gets a
    // local webServer.
    {
      name: 'prod-smoke',
      testMatch: ['prod-smoke.spec.js'],
      use: { ...devices['Desktop Chrome'], baseURL: PROD_URL },
    },
  ],
  webServer: {
    command: 'node scripts/dev.js',
    env: {
      // The hermetic specs never reach the proxy, but the server refuses to
      // boot without a target, so give it an unroutable placeholder rather than
      // making credentials a hard requirement.
      NC_URL: NC_URL ?? 'http://127.0.0.1:9',
      SESSION_SECRET: E2E_SESSION_SECRET,
    },
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
