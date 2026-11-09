import { describe, expect, it } from 'vitest';
import {
  TRANSPARENT, displaySize, fitScale, fromFirmware, fromRgba, mergeNote, onScreenPixel, onScreenSize, pensLabel, reducePens, shapeLabel,
  type IndexedImage, type Reduced,
} from './cpcPreview';

/** The mock's 16 x 16 sample: a circle of seven firmware colours (Blue, Pink, Bright Red, Sky Blue, Bright Yellow, Bright White, Black). */
function sample(): IndexedImage {
  const px = new Uint8Array(256).fill(TRANSPARENT);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = x - 7.5, cy = y - 7.5, d = Math.sqrt(cx * cx + cy * cy);
      let i = TRANSPARENT;
      if (d < 7) i = 0;
      if (d >= 6.2 && d < 7) i = 6;
      if (d < 5.5) i = 2;
      if (y >= 4 && y <= 8 && x >= 4 && x <= 11) i = 1;
      if (y === 6 && (x === 6 || x === 9)) i = 5;
      if (y >= 11 && x >= 5 && x <= 10 && d < 7) i = 3;
      if (y === 2 && x >= 6 && x <= 9) i = 4;
      px[y * 16 + x] = i;
    }
  }
  return fromFirmware(16, 16, px, [1, 16, 6, 11, 24, 26, 0]);
}

describe('fromFirmware / fromRgba', () => {
  it('names come from the firmware table', () => {
    const img = fromFirmware(2, 1, new Uint8Array([0, 1]), [0, 26]);
    expect(img.palette.map((c) => c.name)).toEqual(['Black', 'Bright White']);
    expect(img.palette[1].rgb).toEqual([255, 255, 255]);
  });
  it('maps to the nearest firmware colour, makes alpha transparent, and orders the palette by first appearance', () => {
    const rgba = new Uint8ClampedArray([
      250, 250, 250, 255, // white-ish
      10, 5, 0, 255, // black-ish
      0, 0, 0, 10, // transparent
      255, 255, 255, 255, // white again
      200, 10, 10, 128, // red-ish at the cut: opaque
    ]);
    const img = fromRgba(5, 1, rgba);
    expect(Array.from(img.pixels)).toEqual([0, 1, TRANSPARENT, 0, 2]);
    expect(img.palette.map((c) => c.name)).toEqual(['Bright White', 'Black', 'Bright Red']);
    expect(fromRgba(1, 1, new Uint8Array([200, 10, 10, 127])).pixels[0]).toBe(TRANSPARENT);
    expect(fromRgba(1, 1, new Uint8Array([200, 10, 10, 127]), 100).pixels[0]).toBe(0);
  });
});

describe('reducePens', () => {
  it('leaves an image that fits unchanged', () => {
    const img = fromFirmware(4, 1, new Uint8Array([0, 1, 1, 2]), [0, 26, 6]);
    const r = reducePens(img, 1);
    expect(r).toMatchObject({ used: 3, limit: 4, fits: true, merges: [], kept: [1, 0, 2] });
    expect(Array.from(r.pixels)).toEqual([0, 1, 1, 2]);
    expect(r.pixels).not.toBe(img.pixels);
  });
  it('reduces the 16 x 16 sample to mode 1 (4 pens)', () => {
    const r = reducePens(sample(), 1);
    expect(r.used).toBe(7);
    expect(r.fits).toBe(false);
    expect(r.kept).toEqual([1, 2, 6, 3]); // Pink 38, Bright Red 36, Black 30, Sky Blue 24
    expect(r.merges).toEqual([
      { from: 0, to: 6, fromName: 'Blue', toName: 'Black', pixels: 22 },
      { from: 4, to: 1, fromName: 'Bright Yellow', toName: 'Pink', pixels: 4 },
      { from: 5, to: 1, fromName: 'Bright White', toName: 'Pink', pixels: 2 },
    ]);
    expect(mergeNote(r)).toBe('7 colours → 4: blue, bright yellow and bright white merged');
  });
  it('reduces the 16 x 16 sample to mode 2 (2 pens)', () => {
    const r = reducePens(sample(), 2);
    expect(r.kept).toEqual([1, 2]);
    expect(r.merges.map((m) => [m.from, m.to, m.pixels])).toEqual([[6, 2, 30], [3, 1, 24], [0, 1, 22], [4, 1, 4], [5, 1, 2]]);
    expect(mergeNote(r)).toBe('7 colours → 2: 5 colours merged');
    expect(pensLabel(r)).toBe('2 of 2 pens (7 colours)');
    // every opaque pixel now uses a kept pen, transparent ones are untouched
    const src = sample();
    for (let i = 0; i < 256; i++) {
      if (src.pixels[i] === TRANSPARENT) expect(r.pixels[i]).toBe(TRANSPARENT);
      else expect(r.kept).toContain(r.pixels[i]);
    }
  });
  it('breaks count ties by first appearance in scan order, and a merge target tie by kept order', () => {
    // pens: Black(0), Bright White(26), Blue(1), Bright Red(6): two pixels each, scan order 2,3,0,1
    const img = fromFirmware(4, 2, new Uint8Array([2, 3, 0, 1, 2, 3, 0, 1]), [0, 26, 1, 6]);
    const r = reducePens(img, 2);
    expect(r.kept).toEqual([2, 3]); // Blue then Bright Red appear first
    // Black is nearer to Blue (128^2) than to Bright Red (255^2); Bright White is nearer to Bright Red? W-R = 255^2*2, W-B=(255,255,127): 255^2*2+127^2 -> Red
    expect(r.merges.map((m) => [m.from, m.to])).toEqual([[0, 2], [1, 3]]);
    // equidistant: Black is 128 away from both Blue (palette 0) and Green (palette 1); the earlier kept entry wins
    const tie = fromFirmware(4, 1, new Uint8Array([0, 0, 1, 1, 2]), [1, 9, 0]);
    const t = reducePens({ ...tie, w: 5 }, 2);
    expect(t.fits).toBe(false);
    expect(t.kept).toEqual([0, 1]);
    expect(t.merges).toEqual([{ from: 2, to: 0, fromName: 'Black', toName: 'Blue', pixels: 1 }]);
    expect(t.used).toBe(3);
  });
  it('ignores unused palette entries and leaves transparent pixels alone', () => {
    const img = fromFirmware(3, 1, new Uint8Array([TRANSPARENT, 0, 0]), [0, 26, 6, 1, 9, 12]);
    const r = reducePens(img, 2);
    expect(r.used).toBe(1);
    expect(r.fits).toBe(true);
    expect(r.kept).toEqual([0]);
    expect(Array.from(r.pixels)).toEqual([TRANSPARENT, 0, 0]);
  });
  it('is deterministic', () => {
    const a = reducePens(sample(), 2);
    const b = reducePens(sample(), 2);
    expect(b).toEqual(a);
  });
});

