import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { NextcloudClient } from './nextcloud.js';
import { SessionStore } from './sessions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const config = loadConfig();
const sessions = new SessionStore({ filePath: config.sessionFile, secret: config.sessionSecret });
const nextcloud = new NextcloudClient({ baseUrl: config.ncUrl });
if (!existsSync(distDir)) console.warn(`WARNING: built client directory is missing at ${distDir}; run npm run build before production start.`);
const app = createApp({ ncUrl: config.ncUrl, sessions, nextcloud, distDir });

createServer(app).listen(config.port, () => {
  console.log(`Nextcloud Deck backend listening on http://127.0.0.1:${config.port}`);
});
