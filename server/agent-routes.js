import { boardAllowed, hasScope, SCOPES } from './agent-tokens.js';
import { planOrders } from '../src/lib/ordering.js';
import { INBOX_STACK_TITLE, INBOX_TITLE } from '../src/lib/inbox.js';

const PREFIX = '/agent';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_BULK_CARDS = 200;
const INBOX_COLOR = '31CC7C';
const MOVE_CONCURRENCY = 6;

export function isAgentRoute(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

export async function handleAgentRoute({ req, res, url, token, deck, calendar, audit }) {
  const route = url.pathname.slice(PREFIX.length);
  try {
    if (req.method === 'GET' && route === '/whoami') {
      return send(res, 200, { user: token.user, label: token.label, scopes: token.scopes, boardIds: token.boardIds, expiresAt: new Date(token.expiresAt).toISOString() });
    }
    if (req.method === 'GET' && route === '/capabilities') return send(res, 200, capabilities(token, calendar));
    if (req.method === 'GET' && route === '/boards') return send(res, 200, await listBoards(token, deck));
    if (req.method === 'GET' && route === '/board') return send(res, 200, await getBoard(token, deck, url));
    if (req.method === 'GET' && route === '/cards/search') return send(res, 200, await searchCards(token, deck, url));
    if (req.method === 'POST' && route === '/cards/move') return send(res, 200, await moveCards(token, deck, await readJson(req), audit));
    if (req.method === 'POST' && route === '/cards/update') return send(res, 200, await updateCards(token, deck, await readJson(req), audit));
    if (req.method === 'POST' && route === '/inbox/capture') return send(res, 200, await captureInbox(token, deck, await readJson(req), audit));
    if (route.startsWith('/calendar/')) return await handleCalendar({ req, res, route, url, token, calendar });
    return send(res, 404, errorBody('NOT_FOUND', 'Agent route not found'));
  } catch (error) {
    return send(res, normalizeStatus(error.status), errorBody(error.code ?? 'AGENT_ERROR', safeMessage(error.message)));
  }
}

function capabilities(token, calendar) {
  return {
    version: 1,
    scopes: SCOPES,
    granted: token.scopes,
    boardScope: token.boardIds,
    limits: { bulkCards: MAX_BULK_CARDS, bodyBytes: MAX_BODY_BYTES },
    calendar: { available: Boolean(calendar) },
    routes: [
      { method: 'GET', path: '/agent/whoami', scope: null },
      { method: 'GET', path: '/agent/capabilities', scope: null },
      { method: 'GET', path: '/agent/boards', scope: 'boards:read' },
      { method: 'GET', path: '/agent/board?boardId=', scope: 'boards:read' },
      { method: 'GET', path: '/agent/cards/search?q=', scope: 'cards:read' },
      { method: 'POST', path: '/agent/cards/move', scope: 'cards:write' },
      { method: 'POST', path: '/agent/cards/update', scope: 'cards:write' },
      { method: 'POST', path: '/agent/inbox/capture', scope: 'inbox:write' },
      { method: 'GET', path: '/agent/calendar/status', scope: 'calendar:read' },
      { method: 'GET', path: '/agent/calendar/planner?start=&end=', scope: 'calendar:read' },
      { method: 'POST', path: '/agent/calendar/schedule', scope: 'calendar:write' },
      { method: 'POST', path: '/agent/calendar/sync', scope: 'calendar:write' },
      { method: 'POST', path: '/agent/calendar/unlink', scope: 'calendar:write' },
    ],
  };
}

async function listBoards(token, deck) {
  requireScope(token, 'boards:read');
  const boards = await deck.boards();
  return {
    boards: boards
      .filter((board) => boardAllowed(token, board.id))
      .map((board) => ({
        id: board.id,
        title: board.title,
        color: board.color,
        access: board.permissions?.PERMISSION_MANAGE ? 'manage' : board.permissions?.PERMISSION_EDIT ? 'edit' : 'view',
        isInbox: board.title === INBOX_TITLE,
      })),
  };
}

async function getBoard(token, deck, url) {
  requireScope(token, 'boards:read');
  const boardId = requireBoardAccess(token, url.searchParams.get('boardId'));
  const stacks = await deck.stacks(boardId);
  return { boardId, stacks: stacks.map((stack) => ({ id: stack.id, title: stack.title, order: stack.order, cards: stack.cards.map(publicCard) })) };
}

async function searchCards(token, deck, url) {
  requireScope(token, 'cards:read');
  const query = String(url.searchParams.get('q') ?? '').trim().toLowerCase();
  if (!query) throw agentError(400, 'INVALID_QUERY', 'q is required');
  const limit = boundedInt(url.searchParams.get('limit'), 50, 1, 200);
  const scoped = url.searchParams.get('boardId');

  const boards = scoped
    ? [{ id: requireBoardAccess(token, scoped) }]
    : (await deck.boards()).filter((board) => boardAllowed(token, board.id));

  const results = [];
  for (const board of boards) {
    for (const stack of await deck.stacks(board.id)) {
      for (const card of stack.cards) {
        if (!matches(card, query)) continue;
        results.push({ ...publicCard(card), boardId: String(board.id), stackId: String(stack.id), stackTitle: stack.title });
        if (results.length >= limit) return { results, truncated: true };
      }
    }
  }
  return { results, truncated: false };
}

function matches(card, query) {
  return String(card.title ?? '').toLowerCase().includes(query) || String(card.description ?? '').toLowerCase().includes(query);
}

async function moveCards(token, deck, body, audit) {
  requireScope(token, 'cards:write');
  const cardIds = idList(body.cardIds, 'cardIds');
  const toBoardId = requireBoardAccess(token, body.toBoardId);
  const toStackId = requiredId(body.toStackId, 'toStackId');

  const stacks = await deck.stacks(toBoardId);
  const dest = stacks.find((stack) => String(stack.id) === toStackId);
  if (!dest) throw agentError(404, 'STACK_NOT_FOUND', `Stack ${toStackId} not found on board ${toBoardId}`);

  const located = await locateCards(token, deck, cardIds);
  const missing = cardIds.filter((id) => !located.some((hit) => String(hit.card.id) === id));
  if (missing.length) throw agentError(404, 'CARD_NOT_FOUND', `Cards not found or out of scope: ${missing.join(', ')}`);

  // Ordering is computed against the destination lane as it will look after the
  // insert, so the agent and the drag-and-drop UI produce identical results.
  const moving = located.map((hit) => hit.card);
  const remaining = dest.cards.filter((card) => !cardIds.includes(String(card.id)));
  const at = Math.min(body.index == null ? remaining.length : boundedInt(body.index, 0, 0, remaining.length), remaining.length);
  const projected = [...remaining.slice(0, at), ...moving, ...remaining.slice(at)];
  const planned = planOrders({ cards: projected, at, movingCount: moving.length });

  const moved = [];
  const failed = [];
  const queue = [...planned];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      try {
        await deck.moveCard({ card: job.card, toBoardId, toStackId, order: job.order });
        moved.push({ cardId: String(job.card.id), order: job.order });
      } catch (error) {
        failed.push({ cardId: String(job.card.id), message: safeMessage(error.message) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MOVE_CONCURRENCY, planned.length) }, worker));

  audit({ action: 'cards.move', tokenId: token.id, user: token.user, cardIds, toBoardId, toStackId, moved: moved.length, failed: failed.length });
  return { moved, failed, toBoardId, toStackId };
}