describe('mergeNote / pensLabel', () => {
  const fake = (over: Partial<Reduced>): Reduced => ({ mode: 1, limit: 4, used: 7, fits: false, kept: [0, 1, 2, 3], pixels: new Uint8Array(0), merges: [], ...over });
  const m = (name: string) => ({ from: 0, to: 1, fromName: name, toName: 'Black', pixels: 1 });
  it('fits, singular and plural', () => {
    expect(mergeNote(fake({ fits: true, used: 7, limit: 16, kept: [] }))).toBe('fits: 7 colours');
    expect(mergeNote(fake({ fits: true, used: 1 }))).toBe('fits: 1 colour');
    expect(pensLabel(fake({ fits: true, used: 7, limit: 16 }))).toBe('7 of 16 pens');
  });
  it('lists one, two and three merged colours, and counts more than three', () => {
    expect(mergeNote(fake({ used: 5, merges: [m('Pink')] }))).toBe('5 colours → 4: pink merged');
    expect(mergeNote(fake({ used: 6, merges: [m('Pink'), m('Sky Blue')] }))).toBe('6 colours → 4: pink and sky blue merged');
    expect(mergeNote(fake({ merges: [m('Pink'), m('Blue'), m('White')] }))).toBe('7 colours → 4: pink, blue and white merged');
    expect(mergeNote(fake({ used: 9, merges: [m('a'), m('b'), m('c'), m('d'), m('e')] }))).toBe('9 colours → 4: 5 colours merged');
    expect(pensLabel(fake({}))).toBe('4 of 4 pens (7 colours)');
  });
});

describe('geometry', () => {
  it('shape labels', () => {
    expect([0, 1, 2].map((x) => shapeLabel(x as 0 | 1 | 2))).toEqual(['2 : 1', '1 : 1', '1 : 2']);
  });
  it('on-screen pixel and size', () => {
    expect(onScreenPixel(0)).toEqual({ w: 4, h: 2 });
    expect(onScreenPixel(1)).toEqual({ w: 2, h: 2 });
    expect(onScreenPixel(2)).toEqual({ w: 1, h: 2 });
    expect(onScreenSize({ w: 16, h: 16 }, 0)).toEqual({ w: 64, h: 32, fits: true });
    expect(onScreenSize({ w: 16, h: 16 }, 1)).toEqual({ w: 32, h: 32, fits: true });
    expect(onScreenSize({ w: 320, h: 200 }, 1).fits).toBe(true);
    expect(onScreenSize({ w: 320, h: 200 }, 0).fits).toBe(false);
    expect(onScreenSize({ w: 100, h: 201 }, 2).fits).toBe(false);
  });
  it('displaySize', () => {
    expect(displaySize({ w: 16, h: 16 }, 0, 6)).toEqual({ w: 192, h: 96, px: 12, py: 6 });
    expect(displaySize({ w: 16, h: 16 }, 1, 6)).toEqual({ w: 96, h: 96, px: 6, py: 6 });
    expect(displaySize({ w: 16, h: 16 }, 2, 6)).toEqual({ w: 48, h: 96, px: 3, py: 6 });
  });
  it('fitScale keeps pixels whole, even scales in mode 2', () => {
    const img = { w: 16, h: 16 };
    expect(fitScale(img, 0, 200, 112)).toBe(6);
    expect(fitScale(img, 1, 200, 112)).toBe(7);
    expect(fitScale(img, 2, 200, 112)).toBe(6); // 7 rounds down to the even 6
    expect(fitScale(img, 2, 360, 240)).toBe(14);
    expect(fitScale(img, 1, 360, 240)).toBe(15);
    expect(fitScale(img, 0, 360, 240)).toBe(11);
    expect(fitScale({ w: 1000, h: 1000 }, 1, 10, 10)).toBe(1);
    expect(fitScale({ w: 1000, h: 1000 }, 2, 10, 10)).toBe(2);
    for (const mode of [0, 1, 2] as const) {
      const s = fitScale(img, mode, 360, 240);
      const d = displaySize(img, mode, s);
      expect(Number.isInteger(d.px)).toBe(true);
      expect(d.w <= 360 && d.h <= 240).toBe(true);
    }
  });
});
