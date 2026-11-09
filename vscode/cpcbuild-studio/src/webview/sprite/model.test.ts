import { describe, expect, it } from 'vitest';
import { TRANSPARENT as PT } from '../../core/cpcPreview';
import { applySpriteOp, convertPens, newSprite, rowsOf, type SpriteState } from '../../core/spriteDoc';
import type { SpriteView } from '../../shared/spriteProtocol';
import { colourOf, decodeItems, grid16, neighbourView, penSlots, previewSource, renderRgba, shapeCells, stamps, tile16, tile16Target, topValue } from './model';

function viewOf(s: SpriteState): SpriteView {
  return {
    docType: s.type, kind: s.kind, mode: s.mode, name: s.name, w: s.w, h: s.h, masked: s.masked, items: s.items.map((g) => rowsOf(g, s.kind === 'plus')),
    pens: 'pens' in s.palette ? s.palette.pens : undefined, colours: 'colours' in s.palette ? s.palette.colours : undefined,
  } as unknown as SpriteView;
}

describe('sprite webview model', () => {
  it('decodes the host rows and renders RGBA (transparent = alpha 0)', () => {
    const s = newSprite('spr', { mode: 1, w: 4, h: 1, masked: true });
    s.items = [[[0, 1, -1, 3]]];
    const v = viewOf(s);
    expect(decodeItems(v)).toEqual(s.items);
    const px = renderRgba(s.items[0], v);
    expect(Array.from(px.slice(4, 8))).toEqual([255, 255, 255, 255]); // pen 1 = firmware 26
    expect(px[11]).toBe(0);
  });
  it('plus colours and pen slots (transparent first, 15 colours)', () => {
    const v = viewOf(newSprite('spr', { kind: 'plus' }));
    expect(colourOf(v, 2)).toEqual([255, 255, 255]);
    const slots = penSlots(v);
    expect(slots).toHaveLength(16);
    expect(slots[0].index).toBe(-1);
    expect(topValue(v)).toBe(15);
  });
  it('cpc slots: mode pens, unset slots dashed, duplicates flagged, transparent only when masked', () => {
    const s = newSprite('spr', { mode: 1, masked: true, palette: { pens: [0, 26, 26] } });
    const slots = penSlots(viewOf(s));
    expect(slots.map((x) => x.index)).toEqual([-1, 0, 1, 2, 3]);
    expect(slots[3].warn).toMatch(/Same colour as pen 1/);
    expect(slots[4].unset).toBe(true);
    expect(penSlots(viewOf({ ...s, masked: false })).some((x) => x.index === -1)).toBe(false);
    expect(topValue(viewOf(s))).toBe(2);
  });
  it('shape drags: shift squares a rectangle, alt grows from the centre, line snaps', () => {
    expect(shapeCells('rect', [2, 2], [5, 3], { shift: true }).length).toBe(12); // 4x4 outline
    const centred = shapeCells('rect', [5, 5], [7, 6], { alt: true, filled: true });
    expect(centred.length).toBe(5 * 3);
    expect(shapeCells('line', [0, 0], [9, 1], { shift: true }).every(([, y]) => y === 0)).toBe(true);
  });
  it('mirror stamps are clipped and deduplicated', () => {
    expect(stamps([[0, 0]], 4, 4, true, true).length).toBe(4);
    expect(stamps([[1, 1], [2, 1]], 4, 4, true, false).length).toBe(2);
    expect(stamps([[-1, 0], [9, 9]], 4, 4, false, false)).toEqual([]);
  });
  it('tile views: 2x2 arrangement and neighbours', () => {
    const s = newSprite('til', { mode: 1, frames: 5 });
    s.items[1][0][0] = 1; // top-right of group 0
    s.items[2][0][0] = 2; // bottom-left
    const v = viewOf(s);
    const px = tile16(s.items, 0, v);
    expect(px[(0 * 16 + 8) * 4 + 3]).toBe(255);
    expect(px[(8 * 16 + 0) * 4 + 3]).toBe(255);
    expect(tile16Target(0, 9, 3)).toEqual({ item: 1, x: 1, y: 3 });
    expect(tile16Target(1, 3, 12)).toEqual({ item: 6, x: 3, y: 4 });
    const nb = neighbourView(s.items, 1, 4, v);
    expect([nb.width, nb.height]).toEqual([24, 24]);
    expect(nb.neighbours).toEqual([null, null, null, 0, 2, 4, null, null]); // below-left is tile 4; tile 5 does not exist
  });
  it('tile views of narrow tiles (4x8)', () => {
    const s = newSprite('til', { mode: 0, tileWidth: 4, frames: 5 });
    s.items[1][0][0] = 1; // top-right of group 0
    s.items[2][0][0] = 2; // bottom-left
    const v = viewOf(s);
    const px = tile16(s.items, 0, v);
    expect(px.length).toBe(8 * 16 * 4);
    expect(px[(0 * 8 + 4) * 4 + 3]).toBe(255);
    expect(px[(8 * 8 + 0) * 4 + 3]).toBe(255);
    expect(tile16Target(0, 5, 3, 4, 8)).toEqual({ item: 1, x: 1, y: 3 });
    expect(tile16Target(1, 3, 12, 4, 8)).toEqual({ item: 6, x: 3, y: 4 });
    const nb = neighbourView(s.items, 1, 4, v);
    expect([nb.width, nb.height]).toEqual([12, 24]);
    expect(nb.rgba.length).toBe(12 * 24 * 4);
    expect(nb.neighbours).toEqual([null, null, null, 0, 2, 4, null, null]);
  });
});

