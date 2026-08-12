const PREFIX = '/integration/proton-calendar';
const MAX_BODY_BYTES = 1024 * 1024;

export async function handleCalendarRoute({ req, res, url, user, integration }) {
  try {
    if (req.method === 'GET' && url.pathname === `${PREFIX}/status`) {
      return send(res, 200, integration ? await integration.status(user) : { enabled: false, connected: false });
    }
    if (!integration) return send(res, 503, errorBody('CALENDAR_INTEGRATION_DISABLED', 'Proton Calendar integration is not configured'));

    if (req.method === 'GET' && url.pathname === `${PREFIX}/calendars`) {
      return send(res, 200, await integration.calendars(user));
    }
    if (req.method === 'GET' && url.pathname === `${PREFIX}/planner`) {
      return send(res, 200, await integration.planner(user, {
        start: url.searchParams.get('start'),
        end: url.searchParams.get('end'),
      }));
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/sync`) {
      const body = await readJson(req);
      return send(res, 200, await integration.sync(user, body.entries, {
        autoCreate: body.autoCreate,
        calendarId: body.calendarId,
        scopeBoardIds: body.scopeBoardIds,
        pruneMissing: body.pruneMissing,
      }));
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/schedule`) {
      const body = await readJson(req);
      return send(res, 200, await integration.schedule(user, body.entry, {
        calendarId: body.calendarId,
        recurrence: body.recurrence,
        durationMinutes: body.durationMinutes,
        reminderMinutes: body.reminderMinutes,
        timezone: body.timezone,
      }));
    }
    if (req.method === 'POST' && url.pathname === `${PREFIX}/unlink`) {
      const body = await readJson(req);
      return send(res, 200, await integration.unlink(user, String(body.entryKey ?? ''), {
        deleteEvent: body.deleteEvent === true,
      }));
    }
    return send(res, 404, errorBody('NOT_FOUND', 'Calendar integration route not found'));
  } catch (error) {
    return send(res, normalizeStatus(error.status), errorBody(
      error.code ?? 'CALENDAR_INTEGRATION_ERROR',
      safeMessage(error.message),
      safeDetails(error.details),
    ));
  }
}

export function isCalendarRoute(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

async function readJson(req) {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw routeError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Calendar mutations require application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw routeError(413, 'PAYLOAD_TOO_LARGE', 'Calendar request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw routeError(400, 'INVALID_JSON', 'Calendar request body must be a JSON object');
  }
}

function errorBody(code, message, details = null) {
  return { error: { code, message, ...(details ? { details } : {}) } };
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store',
  });
  res.end(json);
}

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}

function routeError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function safeMessage(value) {
  return String(value ?? 'Calendar integration failed').replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]').slice(0, 500);
}

function safeDetails(value) {
  if (!value || typeof value !== 'object') return null;
  const allowed = {};
  for (const key of ['retryAfterSeconds', 'retryAfterMs', 'requestId']) {
    if (Object.hasOwn(value, key)) allowed[key] = value[key];
  }
  return Object.keys(allowed).length ? allowed : null;
}
