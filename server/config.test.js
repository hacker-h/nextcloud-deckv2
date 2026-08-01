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

  it('warns loudly and uses an ephemeral secret when SESSION_SECRET is absent', () => {
    const warn = vi.fn();
    const config = loadConfig({ NC_URL: 'https://cloud.example.test' }, { warn });
    expect(config.sessionSecret).toHaveLength(32);
    expect(config.sessionSecretIsEphemeral).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SESSION_SECRET.*sessions will not survive restart/i));
  });
});
