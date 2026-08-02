import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionStore } from './sessions.js';

const secret = Buffer.alloc(32, 7);

function store(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'deck-sessions-'));
  return new SessionStore({ filePath: join(dir, 'sessions.json'), secret, ...opts });
}

describe('SessionStore', () => {
  it('round-trips encrypted app passwords without storing plaintext', () => {
    const sessions = store();
    const sid = sessions.create('app-password', 'alice');
    expect(sessions.get(sid)).toEqual({ sid, appPassword: 'app-password', user: 'alice' });
    expect(readFileSync(sessions.filePath, 'utf8')).not.toContain('app-password');
  });

  it('survives reload from disk', () => {
    const first = store();
    const sid = first.create('app-password', 'alice');
    const second = new SessionStore({ filePath: first.filePath, secret });
    expect(second.get(sid)?.user).toBe('alice');
  });

  it('rejects tampered GCM ciphertext', () => {
    const sessions = store();
    const sid = sessions.create('app-password', 'alice');
    const persisted = JSON.parse(readFileSync(sessions.filePath, 'utf8'));
    const tag = Buffer.from(persisted.sessions[sid].token.tag, 'base64');
    tag[0] ^= 0xff;
    persisted.sessions[sid].token.tag = tag.toString('base64');
    writeFileSync(sessions.filePath, JSON.stringify(persisted));
    const reloaded = new SessionStore({ filePath: sessions.filePath, secret });
    expect(reloaded.get(sid)).toBeNull();
  });

  it('expires idle sessions and ignores unknown ids', () => {
    let now = 1_000;
    const sessions = store({ now: () => now, ttlMs: 100 });
    const sid = sessions.create('app-password', 'alice');
    expect(sessions.get('missing')).toBeNull();
    now += 101;
    expect(sessions.get(sid)).toBeNull();
  });

  it('generates unique high-entropy ids and can touch/destroy', () => {
    const sessions = store();
    const ids = Array.from({ length: 64 }, () => sessions.create('token', 'alice'));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[A-Za-z0-9_-]{40,}$/.test(id))).toBe(true);
    expect(sessions.touch(ids[0])).toBe(true);
    sessions.destroy(ids[0]);
    expect(sessions.get(ids[0])).toBeNull();
  });

  it('reloads from disk on a lookup miss so independent stores see seeded sessions', () => {
    const first = store();
    const second = new SessionStore({ filePath: first.filePath, secret });
    const sid = first.create('app-password', 'alice');

    expect(second.get(sid)).toEqual({ sid, appPassword: 'app-password', user: 'alice' });
  });

  it('returns null for an unknown sid when the file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-sessions-missing-'));
    const sessions = new SessionStore({ filePath: join(dir, 'sessions.json'), secret });

    expect(sessions.get('missing')).toBeNull();
  });

  it('merges reloads without clobbering in-memory sessions newer than the file', () => {
    const sessions = store();
    const localSid = sessions.create('local-token', 'local-user');
    const stale = JSON.parse(readFileSync(sessions.filePath, 'utf8'));

    const remote = new SessionStore({ filePath: sessions.filePath, secret });
    const remoteSid = remote.create('remote-token', 'remote-user');
    writeFileSync(sessions.filePath, JSON.stringify(stale));

    expect(sessions.get(remoteSid)).toBeNull();
    expect(sessions.get(localSid)).toEqual({ sid: localSid, appPassword: 'local-token', user: 'local-user' });
  });
});
