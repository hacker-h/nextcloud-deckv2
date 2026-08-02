import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../server/config.js';
import { SessionStore } from '../server/sessions.js';

function loadLocalEnv() {
  const out = {};
  for (const line of readFileSync(resolve('.env.local'), 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const local = loadLocalEnv();
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required for E2E session seeding; Playwright must pin the same value for the seed script and web server.');
}
if (!local.VITE_NC_USER || !local.VITE_NC_PASS) {
  throw new Error('.env.local must define VITE_NC_USER and VITE_NC_PASS for E2E session seeding.');
}

const config = loadConfig({ ...process.env, NC_URL: process.env.NC_URL ?? local.VITE_NC_URL }, console);
const sessions = new SessionStore({ filePath: config.sessionFile, secret: config.sessionSecret });
const sid = sessions.create(local.VITE_NC_PASS, local.VITE_NC_USER);
const seeded = sessions.get(sid);

if (seeded?.user !== local.VITE_NC_USER || seeded?.appPassword !== local.VITE_NC_PASS) {
  throw new Error('Seeded session could not be decrypted with the configured SESSION_SECRET. Check that the seed script and web server use the same SESSION_SECRET.');
}

process.stdout.write(`${sid}\n`);