describe('CPC preview source', () => {
  /** Two frames, mode 0, pens: Blue, Pink, Bright Red, Sky Blue, Bright Yellow, Bright White, Black. */
  const doc = (): SpriteState => {
    const s = newSprite('spr', { mode: 0, w: 4, h: 2, masked: true, palette: { pens: [1, 16, 6, 11, 24, 26, 0] } });
    s.items = [[[1, 1, 2, -1], [6, 6, 3, 0]], [[1, 2, 6, 6], [4, 5, 1, 1]]];
    return s;
  };
  it('reduce() is convertPens over all frames, shown through the picked frame', () => {
    const s = doc();
    const src = previewSource(s.items, (its) => its[0], s.palette && 'pens' in s.palette ? s.palette.pens : [], false);
    expect(src.image.w).toBe(4);
    expect(src.image.pixels[3]).toBe(PT);
    const r = src.reduce(1);
    const c = convertPens(s, 1);
    expect(r.used).toBe(c.summary.used);
    expect(r.merges).toEqual(c.summary.merges);
    expect(r.fits).toBe(c.summary.fits);
    // each shown pixel has the colour the converted frame gets: the colour of the converted pen
    const pens = 'pens' in c.palette ? c.palette.pens : [];
    const inPens = 'pens' in s.palette ? s.palette.pens : [];
    c.items[0].forEach((row, y) => row.forEach((q, x) => {
      const px = r.pixels[y * 4 + x];
      if (q < 0) expect(px).toBe(PT);
      else expect(inPens[px]).toBe(pens[q]);
    }));
  });
  it('the preview shows the same pixels as the document after Convert', () => {
    const s = doc();
    const pens = (s.palette as { pens: number[] }).pens;
    const after = applySpriteOp(s, { op: 'setMode', mode: 1, force: true });
    if ('error' in after) throw new Error(after.error);
    const afterPens = (after.state.palette as { pens: number[] }).pens;
    for (const frame of [0, 1]) {
      const r = previewSource(s.items, (its) => its[frame], pens, false).reduce(1);
      after.state.items[frame].forEach((row, y) => row.forEach((q, x) => {
        const px = r.pixels[y * 4 + x];
        if (q < 0) expect(px).toBe(PT);
        else expect(pens[px]).toBe(afterPens[q]);
      }));
    }
  });
  it('a shared palette keeps pen numbers', () => {
    const s = newSprite('spr', { mode: 0, w: 2, h: 1, palette: { file: 'p.cpcpal' } });
    s.items = [[[0, 5]]];
    const file = [0, 26, 6, 18, 1, 24];
    const r = previewSource(s.items, (its) => its[0], file, true).reduce(1);
    expect(Array.from(r.pixels)).toEqual([0, 1]); // pen 5 (Bright Yellow) is nearest the file's pen 1 (Bright White) by the lowest-pen rule
  });
  it('grid16 puts tiles 4t..4t+3 in a 2 x 2 block and leaves missing tiles transparent', () => {
    const t = (v: number) => [[v, v], [v, v]];
    const g = grid16([t(1), t(2), t(3)], 0, 2, 2);
    expect(g).toEqual([[1, 1, 2, 2], [1, 1, 2, 2], [3, 3, -1, -1], [3, 3, -1, -1]]);
  });
});