async function updateCards(token, deck, body, audit) {
  requireScope(token, 'cards:write');
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (!updates.length || updates.length > MAX_BULK_CARDS) throw agentError(400, 'INVALID_UPDATES', `updates must contain 1..${MAX_BULK_CARDS} items`);

  const updated = [];
  const failed = [];
  for (const raw of updates) {
    const boardId = requireBoardAccess(token, raw.boardId);
    const stackId = requiredId(raw.stackId, 'stackId');
    const cardId = requiredId(raw.cardId, 'cardId');
    const changes = cardChanges(raw);
    try {
      const card = await deck.updateCard({ boardId, stackId, cardId, changes });
      updated.push(publicCard(card));
    } catch (error) {
      failed.push({ cardId, message: safeMessage(error.message) });
    }
  }
  audit({ action: 'cards.update', tokenId: token.id, user: token.user, updated: updated.length, failed: failed.length });
  return { updated, failed };
}

function cardChanges(raw) {
  const changes = {};
  if (raw.title != null) changes.title = boundedText(raw.title, 'title', 255);
  if (raw.description != null) changes.description = boundedText(raw.description, 'description', 20_000);
  if (Object.hasOwn(raw, 'duedate')) changes.duedate = raw.duedate == null || raw.duedate === '' ? null : isoDate(raw.duedate);
  if (!Object.keys(changes).length) throw agentError(400, 'EMPTY_UPDATE', 'Each update needs title, description or duedate');
  return changes;
}

async function captureInbox(token, deck, body, audit) {
  requireScope(token, 'inbox:write');
  const title = boundedText(body.title, 'title', 255);
  const description = body.description == null ? '' : boundedText(body.description, 'description', 20_000);
  const duedate = body.duedate == null || body.duedate === '' ? null : isoDate(body.duedate);

  const boards = await deck.boards();
  let board = boards.find((candidate) => candidate.title === INBOX_TITLE);
  if (!board) board = await deck.createBoard({ title: INBOX_TITLE, color: INBOX_COLOR });
  if (!boardAllowed(token, board.id)) throw agentError(403, 'BOARD_OUT_OF_SCOPE', 'This token may not write to the inbox board');

  const stacks = await deck.stacks(board.id);
  const stack = stacks[0] ?? await deck.createStack(board.id, { title: INBOX_STACK_TITLE, order: 0 });

  const card = await deck.createCard({ boardId: board.id, stackId: stack.id, title, description, duedate });
  audit({ action: 'inbox.capture', tokenId: token.id, user: token.user, boardId: String(board.id), cardId: String(card.id) });
  return { boardId: String(board.id), stackId: String(stack.id), card: publicCard(card) };
}

