import { describe, expect, it } from 'vitest';
import { newSprite, rowsOf, type SpriteState } from '../../core/spriteDoc';
import type { SpriteView } from '../../shared/spriteProtocol';
import { colourOf, decodeItems, neighbourView, penSlots, renderRgba, shapeCells, stamps, tile16, tile16Target, topValue } from './model';

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
  it('tile views: 16x16 arrangement and neighbours', () => {
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
    expect(nb.size).toBe(24);
    expect(nb.neighbours).toEqual([null, null, null, 0, 2, 4, null, null]); // below-left is tile 4; tile 5 does not exist
  });
});
