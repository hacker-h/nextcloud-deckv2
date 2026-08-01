import { createHash, randomBytes } from 'node:crypto';

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

  let sessionSecret;
  let sessionSecretIsEphemeral = false;
  if (env.SESSION_SECRET) {
    sessionSecret = createHash('sha256').update(env.SESSION_SECRET).digest();
  } else {
    sessionSecret = randomBytes(32);
    sessionSecretIsEphemeral = true;
    log.warn('WARNING: SESSION_SECRET is missing; generated an ephemeral key and sessions will not survive restart.');
  }

  return {
    ncUrl: url.toString().replace(/\/$/, ''),
    port,
    sessionSecret,
    sessionSecretIsEphemeral,
    sessionFile: env.SESSION_FILE || '.data/sessions.json',
  };
}
