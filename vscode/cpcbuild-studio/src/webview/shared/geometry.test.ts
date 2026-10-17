import { describe, expect, it } from 'vitest';
import { aspectWidth, byteGridEvery, cssSize, fitZoom, line, moveCursor, nearestZoom, pixelAt, stepZoom, zoomUsable } from './geometry';

describe('pixel canvas geometry', () => {
  it('aspect: square is 1; crt follows the virtual 640x400 grid; Plus is magx/(2*magy)', () => {
    expect(aspectWidth(0, 'square')).toBe(1);
    expect([0, 1, 2].map((m) => aspectWidth(m as 0 | 1 | 2, 'crt'))).toEqual([2, 1, 0.5]);
    expect(aspectWidth('plus', 'crt', 1, 1)).toBe(0.5);
    expect(aspectWidth('plus', 'crt', 2, 1)).toBe(1);
  });
  it('crt mode 2 skips odd zooms', () => {
    expect(zoomUsable(3, 0.5)).toBe(false);
    expect(stepZoom(2, 1, 0.5)).toBe(4);
    expect(stepZoom(4, -1, 0.5)).toBe(2);
    expect(stepZoom(2, -1, 0.5)).toBe(2);
    expect(nearestZoom(3, 0.5)).toBe(2);
  });
  it('zoom steps stop at the ends', () => {
    expect(stepZoom(32, 1)).toBe(32);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(8, 1)).toBe(12);
    expect(stepZoom(12, -1)).toBe(8);
  });
  it('css size and the pixel under a point', () => {
    expect(cssSize(16, 8, 12, 2)).toEqual({ width: 384, height: 96 });
    expect(pixelAt(0, 0, 12, 2, 16, 8)).toEqual({ x: 0, y: 0 });
    expect(pixelAt(383, 95, 12, 2, 16, 8)).toEqual({ x: 15, y: 7 });
    expect(pixelAt(384, 0, 12, 2, 16, 8)).toBeNull();
    expect(pixelAt(-1, 0, 12, 1, 16, 8)).toBeNull();
  });
  it('fit picks the largest step that fits with the margin', () => {
    expect(fitZoom(64, 64, 1, 800, 600)).toBe(8); // 8*64=512 + 32 <= 600
    expect(fitZoom(510, 200, 1, 400, 300)).toBe(1); // nothing fits: smallest
    expect(fitZoom(24, 16, 1, 500, 20)).toBe(fitZoom(24, 16, 1, 500, Infinity)); // a sliver of a height is ignored
    expect(fitZoom(24, 16, 1, 500, 20)).toBeGreaterThanOrEqual(8); // 24x16 at ~half of 1000 px
  });
  it('byte grid spacing', () => {
    expect([0, 1, 2, 'plus'].map((m) => byteGridEvery(m as 0))).toEqual([2, 4, 8, 0]);
  });
  it('Bresenham has no gaps and both ends', () => {
    const l = line(0, 0, 5, 2);
    expect(l[0]).toEqual([0, 0]);
    expect(l[l.length - 1]).toEqual([5, 2]);
    for (let i = 1; i < l.length; i++) expect(Math.max(Math.abs(l[i][0] - l[i - 1][0]), Math.abs(l[i][1] - l[i - 1][1]))).toBe(1);
    expect(line(3, 3, 3, 3)).toEqual([[3, 3]]);
    expect(line(4, 0, 0, 0).length).toBe(5);
  });
  it('cursor moves by pixel and by byte, clamped', () => {
    expect(moveCursor({ x: 0, y: 0 }, -1, 0, 16, 8)).toEqual({ x: 0, y: 0 });
    expect(moveCursor({ x: 5, y: 3 }, 1, 0, 16, 8, 4)).toEqual({ x: 8, y: 3 });
    expect(moveCursor({ x: 5, y: 3 }, -1, 0, 16, 8, 4)).toEqual({ x: 4, y: 3 });
    expect(moveCursor({ x: 14, y: 7 }, 1, 1, 16, 8, 4)).toEqual({ x: 15, y: 7 });
  });
});