async function handleCalendar({ req, res, route, url, token, calendar }) {
  if (!calendar) return send(res, 503, errorBody('CALENDAR_INTEGRATION_DISABLED', 'Proton Calendar integration is not configured'));

  if (req.method === 'GET' && route === '/calendar/status') {
    requireScope(token, 'calendar:read');
    return send(res, 200, await calendar.status(token.user));
  }
  if (req.method === 'GET' && route === '/calendar/calendars') {
    requireScope(token, 'calendar:read');
    return send(res, 200, await calendar.calendars(token.user));
  }
  if (req.method === 'GET' && route === '/calendar/planner') {
    requireScope(token, 'calendar:read');
    return send(res, 200, await calendar.planner(token.user, { start: url.searchParams.get('start'), end: url.searchParams.get('end') }));
  }
  if (req.method === 'POST' && route === '/calendar/schedule') {
    requireScope(token, 'calendar:write');
    const body = await readJson(req);
    requireBoardAccess(token, body.entry?.boardId);
    return send(res, 200, await calendar.schedule(token.user, body.entry, {
      calendarId: body.calendarId,
      recurrence: body.recurrence,
      durationMinutes: body.durationMinutes,
      reminderMinutes: body.reminderMinutes,
      timezone: body.timezone,
    }));
  }
  if (req.method === 'POST' && route === '/calendar/sync') {
    requireScope(token, 'calendar:write');
    const body = await readJson(req);
    for (const entry of Array.isArray(body.entries) ? body.entries : []) requireBoardAccess(token, entry?.boardId);
    return send(res, 200, await calendar.sync(token.user, body.entries, {
      autoCreate: body.autoCreate,
      calendarId: body.calendarId,
      scopeBoardIds: body.scopeBoardIds,
      pruneMissing: body.pruneMissing,
    }));
  }
  if (req.method === 'POST' && route === '/calendar/unlink') {
    requireScope(token, 'calendar:write');
    const body = await readJson(req);
    return send(res, 200, await calendar.unlink(token.user, String(body.entryKey ?? ''), { deleteEvent: body.deleteEvent === true }));
  }
  return send(res, 404, errorBody('NOT_FOUND', 'Agent calendar route not found'));
}

async function locateCards(token, deck, cardIds) {
  const wanted = new Set(cardIds);
  const found = [];
  for (const board of await deck.boards()) {
    if (!wanted.size) break;
    if (!boardAllowed(token, board.id)) continue;
    for (const stack of await deck.stacks(board.id)) {
      for (const card of stack.cards) {
        if (!wanted.delete(String(card.id))) continue;
        found.push({ card, boardId: String(board.id), stackId: String(stack.id) });
      }
    }
  }
  return cardIds.map((id) => found.find((hit) => String(hit.card.id) === id)).filter(Boolean);
}

function publicCard(card) {
  return {
    id: String(card.id),
    title: card.title,
    description: card.description ?? '',
    duedate: card.duedate ?? null,
    order: Number(card.order ?? 0),
    labels: (card.labels ?? []).map((label) => label.title),
    assignees: (card.assignedUsers ?? []).map((entry) => entry.participant?.uid ?? entry.participant?.displayname ?? null).filter(Boolean),
  };
}

function requireScope(token, scope) {
  if (!hasScope(token, scope)) throw agentError(403, 'MISSING_SCOPE', `This token lacks the ${scope} scope`);
}

function requireBoardAccess(token, boardId) {
  const id = requiredId(boardId, 'boardId');
  if (!boardAllowed(token, id)) throw agentError(403, 'BOARD_OUT_OF_SCOPE', `Board ${id} is outside this token's board scope`);
  return id;
}

function idList(value, field) {
  if (!Array.isArray(value) || !value.length) throw agentError(400, 'INVALID_IDS', `${field} must be a non-empty array`);
  if (value.length > MAX_BULK_CARDS) throw agentError(400, 'INVALID_IDS', `${field} is limited to ${MAX_BULK_CARDS} entries`);
  const ids = value.map((entry) => requiredId(entry, field));
  if (new Set(ids).size !== ids.length) throw agentError(400, 'DUPLICATE_IDS', `${field} contains duplicates`);
  return ids;
}

function requiredId(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,18}$/.test(text)) throw agentError(400, 'INVALID_ID', `${field} must be a numeric id`);
  return text;
}

function boundedText(value, field, max) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw agentError(400, 'INVALID_TEXT', `${field} must be 1..${max} characters`);
  return text;
}

function boundedInt(value, fallback, min, max) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw agentError(400, 'INVALID_NUMBER', `Expected an integer between ${min} and ${max}`);
  return parsed;
}

function isoDate(value) {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw agentError(400, 'INVALID_DATE', 'duedate must be an ISO date or date-time');
  return parsed.toISOString();
}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw agentError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Agent mutations require application/json');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw agentError(413, 'PAYLOAD_TOO_LARGE', 'Agent request body exceeds 1 MiB');
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw agentError(400, 'INVALID_JSON', 'Agent request body must be a JSON object');
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

function agentError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function safeMessage(value) {
  return String(value ?? 'Agent request failed').replace(/(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, '$1 [REDACTED]').slice(0, 500);
}
