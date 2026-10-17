import { describe, expect, it } from 'vitest';
import { nonce } from './nonce';

describe('CSP nonce', () => {
  it('is long, URL-safe and different every time (CSPRNG, not Math.random)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = nonce();
      expect(n).toMatch(/^[A-Za-z0-9_-]{24}$/);
      seen.add(n);
    }
    expect(seen.size).toBe(200);
  });
});
