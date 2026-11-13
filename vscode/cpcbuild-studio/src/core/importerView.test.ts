import { describe, expect, it } from 'vitest';
import { defaultGrid } from './cpcgrid';
import { reducePens } from './cpcPreview';
import { composedSource, mappingRows, parseHexRgb, previewResultImage, previewSourceImage, resultState, rgbHex, type PreviewLike } from './importerView';

/** A w x h RGBA image from a list of RGB triples (null = transparent). */
const rgba = (w: number, h: number, px: ([number, number, number] | null)[]): { width: number; height: number; rgba: Uint8ClampedArray } => {
  const d = new Uint8ClampedArray(w * h * 4);
  px.forEach((p, i) => d.set(p ? [p[0], p[1], p[2], 255] : [0, 0, 0, 0], i * 4));
  return { width: w, height: h, rgba: d };
};
const BLACK: [number, number, number] = [0, 0, 0], WHITE: [number, number, number] = [255, 255, 255], RED: [number, number, number] = [255, 0, 0];

describe('resultState (F17)', () => {
  it('an error wins, then stale, else up to date', () => {
    expect(resultState({ error: true, stale: true, outputExists: true })).toMatchObject({ state: 'bad', text: 'Error' });
    expect(resultState({ error: false, stale: true, outputExists: true })).toMatchObject({ state: 'warn', text: 'Out of date' });
    expect(resultState({ error: false, stale: true, outputExists: false, output: 'a.bas' }).title).toBe('a.bas has not been generated yet.');
    expect(resultState({ error: false, stale: false, outputExists: true })).toMatchObject({ state: 'ok', text: 'Result up to date' });
  });
});

describe('hex colours', () => {
  it('round trip, with or without #', () => {
    expect(parseHexRgb('#ff00Ff')).toEqual([255, 0, 255]);
    expect(parseHexRgb('FF00FF')).toEqual([255, 0, 255]);
    expect(parseHexRgb('nope')).toBeUndefined();
    expect(parseHexRgb(undefined)).toBeUndefined();
    expect(rgbHex([1, 171, 255])).toBe('01ABFF');
  });
});

describe('preview images', () => {
  it('the source image: nearest firmware colours, the recipe transparent colour and alpha are transparent', () => {
    const src = rgba(2, 2, [BLACK, WHITE, RED, null]);
    const a = previewSourceImage(src, {})!;
    expect(a.palette).toHaveLength(3);
    expect(a.pixels[3]).toBe(255);
    const b = previewSourceImage(src, { transparent: 'FF0000' })!;
    expect(b.pixels[2]).toBe(255);
    expect(b.palette).toHaveLength(2); // the keyed colour is not opaque, so it takes no palette slot
  });
  it('lets reducePens show the merges for a mode the image does not fit', () => {
    // 3 distinct firmware colours in a 4 pen mode fit; 17 would not fit mode 0. Use 3 colours in mode 2 (2 pens).
    const img = previewSourceImage(rgba(3, 1, [BLACK, WHITE, RED]), {})!;
    const m2 = reducePens(img, 2);
    expect(m2.fits).toBe(false);
    expect(m2.merges).toHaveLength(1);
    expect(reducePens(img, 1).fits).toBe(true);
  });
  it('a grid composes the chosen cells first', () => {
    const px = Array.from({ length: 16 }, (_, i) => (i % 4 < 2 ? BLACK : WHITE)); // 4x4: left half black, right half white
    const src = rgba(4, 4, px);
    const g = { ...defaultGrid(4, 4), cellW: 2, cellH: 4, exclude: [0] };
    const c = composedSource(src, g)!;
    expect(c.width).toBe(2);
    expect(c.height).toBe(4);
    expect([...c.rgba.slice(0, 3)]).toEqual([255, 255, 255]);
    expect(composedSource(src, { ...g, exclude: [0, 1] })).toBeUndefined();
    expect(composedSource(src, undefined)).toBe(src);
  });
  it('the result image carries the converter pens and names', () => {
    const p: PreviewLike = { width: 2, height: 1, indices: [0, 255], rows: [{ pen: 0, label: '0', rgb: [0, 0, 0], colours: 1, pixels: 1 }], transparent: 1 };
    const img = previewResultImage(p);
    expect(img.palette[0].name).toBe('Black');
    expect([...img.pixels]).toEqual([0, 255]);
  });
});

describe('mappingRows', () => {
  const rows = [
    { pen: 0, label: '0', rgb: [0, 0, 0] as [number, number, number], colours: 1, pixels: 2 },
    { pen: 1, label: '26', rgb: [255, 255, 255] as [number, number, number], colours: 2, pixels: 2 },
    { pen: 2, label: '26', rgb: [255, 255, 255] as [number, number, number], colours: 0, pixels: 0 },
  ];
  const p: PreviewLike = { width: 3, height: 2, indices: [0, 1, 1, 0, 255, 1], rows, transparent: 1 };
  const input = rgba(3, 2, [BLACK, WHITE, [250, 250, 250], BLACK, null, WHITE]);
  it('one row per source colour, then unused pens; nearest and duplicate are flagged', () => {
    const t = mappingRows(p, input);
    expect(t.transparentPixels).toBe(1);
    expect(t.rows.map((r) => [r.pen.pen, r.src ? rgbHex(r.src) : '-', r.pixels, r.nearest, r.duplicate, r.unused])).toEqual([
      [0, '000000', 2, false, false, false],
      [1, 'FFFFFF', 2, false, true, false],
      [1, 'FAFAFA', 1, true, true, false],
      [2, '-', 0, false, true, true],
    ]);
    expect(t.more).toBe(0);
  });
  it('caps the listed source colours', () => {
    const t = mappingRows(p, input, 1);
    expect(t.rows.filter((r) => !r.unused)).toHaveLength(1);
    expect(t.more).toBe(2);
  });
  it('without the input (or a different size) each pen is a row', () => {
    const t = mappingRows(p, undefined);
    expect(t.rows.map((r) => [r.pen.pen, r.unused])).toEqual([[0, false], [1, false], [2, true]]);
    expect(mappingRows(p, rgba(1, 1, [BLACK])).rows).toHaveLength(3);
  });
});
