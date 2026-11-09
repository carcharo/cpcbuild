import { describe, expect, it } from 'vitest';
import { ID_NAMES, idIndex, idVar } from './theme';

describe('identity helpers', () => {
  it('has the 12 names in token order', () => {
    expect(ID_NAMES).toHaveLength(12);
    expect(ID_NAMES[0]).toBe('blue');
    expect(ID_NAMES[11]).toBe('peach');
  });
  it('idVar is 1-based and clamped', () => {
    expect(idVar(1)).toBe('var(--cb-id-1)');
    expect(idVar(12)).toBe('var(--cb-id-12)');
    expect(idVar(0)).toBe('var(--cb-id-1)');
    expect(idVar(99)).toBe('var(--cb-id-12)');
  });
  it('idIndex finds names', () => {
    expect(idIndex('blue')).toBe(1);
    expect(idIndex(' Peach ')).toBe(12);
    expect(idIndex('mauve')).toBeUndefined();
  });
});
