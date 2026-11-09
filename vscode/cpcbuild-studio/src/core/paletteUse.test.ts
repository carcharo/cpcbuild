import { describe, expect, it } from 'vitest';
import { colourUse, usedByText } from './paletteUse';

describe('colourUse', () => {
  it('collects the pens and the border of each colour', () => {
    const u = colourUse([0, 26, 6, 26, -1], 6);
    expect(u.get(26)).toEqual({ pens: [1, 3], border: false });
    expect(u.get(6)).toEqual({ pens: [2], border: true });
    expect(u.has(1)).toBe(false);
    expect(u.has(-1)).toBe(false);
  });
  it('has no border use when the border is none', () => {
    expect(colourUse([5], null).get(5)).toEqual({ pens: [0], border: false });
  });
});

describe('usedByText', () => {
  it('words pens and the border', () => {
    expect(usedByText(undefined)).toBe('');
    expect(usedByText({ pens: [0], border: false })).toBe('used by pen 0');
    expect(usedByText({ pens: [1, 3], border: false })).toBe('used by pen 1, 3');
    expect(usedByText({ pens: [], border: true })).toBe('used by the border');
    expect(usedByText({ pens: [2], border: true })).toBe('used by pen 2; used by the border');
  });
});
