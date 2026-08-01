import { describe, expect, it } from 'vitest';
import { clearSessionCookie, parseCookies, sessionCookie } from './cookies.js';

describe('cookie helpers', () => {
  it('parses cookies and serializes hardened session cookies', () => {
    expect(parseCookies('theme=dark; sid=abc')).toEqual({ theme: 'dark', sid: 'abc' });
    expect(sessionCookie('sid-value', { secure: true })).toBe(
      'sid=sid-value; HttpOnly; SameSite=Strict; Path=/; Secure'
    );
  });

  it('does not allow attribute injection from crafted values', () => {
    const serialized = sessionCookie('abc; Secure=false\r\nX-Bad: yes');
    expect(serialized).not.toMatch(/[\r\n]/);
    expect(serialized).not.toContain('; Secure=false');
    expect(sessionCookie('abc; Secure=false')).toContain('sid=abc%3B%20Secure%3Dfalse;');
  });

  it('clears the session cookie with matching security attributes', () => {
    expect(clearSessionCookie({ secure: false })).toBe(
      'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    );
  });
});
