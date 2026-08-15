import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { NextcloudClient } from './nextcloud.js';
import { SessionStore } from './sessions.js';
import { CalendarIntegration } from './calendar-integration.js';
import { CalendarMappingStore } from './calendar-mappings.js';
import { ProtonCalendarApi } from './proton-calendar.js';
import { AgentTokenStore } from './agent-tokens.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = resolve(root, 'dist');
const config = loadConfig();
const sessions = new SessionStore({ filePath: config.sessionFile, secret: config.sessionSecret });
const nextcloud = new NextcloudClient({ baseUrl: config.ncUrl });
const calendarIntegration = config.calendar.enabled
  ? new CalendarIntegration({
    api: new ProtonCalendarApi({
      baseUrl: config.calendar.baseUrl,
      token: config.calendar.token,
      calendarId: config.calendar.calendarId,
      timeoutMs: config.calendar.timeoutMs,
    }),
    mappings: new CalendarMappingStore({ filePath: config.calendar.mappingFile }),
    allowedUsers: config.calendar.allowedUsers,
    timezone: config.calendar.timezone,
  })
  : null;
const agentTokens = config.agent.enabled ? new AgentTokenStore({ filePath: config.agent.tokenFile }) : null;
if (!existsSync(distDir)) console.warn(`WARNING: built client directory is missing at ${distDir}; run npm run build before production start.`);
const app = createApp({
  ncUrl: config.ncUrl,
  sessions,
  nextcloud,
  calendarIntegration,
  agentTokens,
  agentRate: config.agent.enabled ? config.agent.rate : undefined,
  distDir,
});

// A single unhandled rejection must never take the whole server down: that
// would turn any upstream Nextcloud hiccup into an unauthenticated DoS.
process.on('unhandledRejection', (err) => console.error('unhandled rejection', err));

createServer(app).listen(config.port, () => {
  console.log(`Nextcloud Deck backend listening on http://127.0.0.1:${config.port}`);
});
