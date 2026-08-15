import { SCOPES } from './agent-tokens.js';

const PREFIX = '/auth/agent-tokens';
const MAX_BODY_BYTES = 64 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export function isAgentAdminRoute(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

export async function handleAgentAdminRoute({ req, res, url, session, tokens }) {
  try {
    if (req.method === 'GET' && url.pathname === PREFIX) {
      return send(res, 200, { scopes: SCOPES, tokens: tokens.list(session.user) });
    }
    if (req.method === 'POST' && url.pathname === PREFIX) {
      const body = await readJson(req);
      const issued = tokens.issue({
        user: session.user,
        sessionId: session.sid,
        label: body.label,
        scopes: body.scopes,
        boardIds: body.boardIds ?? null,
        ttlMs: ttl(body.expiresInDays),
      });
      return send(res, 201, issued);
    }
    if (req.method === 'DELETE' && url.pathname.startsWith(`${PREFIX}/`)) {
      const id = url.pathname.slice(PREFIX.length + 1);
      return tokens.revoke(session.user, id)
        ? send(res, 200, { revoked: true, id })
        : send(res, 404, errorBody('TOKEN_NOT_FOUND', 'No such active token'));
    }
    return send(res, 404, errorBody('NOT_FOUND', 'Agent token route not found'));
  } catch (error) {
    return send(res, normalizeStatus(error.status), errorBody(error.code ?? 'AGENT_TOKEN_ERROR', safeMessage(error.message)));
  }
}

function ttl(expiresInDays) {
  if (expiresInDays == null || expiresInDays === '') return 90 * DAY;
  const days = Number(expiresInDays);
  if (!Number.isInteger(days) || days < 1 || days > 365) throw adminError(400, 'INVALID_TTL', 'expiresInDays must be an integer between 1 and 365');
  return days * DAY;
}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw adminError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Token creation requires application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw adminError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw adminError(400, 'INVALID_JSON', 'Request body must be a JSON object');
  }
}

function errorBody(code, message) {
  return { error: { code, message } };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json), 'Cache-Control': 'no-store' });
  res.end(json);
}

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function adminError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function safeMessage(value) {
  return String(value ?? 'Token request failed').slice(0, 500);
}
