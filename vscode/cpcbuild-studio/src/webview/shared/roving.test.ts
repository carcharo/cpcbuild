import { describe, expect, it } from 'vitest';
import { rovingNext } from './roving';

describe('rovingNext', () => {
  it('moves with arrows and wraps', () => {
    expect(rovingNext(4, 1, 'ArrowRight')).toBe(2);
    expect(rovingNext(4, 3, 'ArrowRight')).toBe(0);
    expect(rovingNext(4, 0, 'ArrowLeft')).toBe(3);
    expect(rovingNext(4, 1, 'ArrowDown')).toBe(2);
    expect(rovingNext(4, 1, 'ArrowUp')).toBe(0);
  });
  it('Home and End', () => {
    expect(rovingNext(4, 2, 'Home')).toBe(0);
    expect(rovingNext(4, 1, 'End')).toBe(3);
  });
  it('respects the axis', () => {
    expect(rovingNext(4, 1, 'ArrowDown', { axis: 'horizontal' })).toBeUndefined();
    expect(rovingNext(4, 1, 'ArrowRight', { axis: 'vertical' })).toBeUndefined();
    expect(rovingNext(4, 1, 'ArrowDown', { axis: 'vertical' })).toBe(2);
  });
  it('skips disabled items, also for Home and End', () => {
    const disabled = (i: number): boolean => i === 0 || i === 2 || i === 3;
    expect(rovingNext(4, 1, 'ArrowRight', { disabled })).toBe(1);
    expect(rovingNext(5, 1, 'ArrowRight', { disabled })).toBe(4);
    expect(rovingNext(5, 4, 'Home', { disabled })).toBe(1);
    expect(rovingNext(5, 1, 'End', { disabled })).toBe(4);
  });
  it('can stop at the ends', () => {
    expect(rovingNext(3, 2, 'ArrowDown', { wrap: false })).toBeUndefined();
    expect(rovingNext(3, 0, 'ArrowUp', { wrap: false })).toBeUndefined();
    expect(rovingNext(3, 0, 'ArrowDown', { wrap: false })).toBe(1);
  });
  it('ignores other keys, empty lists and all-disabled lists', () => {
    expect(rovingNext(3, 0, 'a')).toBeUndefined();
    expect(rovingNext(0, 0, 'Home')).toBeUndefined();
    expect(rovingNext(3, 0, 'End', { disabled: () => true })).toBeUndefined();
  });
});
