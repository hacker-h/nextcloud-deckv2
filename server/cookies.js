export function parseCookies(header = '') {
  const out = {};
  const seen = new Set();
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    if (seen.has(key) && isStateCookieName(key)) out.invalidStateCookie = true;
    seen.add(key);
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  if (out['__Host-sid']) out.sid = out['__Host-sid'];
  if (out['__Host-flow']) out.flow = out['__Host-flow'];
  return out;
}

export function sessionCookie(sid, { secure = false } = {}) {
  return cookie(stateCookieName('sid', secure), sid, ['HttpOnly', 'SameSite=Strict', 'Path=/', secure && 'Secure']);
}

export function flowCookie(flowId, { secure = false } = {}) {
  return cookie(stateCookieName('flow', secure), flowId, ['HttpOnly', 'SameSite=Strict', 'Path=/', secure && 'Secure']);
}

export function clearSessionCookie({ secure = false } = {}) {
  return cookie(stateCookieName('sid', secure), '', ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', secure && 'Secure']);
}

export function clearFlowCookie({ secure = false } = {}) {
  return cookie(stateCookieName('flow', secure), '', ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', secure && 'Secure']);
}

export function requestIsHttps(req) {
  return req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function cookie(name, value, attrs) {
  return [`${name}=${encodeURIComponent(String(value))}`, ...attrs.filter(Boolean)].join('; ');
}

function stateCookieName(base, secure) {
  return secure ? `__Host-${base}` : base;
}

function isStateCookieName(name) {
  return name === 'sid' || name === 'flow' || name === '__Host-sid' || name === '__Host-flow';
}
