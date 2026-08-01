import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { NextcloudClient } from './nextcloud.js';
import { SessionStore } from './sessions.js';

const config = loadConfig();
const sessions = new SessionStore({ filePath: config.sessionFile, secret: config.sessionSecret });
const nextcloud = new NextcloudClient({ baseUrl: config.ncUrl });
const app = createApp({ ncUrl: config.ncUrl, sessions, nextcloud });

createServer(app).listen(config.port, () => {
  console.log(`Nextcloud Deck backend listening on http://127.0.0.1:${config.port}`);
});
