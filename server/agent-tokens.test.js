import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentTokenStore, boardAllowed, hasScope } from './agent-tokens.js';

function makeStore(now = () => 1000) {
  const dir = mkdtempSync(join(tmpdir(), 'deck-agent-'));
  const filePath = join(dir, 'agent-tokens.json');
  return { store: new AgentTokenStore({ filePath, now }), filePath };
}

describe('AgentTokenStore', () => {
  it('issues a verifiable token and never persists the secret', () => {
    const { store, filePath } = makeStore();
    const { token, record } = store.issue({ user: 'alice', sessionId: 'sid-1', label: 'cli', scopes: ['cards:read'] });

    expect(token.startsWith('deckv2_')).toBe(true);
    expect(record.scopes).toEqual(['cards:read']);
    expect(store.verify(token).user).toBe('alice');

    const secret = token.split('.')[1];
    expect(readFileSync(filePath, 'utf8')).not.toContain(secret);
  });

  it('rejects tampered, unknown and malformed tokens', () => {
    const { store } = makeStore();
    const { token } = store.issue({ user: 'alice', sessionId: 'sid-1', scopes: ['cards:read'] });
    const [id] = token.split('.');

    expect(store.verify(`${id}.wrong-secret`)).toBeNull();
    expect(store.verify('deckv2_deadbeef.secret')).toBeNull();
    expect(store.verify('not-a-token')).toBeNull();
    expect(store.verify('')).toBeNull();
  });

  it('refuses tokens without a recognized scope', () => {
    const { store } = makeStore();
    expect(() => store.issue({ user: 'alice', sessionId: 'sid-1', scopes: ['cards:destroy'] })).toThrow(/scope/i);
    expect(() => store.issue({ user: 'alice', sessionId: 'sid-1', scopes: [] })).toThrow(/scope/i);
  });

  it('expires tokens once the ttl elapses', () => {
    let clock = 1000;
    const { store } = makeStore(() => clock);
    const { token } = store.issue({ user: 'alice', sessionId: 'sid-1', scopes: ['cards:read'], ttlMs: 500 });

    clock = 1400;
    expect(store.verify(token)).not.toBeNull();
    clock = 1600;
    expect(store.verify(token)).toBeNull();
  });

  it('revokes individually and by originating session', () => {
    const { store } = makeStore();
    const first = store.issue({ user: 'alice', sessionId: 'sid-1', scopes: ['cards:read'] });
    const second = store.issue({ user: 'alice', sessionId: 'sid-2', scopes: ['cards:read'] });

    expect(store.revoke('alice', first.record.id)).toBe(true);
    expect(store.verify(first.token)).toBeNull();
    expect(store.revoke('bob', second.record.id)).toBe(false);

    expect(store.revokeForSession('sid-2')).toBe(1);
    expect(store.verify(second.token)).toBeNull();
  });

  it('lists only the owner active tokens without secrets', () => {
    const { store } = makeStore();
    store.issue({ user: 'alice', sessionId: 'sid-1', label: 'a', scopes: ['cards:read'] });
    const revoked = store.issue({ user: 'alice', sessionId: 'sid-1', label: 'b', scopes: ['cards:read'] });
    store.issue({ user: 'bob', sessionId: 'sid-2', label: 'c', scopes: ['cards:read'] });
    store.revoke('alice', revoked.record.id);

    const listed = store.list('alice');
    expect(listed.map((entry) => entry.label)).toEqual(['a']);
    expect(JSON.stringify(listed)).not.toContain('hash');
  });

  it('validates the board scope shape', () => {
    const { store } = makeStore();
    expect(() => store.issue({ user: 'a', sessionId: 's', scopes: ['cards:read'], boardIds: [] })).toThrow(/at least one board/i);
    expect(() => store.issue({ user: 'a', sessionId: 's', scopes: ['cards:read'], boardIds: 'nope' })).toThrow(/array/i);

    const { record } = store.issue({ user: 'a', sessionId: 's', scopes: ['cards:read'], boardIds: [7, '7', 9] });
    expect(record.boardIds).toEqual(['7', '9']);
  });
});

describe('scope helpers', () => {
  it('reports granted scopes', () => {
    expect(hasScope({ scopes: ['cards:write'] }, 'cards:write')).toBe(true);
    expect(hasScope({ scopes: ['cards:read'] }, 'cards:write')).toBe(false);
    expect(hasScope(null, 'cards:write')).toBe(false);
  });

  it('treats a null board scope as unrestricted', () => {
    expect(boardAllowed({ boardIds: null }, 42)).toBe(true);
    expect(boardAllowed({ boardIds: ['42'] }, 42)).toBe(true);
    expect(boardAllowed({ boardIds: ['42'] }, 43)).toBe(false);
  });
});
