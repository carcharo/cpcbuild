import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, getPixel, newImage, setPixel } from './image';

describe('encodePng / decodePng round trip', () => {
  it('a one-row image survives (upng wrote PNGs without PLTE for small, few-colour images)', () => {
    const img = newImage(4, 1);
    setPixel(img, 0, 0, 255, 0, 0);
    setPixel(img, 1, 0, 0, 255, 0);
    const back = decodePng(encodePng(img));
    expect([back.width, back.height]).toEqual([4, 1]);
    expect(getPixel(back, 0, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(back, 1, 0)).toEqual([0, 255, 0, 255]);
    expect(getPixel(back, 2, 0)[3]).toBe(0);
  });

  it('every small size and colour/alpha mix round-trips', () => {
    for (const h of [1, 2, 3])
      for (let w = 1; w <= 20; w++)
        for (const fill of [0, 1, 2, 3]) {
          const img = newImage(w, h);
          for (let x = 0; x < w; x++)
            for (let y = 0; y < h; y++) {
              if (fill === 1) setPixel(img, x, y, 255, 255, 255);
              if (fill === 2) setPixel(img, x, y, (x * 37) & 255, y * 90, 7, x % 3 ? 255 : 0);
              if (fill === 3) setPixel(img, x, y, 255, 0, 0, 77);
            }
          const back = decodePng(encodePng(img));
          for (let x = 0; x < w; x++)
            for (let y = 0; y < h; y++) {
              const a = getPixel(img, x, y), b = getPixel(back, x, y);
              if (a[3] === 0) expect(b[3], `${w}x${h}/${fill} alpha`).toBe(0);
              else expect(b, `${w}x${h}/${fill} at ${x},${y}`).toEqual(a);
            }
        }
  });
});
