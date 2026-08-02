import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config.js';

describe('server config', () => {
  it('normalizes a valid NC_URL and reads PORT', () => {
    const config = loadConfig({ NC_URL: 'https://cloud.example.test/', PORT: '4312', SESSION_SECRET: 'secret' });
    expect(config.ncUrl).toBe('https://cloud.example.test');
    expect(config.port).toBe(4312);
  });

  it('rejects missing and malformed NC_URL', () => {
    expect(() => loadConfig({ SESSION_SECRET: 'secret' })).toThrow(/NC_URL/);
    expect(() => loadConfig({ NC_URL: 'notaurl', SESSION_SECRET: 'secret' })).toThrow(/absolute http/);
  });

  it('rejects non-http URLs', () => {
    expect(() => loadConfig({ NC_URL: 'file:///tmp/deck', SESSION_SECRET: 'secret' })).toThrow(/absolute http/);
  });

  it('warns loudly and uses an ephemeral secret only in explicit test mode', () => {
    const warn = vi.fn();
    const sessionFile = join(mkdtempSync(join(tmpdir(), 'deck-config-empty-')), 'sessions.json');
    const config = loadConfig({ NC_URL: 'https://cloud.example.test', NODE_ENV: 'test', SESSION_FILE: sessionFile }, { warn });
    expect(config.sessionSecret).toHaveLength(32);
    expect(config.sessionSecretIsEphemeral).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SESSION_SECRET.*sessions will not survive restart/i));
  });

  it('requires SESSION_SECRET outside dev/test and when persisted sessions already exist', () => {
    const sessionFile = join(mkdtempSync(join(tmpdir(), 'deck-config-')), 'sessions.json');
    writeFileSync(sessionFile, '{"sessions":{}}');

    expect(() => loadConfig({ NC_URL: 'https://cloud.example.test' })).toThrow(/SESSION_SECRET is required/);
    expect(() => loadConfig({ NC_URL: 'https://cloud.example.test', NODE_ENV: 'test', SESSION_FILE: sessionFile })).toThrow(/persisted session file/);
  });
});
