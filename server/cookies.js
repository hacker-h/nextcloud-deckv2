export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

export function sessionCookie(sid, { secure = false } = {}) {
  return cookie('sid', sid, ['HttpOnly', 'SameSite=Strict', 'Path=/', secure && 'Secure']);
}

export function flowCookie(flowId, { secure = false } = {}) {
  return cookie('flow', flowId, ['HttpOnly', 'SameSite=Strict', 'Path=/', secure && 'Secure']);
}

export function clearSessionCookie({ secure = false } = {}) {
  return cookie('sid', '', ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', secure && 'Secure']);
}

export function clearFlowCookie({ secure = false } = {}) {
  return cookie('flow', '', ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=0', secure && 'Secure']);
}

export function requestIsHttps(req) {
  return req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
}

function cookie(name, value, attrs) {
  return [`${name}=${encodeURIComponent(String(value))}`, ...attrs.filter(Boolean)].join('; ');
}
