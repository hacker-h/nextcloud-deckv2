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
    expect(config.calendar).toEqual({ enabled: false });
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

  it('loads the server-only Proton Calendar bridge configuration', () => {
    const config = loadConfig({
      NC_URL: 'https://cloud.example.test',
      SESSION_SECRET: 'secret',
      PROTON_CALENDAR_API_URL: 'http://proton-calendar:8787/',
      PROTON_CALENDAR_API_TOKEN: 'bridge-secret',
      PROTON_CALENDAR_DECK_USERS: 'alice, bob ',
      PROTON_CALENDAR_ID: 'calendar-1',
      PROTON_CALENDAR_TIMEZONE: 'Europe/Berlin',
      CALENDAR_SYNC_FILE: '/data/calendar-sync.json',
    });

    expect(config.calendar).toEqual({
      enabled: true,
      baseUrl: 'http://proton-calendar:8787',
      token: 'bridge-secret',
      calendarId: 'calendar-1',
      allowedUsers: ['alice', 'bob'],
      timezone: 'Europe/Berlin',
      mappingFile: '/data/calendar-sync.json',
      timeoutMs: 20_000,
    });
  });

  it('accepts the proton-calendar-cli sidecar env names without duplicating its token', () => {
    const config = loadConfig({
      NC_URL: 'https://cloud.example.test',
      SESSION_SECRET: 'secret',
      PROTON_CALENDAR_API_URL: 'http://proton-calendar:8787',
      API_BEARER_TOKEN: 'sidecar-secret',
      TARGET_CALENDAR_ID: 'calendar-sidecar',
      PROTON_CALENDAR_DECK_USERS: 'alice',
    });

    expect(config.calendar).toMatchObject({
      enabled: true,
      token: 'sidecar-secret',
      calendarId: 'calendar-sidecar',
    });
  });

  it('fails closed on partial or unscoped Proton Calendar configuration', () => {
    const base = { NC_URL: 'https://cloud.example.test', SESSION_SECRET: 'secret' };
    expect(() => loadConfig({ ...base, PROTON_CALENDAR_API_URL: 'http://calendar.test' })).toThrow(/configured together/);
    expect(() => loadConfig({ ...base, PROTON_CALENDAR_API_TOKEN: 'secret' })).toThrow(/configured together/);
    expect(() => loadConfig({
      ...base,
      PROTON_CALENDAR_API_URL: 'http://calendar.test',
      PROTON_CALENDAR_API_TOKEN: 'secret',
    })).toThrow(/DECK_USERS/);
    expect(() => loadConfig({
      ...base,
      PROTON_CALENDAR_API_URL: 'file:///calendar',
      PROTON_CALENDAR_API_TOKEN: 'secret',
      PROTON_CALENDAR_DECK_USERS: 'alice',
    })).toThrow(/http/);
  });

  it('ignores a bridge-native bearer token when no Calendar URL opts in', () => {
    const config = loadConfig({
      NC_URL: 'https://cloud.example.test',
      SESSION_SECRET: 'secret',
      API_BEARER_TOKEN: 'used-by-an-unrelated-sidecar',
    });

    expect(config.calendar).toEqual({ enabled: false });
  });
});
