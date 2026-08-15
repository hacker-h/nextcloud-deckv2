import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

export function loadConfig(env = process.env, log = console) {
  if (!env.NC_URL) throw new Error('NC_URL is required');

  let url;
  try {
    url = new URL(env.NC_URL);
  } catch {
    throw new Error('NC_URL must be a well-formed absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NC_URL must be an absolute http(s) URL');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');

  const port = env.PORT ? Number(env.PORT) : 3000;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('PORT must be a valid TCP port');

  const sessionFile = env.SESSION_FILE || '.data/sessions.json';
  const calendar = calendarConfig(env);
  let sessionSecret;
  let sessionSecretIsEphemeral = false;
  if (env.SESSION_SECRET) {
    sessionSecret = createHash('sha256').update(env.SESSION_SECRET).digest();
  } else {
    const allowEphemeral = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    if (!allowEphemeral) throw new Error('SESSION_SECRET is required outside development/test');
    if (existsSync(sessionFile)) throw new Error('SESSION_SECRET is required when a persisted session file already exists');
    sessionSecret = randomBytes(32);
    sessionSecretIsEphemeral = true;
    log.warn('WARNING: SESSION_SECRET is missing; generated an ephemeral key and sessions will not survive restart.');
  }

  return {
    ncUrl: url.toString().replace(/\/$/, ''),
    port,
    sessionSecret,
    sessionSecretIsEphemeral,
    sessionFile,
    calendar,
    agent: agentConfig(env),
  };
}

function agentConfig(env) {
  const enabled = String(env.AGENT_API_ENABLED ?? '').trim().toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const rateMax = env.AGENT_API_RATE_MAX ? Number(env.AGENT_API_RATE_MAX) : 120;
  if (!Number.isInteger(rateMax) || rateMax < 1 || rateMax > 10_000) throw new Error('AGENT_API_RATE_MAX must be between 1 and 10000');

  return {
    enabled: true,
    tokenFile: String(env.AGENT_TOKEN_FILE ?? '.data/agent-tokens.json'),
    rate: { windowMs: 60_000, max: rateMax },
  };
}

function calendarConfig(env) {
  const baseUrl = String(env.PROTON_CALENDAR_API_URL ?? '').trim();
  // These aliases are emitted by proton-calendar-cli. Both containers can
  // therefore consume one owner-only env file without duplicating its token.
  const explicitToken = String(env.PROTON_CALENDAR_API_TOKEN ?? '').trim();
  const token = explicitToken || (baseUrl ? String(env.API_BEARER_TOKEN ?? '').trim() : '');
  if (!baseUrl && !token) return { enabled: false };
  if (!baseUrl || !token) throw new Error('PROTON_CALENDAR_API_URL and PROTON_CALENDAR_API_TOKEN must be configured together');

  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('PROTON_CALENDAR_API_URL must be a well-formed absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('PROTON_CALENDAR_API_URL must be an absolute http(s) URL');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');

  const allowedUsers = String(env.PROTON_CALENDAR_DECK_USERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowedUsers.length) throw new Error('PROTON_CALENDAR_DECK_USERS is required when Proton Calendar integration is enabled');

  const timeoutMs = env.PROTON_CALENDAR_TIMEOUT_MS ? Number(env.PROTON_CALENDAR_TIMEOUT_MS) : 20_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new Error('PROTON_CALENDAR_TIMEOUT_MS must be between 1000 and 120000');

  return {
    enabled: true,
    baseUrl: parsed.toString().replace(/\/$/, ''),
    token,
    calendarId: String(env.PROTON_CALENDAR_ID ?? env.TARGET_CALENDAR_ID ?? env.DEFAULT_CALENDAR_ID ?? '').trim() || null,
    allowedUsers,
    timezone: String(env.PROTON_CALENDAR_TIMEZONE ?? 'Europe/Berlin').trim(),
    mappingFile: String(env.CALENDAR_SYNC_FILE ?? '.data/calendar-sync.json'),
    timeoutMs,
  };
}
