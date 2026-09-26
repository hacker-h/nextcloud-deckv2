import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { normalizePlan } from '../shared/planning.js';

export class PlanningStore {
  constructor(filePath) {
    this.filePath = filePath;
    try { this.data = JSON.parse(readFileSync(filePath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.data = {}; }
  }
  get(user, cardId) { return this.data[JSON.stringify([user, String(cardId)])] ?? { plan: null, revision: null }; }
  put(user, cardId, plan, revision) {
    const key = JSON.stringify([user, String(cardId)]);
    if (this.get(user, cardId).revision !== revision) throw Object.assign(new Error('Planung wurde inzwischen geändert. Bitte neu laden.'), { status: 409 });
    const saved = { plan: normalizePlan(plan), revision: randomUUID() };
    const next = { ...this.data, [key]: saved };
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 });
    renameSync(temp, this.filePath);
    this.data = next;
    return saved;
  }
}

export async function handlePlanning({ req, res, url, user, deck, store }) {
  const send = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  try {
    if (!store) return send(503, { error: 'Planung ist nicht verfügbar.' });
    const match = url.pathname.match(/^\/planning\/boards\/([1-9]\d*)(?:\/cards\/([1-9]\d*))?$/);
    if (!match) return send(404, { error: 'Nicht gefunden' });
    const [, boardId, cardId] = match;
    const boards = await deck.boards();
    const board = boards.find((b) => String(b.id) === boardId);
    if (!board) return send(404, { error: 'Board nicht verfügbar' });
    const stacks = await deck.stacks(boardId);
    const cards = stacks.flatMap((stack) => stack.cards);
    if (req.method === 'GET' && !cardId) return send(200, Object.fromEntries(cards.map((card) => [card.id, store.get(user, card.id)])));
    if (req.method !== 'PUT' || !cardId) return send(405, { error: 'Methode nicht erlaubt' });
    if (!board.permissions?.PERMISSION_EDIT) return send(403, { error: 'Board ist schreibgeschützt' });
    if (!cards.some((card) => String(card.id) === cardId)) return send(404, { error: 'Karte nicht auf diesem Board' });
    if (!String(req.headers['content-type']).startsWith('application/json')) return send(415, { error: 'JSON erforderlich' });
    let raw = ''; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 4096) return send(413, { error: 'Anfrage zu groß' });
      raw += chunk.toString();
    }
    let body;
    try { body = JSON.parse(raw); normalizePlan(body.plan); }
    catch { return send(400, { error: 'Ungültige Planung' }); }
    return send(200, store.put(user, cardId, body.plan, body.revision));
  } catch (error) {
    const status = [400, 401, 403, 404, 409].includes(error.status) ? error.status : 502;
    return send(status, { error: status === 409 ? error.message : 'Planung konnte nicht geladen oder gespeichert werden.' });
  }
}
