import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { clearFlowCookie, clearSessionCookie, flowCookie, parseCookies, requestIsHttps, sessionCookie } from './cookies.js';
import { handleCalendarRoute, isCalendarRoute } from './calendar-routes.js';

const HOP_BY_HOP = new Set(['connection', 'content-length', 'host', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FLOW_TTL_MS = 20 * 60 * 1000;
const DEFAULT_FLOW_LIMITS = { global: 256, perIp: 16 };
const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2'],
  ['.map', 'application/json; charset=utf-8'],
]);

export function createApp({ ncUrl, sessions, nextcloud, calendarIntegration = null, now = () => Date.now(), distDir = null, flowLimits = DEFAULT_FLOW_LIMITS } = {}) {
  const flows = new Map();
  const nc = nextcloud;

  return async function app(req, res) {
    try {
      const url = requestUrl(req);
      if (req.method === 'GET' && url.pathname === '/healthz') {
        res.setHeader('Cache-Control', 'no-store');
        return send(res, 200, { status: 'ok' });
      }
      if (req.method === 'POST' && url.pathname === '/auth/login') {
        if (!originAllowed(req, { requireOrigin: productionRequest(req) })) return send(res, 403, { error: 'forbidden' });
        return await authLogin(req, res, nc, flows, now, flowLimits);
      }
      if (req.method === 'GET' && url.pathname === '/auth/poll') return await authPoll(req, res, nc, flows, sessions, now);
      if (req.method === 'POST' && url.pathname === '/auth/logout') {
        if (!originAllowed(req, { requireOrigin: productionRequest(req) })) return send(res, 403, { error: 'forbidden' });
        return await authLogout(req, res, ncUrl, sessions);
      }
      if (req.method === 'GET' && url.pathname === '/auth/me') return authMe(req, res, ncUrl, sessions);
      if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return send(res, 404, { error: 'not found' });
      if (isCalendarRoute(url.pathname)) {
        const session = sessionFrom(req, sessions);
        if (session?.invalid) return send(res, 400, { error: 'invalid cookie' });
        if (!session) return send(res, 401, { error: 'unauthenticated' });
        if (!originAllowed(req, { requireOrigin: productionRequest(req) })) return send(res, 403, { error: 'forbidden' });
        sessions.touch(session.sid);
        return await handleCalendarRoute({ req, res, url, user: session.user, integration: calendarIntegration });
      }
      if (url.pathname.startsWith('/api/')) return await proxy(req, res, url, ncUrl, sessions);
      if (['GET', 'HEAD'].includes(req.method)) return await serveStatic(req, res, url, distDir);
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      if (err.name === 'LoginExpiredError') return send(res, 410, { error: 'login expired' });
      return send(res, 500, { error: 'server error' });
    }
  };
}

