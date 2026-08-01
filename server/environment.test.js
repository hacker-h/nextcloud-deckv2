import { describe, expect, it } from 'vitest';

describe('server vitest environment', () => {
  it('runs server tests in node without browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });
});
