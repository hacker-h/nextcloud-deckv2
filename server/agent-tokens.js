import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const PREFIX = 'deckv2_';

export const SCOPES = Object.freeze(['boards:read', 'cards:read', 'cards:write', 'inbox:write', 'calendar:read', 'calendar:write']);

export class AgentTokenStore {
  constructor({ filePath, now = () => Date.now(), defaultTtlMs = 90 * DAY }) {
    if (!filePath) throw new Error('AgentTokenStore requires filePath');
    this.filePath = filePath;
    this.now = now;
    this.defaultTtlMs = defaultTtlMs;
    this.data = this.#load();
    this.fileMtimeNs = this.#fileMtimeNs();
  }

  // The plaintext secret is returned exactly once, here. Only its SHA-256 is
  // persisted, so a leaked token file cannot be replayed against the API.
  issue({ user, sessionId, label, scopes, boardIds = null, ttlMs = this.defaultTtlMs }) {
    const granted = normalizeScopes(scopes);
    if (!granted.length) throw tokenError(400, 'INVALID_SCOPES', 'At least one valid scope is required');
    const secret = randomBytes(32).toString('base64url');
    const id = randomBytes(8).toString('hex');
    const issuedAt = this.now();
    this.data.tokens[id] = {
      id,
      user,
      sessionId,
      label: String(label ?? 'agent').slice(0, 64),
      scopes: granted,
      boardIds: normalizeBoardIds(boardIds),
      hash: hashSecret(secret),
      issuedAt,
      expiresAt: issuedAt + ttlMs,
      lastUsedAt: null,
      revokedAt: null,
    };
    this.#save();
    return { token: `${PREFIX}${id}.${secret}`, record: publicToken(this.data.tokens[id]) };
  }

  verify(presented) {
    const parsed = parseToken(presented);
    if (!parsed) return null;
    let record = this.data.tokens[parsed.id];
    if (!record) {
      this.#reloadIfChanged();
      record = this.data.tokens[parsed.id];
    }
    if (!record || record.revokedAt) return null;
    if (this.now() > record.expiresAt) return null;
    if (!secretMatches(parsed.secret, record.hash)) return null;
    return record;
  }

  touch(id) {
    const record = this.data.tokens[id];
    if (!record) return false;
    record.lastUsedAt = this.now();
    this.#save();
    return true;
  }

  list(user) {
    return Object.values(this.data.tokens)
      .filter((record) => record.user === user && !record.revokedAt)
      .map(publicToken);
  }

  revoke(user, id) {
    const record = this.data.tokens[id];
    if (!record || record.user !== user || record.revokedAt) return false;
    record.revokedAt = this.now();
    this.#save();
    return true;
  }

  revokeForSession(sessionId) {
    let count = 0;
    for (const record of Object.values(this.data.tokens)) {
      if (record.sessionId !== sessionId || record.revokedAt) continue;
      record.revokedAt = this.now();
      count += 1;
    }
    if (count) this.#save();
    return count;
  }

  #load() {
    try {
      chmodSync(this.filePath, 0o600);
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return { tokens: parsed.tokens ?? {} };
    } catch (err) {
      if (err.code === 'ENOENT') return { tokens: {} };
      throw err;
    }
  }

  #reloadIfChanged() {
    const mtime = this.#fileMtimeNs();
    if (mtime === this.fileMtimeNs) return;
    const fromDisk = this.#load();
    this.fileMtimeNs = mtime;
    this.data.tokens = { ...fromDisk.tokens, ...this.data.tokens };
  }

  #fileMtimeNs() {
    try {
      return statSync(this.filePath, { bigint: true }).mtimeNs;
    } catch (err) {
      if (err.code === 'ENOENT') return 0n;
      throw err;
    }
  }

  #save() {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    chmodSync(dirname(this.filePath), 0o700);
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.filePath);
    chmodSync(this.filePath, 0o600);
    this.fileMtimeNs = this.#fileMtimeNs();
  }
}

export function hasScope(record, scope) {
  return Array.isArray(record?.scopes) && record.scopes.includes(scope);
}

export function boardAllowed(record, boardId) {
  if (!record?.boardIds) return true;
  return record.boardIds.includes(String(boardId));
}

function parseToken(presented) {
  const text = String(presented ?? '');
  if (!text.startsWith(PREFIX)) return null;
  const [id, secret] = text.slice(PREFIX.length).split('.');
  if (!id || !secret) return null;
  return { id, secret };
}

function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('base64');
}

function secretMatches(secret, expected) {
  const a = Buffer.from(hashSecret(secret), 'base64');
  const b = Buffer.from(String(expected), 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}

function normalizeScopes(scopes) {
  if (!Array.isArray(scopes)) return [];
  return [...new Set(scopes.map(String).filter((scope) => SCOPES.includes(scope)))];
}

function normalizeBoardIds(boardIds) {
  if (boardIds == null) return null;
  if (!Array.isArray(boardIds)) throw tokenError(400, 'INVALID_BOARD_SCOPE', 'boardIds must be an array or null');
  const ids = [...new Set(boardIds.map((id) => String(id).trim()).filter(Boolean))];
  if (!ids.length) throw tokenError(400, 'INVALID_BOARD_SCOPE', 'boardIds must contain at least one board when present');
  if (ids.length > 100) throw tokenError(400, 'INVALID_BOARD_SCOPE', 'boardIds is limited to 100 boards');
  return ids;
}

function publicToken(record) {
  return {
    id: record.id,
    label: record.label,
    scopes: record.scopes,
    boardIds: record.boardIds,
    issuedAt: new Date(record.issuedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    lastUsedAt: record.lastUsedAt ? new Date(record.lastUsedAt).toISOString() : null,
  };
}

function tokenError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