async function serveStatic(req, res, url, distDir) {
  if (!distDir) return send(res, 404, { error: 'not found' });
  const root = await realpath(distDir).catch(() => null);
  if (!root) return send(res, 404, { error: 'not found' });

  const resolved = await resolveStaticPath(root, rawPathname(req.url) ?? url.pathname);
  if (!resolved) return send(res, 404, { error: 'not found' });

  const headers = {
    'Content-Type': contentType(resolved.path),
    'Cache-Control': resolved.index ? 'no-cache' : cacheControl(resolved.path),
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  createReadStream(resolved.path)
    .on('error', () => res.destroy())
    .pipe(res);
}

async function resolveStaticPath(root, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (hasParentSegment(decoded)) return null;

  const requested = decoded.replace(/^\/+/, '');
  const candidate = requested ? resolve(root, requested) : resolve(root, 'index.html');
  const file = await safeFile(root, candidate);
  if (file) return { path: file, index: false };

  if (extname(decoded)) return null;
  const index = await safeFile(root, resolve(root, 'index.html'));
  return index ? { path: index, index: true } : null;
}

async function safeFile(root, candidate) {
  const real = await realpath(candidate).catch(() => null);
  if (!real || !inside(root, real)) return null;
  const info = await stat(real).catch(() => null);
  return info?.isFile() ? real : null;
}

function inside(root, target) {
  return target === root || target.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

function contentType(filePath) {
  return STATIC_TYPES.get(extname(filePath)) ?? 'application/octet-stream';
}

function cacheControl(filePath) {
  return filePath.split(sep).includes('assets') ? 'public, max-age=31536000, immutable' : 'no-cache';
}

async function authLogin(req, res, nc, flows, now, limits) {
  evictExpiredFlows(flows, now());
  const ip = clientIp(req);
  if (flows.size >= limits.global || activeFlowsForIp(flows, ip) >= limits.perIp) {
    return send(res, 429, { error: 'too many login flows' });
  }
  const flow = await nc.initLogin();
  const flowId = randomBytes(32).toString('base64url');
  flows.set(flowId, { token: flow.pollToken, createdAt: now(), ip });
  res.setHeader('Set-Cookie', flowCookie(flowId, { secure: requestIsHttps(req) }));
  return send(res, 200, { loginUrl: flow.loginUrl });
}

async function authPoll(req, res, nc, flows, sessions, now) {
  const secure = requestIsHttps(req);
  const currentTime = now();
  evictExpiredFlows(flows, currentTime);
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.invalidStateCookie) return send(res, 400, { error: 'invalid cookie' });
  const flowId = cookies.flow;
  const flow = flowId ? flows.get(flowId) : null;
  if (!flow) {
    res.setHeader('Set-Cookie', clearFlowCookie({ secure }));
    return send(res, 410, { error: 'login expired' });
  }
  if (currentTime - flow.createdAt > FLOW_TTL_MS) {
    flows.delete(flowId);
    res.setHeader('Set-Cookie', clearFlowCookie({ secure }));
    return send(res, 410, { error: 'login expired' });
  }
  const result = await nc.poll(flow.token, { createdAt: flow.createdAt });
  if (!result) return empty(res, 204);
  flows.delete(flowId);
  const existing = sessionFrom(req, sessions);
  if (existing?.invalid) return send(res, 400, { error: 'invalid cookie' });
  if (existing) sessions.destroy(existing.sid);
  const sid = sessions.create(result.appPassword, result.loginName);
  res.setHeader('Set-Cookie', [sessionCookie(sid, { secure }), clearFlowCookie({ secure })]);
  return send(res, 200, { user: result.loginName });
}

function evictExpiredFlows(flows, now) {
  for (const [id, flow] of flows) {
    if (now - flow.createdAt > FLOW_TTL_MS) flows.delete(id);
  }
}

function activeFlowsForIp(flows, ip) {
  let count = 0;
  for (const flow of flows.values()) if (flow.ip === ip) count += 1;
  return count;
}

async function authLogout(req, res, ncUrl, sessions) {
  const session = sessionFrom(req, sessions);
  if (session?.invalid) return send(res, 400, { error: 'invalid cookie' });
  if (session) {
    sessions.destroy(session.sid);
    await revoke(ncUrl, session).catch(() => {});
  }
  res.setHeader('Set-Cookie', clearSessionCookie({ secure: requestIsHttps(req) }));
  return empty(res, 204);
}

function authMe(req, res, ncUrl, sessions) {
  const session = sessionFrom(req, sessions);
  if (session?.invalid) return send(res, 400, { error: 'invalid cookie' });
  if (!session) return send(res, 401, { error: 'unauthenticated', instance: ncUrl });
  sessions.touch(session.sid);
  return send(res, 200, { user: session.user, instance: ncUrl });
}

async function proxy(req, res, url, ncUrl, sessions) {
  const session = sessionFrom(req, sessions);
  if (session?.invalid) return send(res, 400, { error: 'invalid cookie' });
  if (!session) return send(res, 401, { error: 'unauthenticated' });
  if (!originAllowed(req, { requireOrigin: productionRequest(req) })) return send(res, 403, { error: 'forbidden' });

  const target = targetPath(url);
  if (!target.allowed) return send(res, 403, { error: 'forbidden' });

  const headers = forwardHeaders(req.headers);
  headers.authorization = `Basic ${Buffer.from(`${session.user}:${session.appPassword}`).toString('base64')}`;
  headers['accept-encoding'] = 'identity';
  if (target.ocs) headers['ocs-apirequest'] = 'true';

  const upstream = await fetch(`${ncUrl}${target.path}${url.search}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : await requestBody(req),
    duplex: ['GET', 'HEAD'].includes(req.method) ? undefined : 'half',
  });

  if (!upstream.ok && upstream.status !== 304) {
    return send(res, upstream.status, await upstreamError(upstream));
  }

  res.writeHead(upstream.status, responseHeaders(upstream.headers));
  if (upstream.body) {
    for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
  }
  res.end();
}

function targetPath(url) {
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    return { allowed: false };
  }
  if (/%(?:2f|5c)/i.test(decoded)) return { allowed: false };
  const normalized = new URL(decoded, 'http://local').pathname;
  if (normalized.startsWith('/api/deck/')) {
    return { allowed: true, ocs: false, path: `/index.php/apps/deck/api/v1.0${normalized.slice('/api/deck'.length)}` };
  }
  if (normalized.startsWith('/api/ocs/')) {
    const rest = normalized.slice('/api/ocs'.length);
    if (/^\/apps\/deck\/api\/v1\.0\/cards\/\d+\/comments(?:\/\d+)?$/.test(rest)) {
      return { allowed: true, ocs: true, path: `/ocs/v2.php${rest}` };
    }
    if (rest === '/apps/activity/api/v2/activity/filter') return { allowed: true, ocs: true, path: `/ocs/v2.php${rest}` };
  }
  return { allowed: false };
}

function originAllowed(req, { requireOrigin = false } = {}) {
  if (!MUTATING.has(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return !requireOrigin;
  return origin === requestUrl(req).origin;
}

async function revoke(ncUrl, session) {
  const auth = Buffer.from(`${session.user}:${session.appPassword}`).toString('base64');
  await fetch(`${ncUrl}/ocs/v2.php/core/apppassword`, { method: 'DELETE', headers: { Authorization: `Basic ${auth}`, 'OCS-APIRequest': 'true' } });
}

function sessionFrom(req, sessions) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.invalidStateCookie) return { invalid: true };
  const sid = cookies.sid;
  return sid ? sessions.get(sid) : null;
}

async function upstreamError(upstream) {
  const text = redact(await upstream.text().catch(() => ''));
  const contentType = upstream.headers.get('content-type') ?? '';
  const message = extractErrorMessage(text, contentType);
  return message ? { error: 'upstream error', status: upstream.status, message } : { error: 'upstream error', status: upstream.status };
}

function extractErrorMessage(text, contentType) {
  if (!text) return '';
  if (contentType.includes('application/json')) {
    try {
      const parsed = JSON.parse(text);
      return String(parsed.message ?? parsed.error ?? parsed.ocs?.meta?.message ?? '').slice(0, 500);
    } catch {
      // Fall through to a bounded, redacted text message.
    }
  }
  return text.slice(0, 500);
}

function redact(value) {
  return String(value).replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]');
}

function hasParentSegment(pathname) {
  return pathname.split(/[\\/]+/).some((segment) => segment === '..');
}

function productionRequest(req) {
  const host = requestUrl(req).hostname;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? '').split(',')[0].trim();
}

function requestUrl(req) {
  const proto = requestIsHttps(req) ? 'https' : 'http';
  return new URL(req.url, `${proto}://${req.headers.host}`);
}

function rawPathname(value) {
  return String(value ?? '').split('?')[0];
}

function forwardHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && key.toLowerCase() !== 'cookie' && key.toLowerCase() !== 'origin') out[key] = value;
  }
  return out;
}

function responseHeaders(headers) {
  const out = {};
  for (const [key, value] of headers.entries()) if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  return out;
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function empty(res, status) {
  res.writeHead(status);
  res.end();
}
