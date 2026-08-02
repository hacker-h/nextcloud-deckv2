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

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // Live Deck mutations against one shared board cannot run concurrently.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/dev.js',
    env: {
      NC_URL: process.env.NC_URL ?? env.VITE_NC_URL,
      SESSION_SECRET: E2E_SESSION_SECRET,
    },
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
