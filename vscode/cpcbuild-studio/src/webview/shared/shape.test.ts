import { describe, expect, it } from 'vitest';
import { shapePath } from './shape';

describe('shapePath', () => {
  it('is empty for no values', () => expect(shapePath([])).toBe(''));
  it('draws a horizontal line for one value', () => expect(shapePath([0.5])).toBe('M1 6L27 6'));
  it('draws a flat line for equal values', () => expect(shapePath([1, 1, 1])).toBe('M1 1L14 1L27 1'));
  it('draws a ramp from bottom to top', () => expect(shapePath([0, 0.5, 1])).toBe('M1 11L14 6L27 1'));
  it('clamps out-of-range and non-finite values', () => expect(shapePath([-3, 7, NaN])).toBe('M1 11L14 1L27 11'));
  it('honours the size', () => expect(shapePath([0, 1], 10, 4)).toBe('M1 3L9 1'));
});
