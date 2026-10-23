import { describe, expect, it } from 'vitest';
import { ellipseCells, floodRegion, lineCells, mirrorPoints, rectCells, snapLine } from './shapes';
import {
  analyse, applySpriteOp, background, blankGrid, newSprite, parseSprite, resolvePalette, rowsOf, serialiseSprite,
  type Grid, type SpriteOp, type SpriteState,
} from './spriteDoc';

/** Grid from row strings ('.' = transparent). */
const g = (...rows: string[]): Grid => rows.map((r) => Array.from(r, (c) => (c === '.' ? -1 : parseInt(c, 16))));
const rows = (x: Grid): string[] => rowsOf(x, false);

function doc(items: Grid[], o: Parameters<typeof newSprite>[1] = {}, type: 'spr' | 'til' = 'spr'): SpriteState {
  const s = newSprite(type, { mode: 1, ...o });
  s.items = items;
  return s;
}
function run(s: SpriteState, op: SpriteOp): SpriteState {
  const r = applySpriteOp(s, op);
  if ('error' in r) throw new Error(r.error);
  return r.state;
}
const err = (s: SpriteState, op: SpriteOp): string => {
  const r = applySpriteOp(s, op);
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
};

describe('parse and serialise', () => {
  const text = `{
  "format": "cpcspr",
  "version": 1,
  "kind": "cpc",
  "mode": 1,
  "name": "hero",
  "frame": {"w": 4, "h": 2},
  "masked": true,
  "palette": {"pens": [0, 26, 6, 18]},
  "frames": [
    [
      "0123",
      ".1.3"
    ]
  ],
  "output": "hero.bas",
  "emitPalette": true
}
`;
  it('reads the spec example shape', () => {
    const s = parseSprite(text, 'spr');
    expect([s.kind, s.mode, s.name, s.w, s.h, s.masked]).toEqual(['cpc', 1, 'hero', 4, 2, true]);
    expect(s.palette).toEqual({ pens: [0, 26, 6, 18] });
    expect(rows(s.items[0])).toEqual(['0123', '.1.3']);
  });
  it('canonical text is a fixed point; an unedited document keeps its own layout and extra keys', () => {
    const s = parseSprite(text, 'spr');
    expect(serialiseSprite(s)).toBe(text);
    const odd = '{"format":"cpcspr","mode":1,"frame":{"w":4,"h":1},"frames":[["0123"]],"future":{"a":1}}';
    const o = parseSprite(odd, 'spr', 'my-sprite');
    expect(o.name).toBe('my_sprite');
    expect(serialiseSprite(o)).toBe(odd);
    const edited = run(o, { op: 'paint', item: 0, pixels: [[0, 0, 3]] });
    const out = serialiseSprite(edited);
    expect(out).toContain('"future": {"a":1}');
    expect(rows(parseSprite(out, 'spr').items[0])).toEqual(['3123']);
    // undoing back to the loaded document gives the loaded text
    expect(serialiseSprite(run(edited, { op: 'paint', item: 0, pixels: [[0, 0, 0]] }))).toBe(odd);
  });
  it('round-trips every kind', () => {
    for (const s of [
      newSprite('spr', { mode: 0, frames: 3, masked: false }),
      newSprite('spr', { mode: 2, w: 16, h: 3 }),
      newSprite('spr', { kind: 'plus', frames: 2 }),
      newSprite('til', { mode: 1, frames: 5 }),
    ]) {
      const t = serialiseSprite(s);
      const back = parseSprite(t, s.type);
      expect(back.items).toEqual(s.items);
      expect(serialiseSprite({ ...back, source: { text: '', key: '' } })).toBe(t);
    }
  });
  it('a Plus sprite writes 0 for transparent and reads . too', () => {
    const p = newSprite('spr', { kind: 'plus' });
    p.items[0][0][0] = 5;
    p.items[0][0][1] = 15;
    const t = serialiseSprite(p);
    expect(t).toContain('"5F00000000000000"');
    expect(t).toContain('"kind": "plus"');
    expect(t).toContain('"plus": {"packed": false, "format": "bas"}');
    expect(t).not.toContain('"mode"');
    const back = parseSprite(t.replace('"5F00000000000000"', '"5F.0000000000000"'), 'spr');
    expect(back.items[0][0].slice(0, 3)).toEqual([5, 15, -1]);
  });
  it('rejects what cannot be shown, with messages', () => {
    expect(() => parseSprite('{nope', 'spr')).toThrow(/not valid JSON/);
    expect(() => parseSprite('{"format":"cpctil"}', 'spr')).toThrow(/must be "cpcspr"/);
    expect(() => parseSprite('{"format":"cpcspr","mode":3,"frame":{"w":4,"h":1}}', 'spr')).toThrow(/"mode" must be 0, 1 or 2/);
    expect(() => parseSprite('{"format":"cpcspr","mode":1,"frame":{"w":4,"h":2},"frames":[["0123"]]}', 'spr')).toThrow(/frame 0 has 1 rows, expected 2/);
    expect(() => parseSprite('{"format":"cpcspr","mode":1,"frame":{"w":4,"h":1},"frames":[["01x3"]]}', 'spr')).toThrow(/frame 0, row 0, column 2: 'x'/);
    expect(() => parseSprite('{"format":"cpcspr","version":2,"mode":1,"frame":{"w":4,"h":1}}', 'spr')).toThrow(/newer/);
    expect(() => parseSprite('{"format":"cpcspr","mode":1,"frame":{"w":4,"h":1},"palette":{"pens":[0,40]}}', 'spr')).toThrow(/not a firmware colour/);
  });
  it('empty text is a new default document', () => {
    const s = parseSprite('', 'til', '3d-tiles');
    expect([s.type, s.name, s.items.length, s.w, s.h]).toEqual(['til', 'img_3d_tiles', 1, 8, 8]);
  });
  it('tile sets are 8x8 whatever the frame field says, and keep dedupe', () => {
    const t = newSprite('til', { mode: 0 });
    t.dedupe = true;
    const back = parseSprite(serialiseSprite(t), 'til');
    expect(back.dedupe).toBe(true);
    expect(back.items[0]).toHaveLength(8);
  });
});

describe('tile width', () => {
  const til = (tileWidth?: number, mode: 0 | 1 | 2 = 0): SpriteState => newSprite('til', { mode, tileWidth });
  it('a file without tileWidth is 8 wide and round-trips byte for byte; tileWidth is only written when not 8', () => {
    const text = serialiseSprite(til());
    expect(text).not.toContain('tileWidth');
    expect(parseSprite(text, 'til').w).toBe(8);
    expect(serialiseSprite(parseSprite(text, 'til'))).toBe(text);
    const narrow = til(4);
    const t = serialiseSprite(narrow);
    expect(t).toContain('"tileWidth": 4');
    const back = parseSprite(t, 'til');
    expect([back.w, back.h, back.items[0][0].length]).toEqual([4, 8, 4]);
    expect(serialiseSprite(back)).toBe(t);
    // an explicit 8 loads and saves untouched until edited
    const explicit = text.replace('  "name"', '  "tileWidth": 8,\n  "name"');
    expect(serialiseSprite(parseSprite(explicit, 'til'))).toBe(explicit);
  });
  it('a bad tileWidth is refused at load; one the mode does not allow is a problem of the set', () => {
    expect(() => parseSprite('{"format":"cpctil","mode":0,"tileWidth":"4","palette":{"pens":[0,1]}}', 'til')).toThrow(/tileWidth/);
    const t = parseSprite('{"format":"cpctil","mode":0,"tileWidth":16,"palette":{"pens":[0,1]},"tiles":[]}', 'til');
    expect(analyse({ ...t, items: [blankGrid(16, 8, 0)] }).problems[0]).toBe('tile width 16 must be 2, 4 or 8 pixels in mode 0 (1, 2 or 4 bytes)');
  });
  it('setTileWidth resizes every tile: legal widths only, narrowing asks, widening pads', () => {
    const s = doc([g('11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111', '11111111')], { mode: 0 }, 'til');
    expect(err(s, { op: 'setTileWidth', w: 6 })).toBe('tile width 6 must be 2, 4 or 8 pixels in mode 0 (1, 2 or 4 bytes)');
    expect(err(s, { op: 'setTileWidth', w: 8 })).toBe('unchanged');
    expect(err(s, { op: 'setTileWidth', w: 4 })).toMatch(/^crop: 32 drawn pixels would be cropped/);
    const n = run(s, { op: 'setTileWidth', w: 4, crop: true });
    expect([n.w, n.h, n.items[0][0].length]).toEqual([4, 8, 4]);
    const analysis = analyse(n);
    expect([analysis.itemBytes, analysis.totalBytes, analysis.problems]).toEqual([16, 16, []]);
    const wide = run(n, { op: 'setTileWidth', w: 8 });
    expect(rows(wide.items[0])[0]).toBe('11110000');
    expect(err(newSprite('spr', {}), { op: 'setTileWidth', w: 4 })).toMatch(/only tile sets/);
  });
  it('a mode change that leaves the width illegal is refused; a legal one keeps the width', () => {
    const s = til(2); // 2 px = 1 byte in mode 0
    expect(err(s, { op: 'setMode', mode: 1 })).toBe('tile width 2 must be 4, 8 or 16 pixels in mode 1 (1, 2 or 4 bytes); change the tile width first');
    const m = run(til(4), { op: 'setMode', mode: 1, force: true });
    expect([m.mode, m.w, m.items[0][0].length]).toEqual([1, 4, 4]);
    expect(analyse(m).itemBytes).toBe(8);
  });
  it('duplicates are found on narrow tiles', () => {
    const a = blankGrid(4, 8, 1);
    expect(analyse(doc([a, blankGrid(4, 8, 0), a], { mode: 0, tileWidth: 4 }, 'til')).duplicates).toEqual([[2, 0]]);
  });
});

describe('paint, fill, replace', () => {
  const base = (): SpriteState => doc([g('0000', '0000', '0000')], { w: 4, h: 3, masked: false });
  it('paint is one edit, validates pens and bounds', () => {
    const s = run(base(), { op: 'paint', item: 0, pixels: [[1, 1, 2], [2, 1, 3]] });
    expect(rows(s.items[0])).toEqual(['0000', '0230', '0000']);
    expect(err(base(), { op: 'paint', item: 0, pixels: [[4, 0, 1]] })).toMatch(/outside/);
    expect(err(base(), { op: 'paint', item: 0, pixels: [[0, 0, 4]] })).toMatch(/pen 4 is not available/);
    expect(err(base(), { op: 'paint', item: 1, pixels: [[0, 0, 1]] })).toMatch(/no frame 1/);
    expect(err(base(), { op: 'paint', item: 0, pixels: [[0, 0, 0]] })).toBe('unchanged');
  });
  it('unset pens of a short palette cannot be painted', () => {
    const s = doc([g('00')], { w: 2, h: 1, mode: 0, palette: { pens: [0, 26, 6] } });
    expect(err(s, { op: 'paint', item: 0, pixels: [[0, 0, 3]] })).toMatch(/pen 3 is not available/);
    run(s, { op: 'paint', item: 0, pixels: [[0, 0, 2]] });
  });
  it('transparent is paintable in a Plus sprite, colour 0 is not', () => {
    const p = newSprite('spr', { kind: 'plus' });
    const s = run(p, { op: 'paint', item: 0, pixels: [[0, 0, 4]] });
    expect(run(s, { op: 'paint', item: 0, pixels: [[0, 0, -1]] }).items[0][0][0]).toBe(-1);
    expect(err(p, { op: 'paint', item: 0, pixels: [[0, 0, 0]] })).toMatch(/not in the palette/);
    expect(err(newSprite('spr', { kind: 'plus', palette: { colours: ['F00', '0F0'] } }), { op: 'paint', item: 0, pixels: [[0, 0, 3]] })).toMatch(/2 colours/);
  });
  it('flood fill is 4-connected and treats transparent as its own value', () => {
    const s = doc([g('1.1.', '.1..', '..11', '.1..')], { w: 4, h: 4, masked: true });
    const f = run(s, { op: 'fill', item: 0, x: 0, y: 1, value: 2 });
    // reference: naive repeated relaxation
    const ref = naiveFill(s.items[0], 0, 1, 2);
    expect(f.items[0]).toEqual(ref);
    // diagonal neighbours are not connected
    const d = doc([g('1.', '.1')], { w: 2, h: 2, masked: true });
    expect(run(d, { op: 'fill', item: 0, x: 1, y: 1, value: 3 }).items[0]).toEqual(g('1.', '.3'));
    expect(err(s, { op: 'fill', item: 0, x: 0, y: 0, value: 1 })).toBe('unchanged');
  });
  it('fill respects a selection box', () => {
    const s = doc([g('0000', '0000', '0000')], { w: 4, h: 3, masked: false });
    const f = run(s, { op: 'fill', item: 0, x: 1, y: 1, value: 2, box: { x: 1, y: 0, w: 2, h: 2 } });
    expect(rows(f.items[0])).toEqual(['0220', '0220', '0000']);
  });
  it('replace colour: this frame or all', () => {
    const s = doc([g('1122'), g('2211')], { w: 4, h: 1, masked: false });
    expect(run(s, { op: 'replace', item: 0, from: 1, to: 3 }).items.map(rows)).toEqual([['3322'], ['2211']]);
    expect(run(s, { op: 'replace', item: 0, from: 1, to: 3, all: true }).items.map(rows)).toEqual([['3322'], ['2233']]);
    expect(err(s, { op: 'replace', item: 0, from: 3, to: 1 })).toBe('unchanged');
  });
});

function naiveFill(src: Grid, x: number, y: number, v: number): Grid {
  const t = src[y][x];
  const out = src.map((r) => r.slice());
  const mark = src.map((r) => r.map(() => false));
  mark[y][x] = true;
  for (let changed = true; changed; ) {
    changed = false;
    for (let j = 0; j < src.length; j++)
      for (let i = 0; i < src[0].length; i++)
        if (!mark[j][i] && src[j][i] === t && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => mark[j + dy]?.[i + dx])) {
          mark[j][i] = true;
          changed = true;
        }
  }
  for (let j = 0; j < src.length; j++) for (let i = 0; i < src[0].length; i++) if (mark[j][i]) out[j][i] = v;
  return out;
}

describe('transforms against a reference', () => {
  const four = (): SpriteState => doc([g('0123', '1230', '2301', '3012')], { w: 4, h: 4, masked: false });
  it('flip horizontal and vertical', () => {
    expect(rows(run(four(), { op: 'flipH', item: 0 }).items[0])).toEqual(['3210', '0321', '1032', '2103']);
    expect(rows(run(four(), { op: 'flipV', item: 0 }).items[0])).toEqual(['3012', '2301', '1230', '0123']);
  });
  it('flip inside a selection only', () => {
    expect(rows(run(four(), { op: 'flipH', item: 0, rect: { x: 1, y: 1, w: 3, h: 2 } }).items[0])).toEqual(['0123', '1032', '2103', '3012']);
  });
  it('rotate 90 clockwise and counter-clockwise (and four turns come back)', () => {
    const cw = run(four(), { op: 'rotate', item: 0 });
    // reference: row y of the clockwise rotation is column y of the source read bottom to top
    const src = four().items[0];
    const refCw = src.map((_, y) => src.map((_, x) => src[src.length - 1 - x][y]));
    expect(cw.items[0]).toEqual(refCw);
    const ccw = run(four(), { op: 'rotate', item: 0, ccw: true });
    expect(ccw.items[0]).toEqual(src.map((_, y) => src.map((_, x) => src[x][src.length - 1 - y])));
    let t = four();
    for (let i = 0; i < 4; i++) t = run(t, { op: 'rotate', item: 0 });
    expect(t.items[0]).toEqual(four().items[0]);
    // a 2x2 selection: [[0,1],[1,2]] turns clockwise into [[1,0],[2,1]]
    expect(rows(run(four(), { op: 'rotate', item: 0, rect: { x: 0, y: 0, w: 2, h: 2 } }).items[0])).toEqual(['1023', '2130', '2301', '3012']);
  });
  it('rotate refuses non-square frames and selections', () => {
    const s = doc([blankGrid(8, 4, 0)], { w: 8, h: 4, masked: false });
    expect(err(s, { op: 'rotate', item: 0 })).toBe('rotate needs a square frame (this one is 8 x 4)');
    expect(err(four(), { op: 'rotate', item: 0, rect: { x: 0, y: 0, w: 3, h: 2 } })).toMatch(/square selection/);
  });
  it('shift wraps, by pixel and whole-frame or selection', () => {
    expect(rows(run(four(), { op: 'shift', item: 0, dx: 1, dy: 0 }).items[0])).toEqual(['3012', '0123', '1230', '2301']);
    expect(rows(run(four(), { op: 'shift', item: 0, dx: -1, dy: 0 }).items[0])).toEqual(['1230', '2301', '3012', '0123']);
    expect(rows(run(four(), { op: 'shift', item: 0, dx: 0, dy: 1 }).items[0])).toEqual(['3012', '0123', '1230', '2301']);
  });
  it('shift by a whole width is a no-op', () => {
    expect(err(four(), { op: 'shift', item: 0, dx: 4, dy: 0 })).toBe('unchanged');
    expect(rows(run(four(), { op: 'shift', item: 0, dx: 1, dy: 0, rect: { x: 1, y: 0, w: 3, h: 1 } }).items[0])[0]).toBe('0312');
  });
  it('clear uses the background of the document', () => {
    expect(rows(run(doc([g('12')], { w: 2, h: 1, masked: true }), { op: 'clear', item: 0 }).items[0])).toEqual(['..']);
    expect(rows(run(doc([g('12')], { w: 2, h: 1, masked: false }), { op: 'clear', item: 0 }).items[0])).toEqual(['00']);
  });
  it('invert reverses pens within the mode count (transparent stays)', () => {
    const m1 = doc([g('0123')], { w: 4, h: 1, mode: 1, masked: true });
    expect(rows(run(m1, { op: 'invert', item: 0 }).items[0])).toEqual(['3210']);
    const tr = doc([g('01.3')], { w: 4, h: 1, mode: 1, masked: true });
    expect(rows(run(tr, { op: 'invert', item: 0 }).items[0])).toEqual(['32.0']);
    const m2 = run(doc([g('0101')], { w: 4, h: 1, mode: 2, palette: { pens: [0, 26] } }), { op: 'invert', item: 0 });
    expect(rows(m2.items[0])).toEqual(['1010']);
    const m0 = run(doc([g('0F')], { w: 2, h: 1, mode: 0 }), { op: 'invert', item: 0 });
    expect(rows(m0.items[0])).toEqual(['F0']);
    const plus = newSprite('spr', { kind: 'plus' });
    plus.items[0][0].splice(0, 3, 1, 15, -1);
    expect(run(plus, { op: 'invert', item: 0 }).items[0][0].slice(0, 3)).toEqual([15, 1, -1]);
  });
});

describe('setItem and paintMany', () => {
  it('setItem replaces a frame, padding or cropping to the frame size', () => {
    const s = doc([g('0000', '0000')], { w: 4, h: 2, masked: true });
    expect(rows(run(s, { op: 'setItem', item: 0, rows: [[1, 2], [3, 3], [2, 2]] }).items[0])).toEqual(['12..', '33..']);
    expect(err(s, { op: 'setItem', item: 0, rows: [[9]] })).toMatch(/pen 9/);
  });
  it('paintMany is one edit across tiles', () => {
    const t = newSprite('til', { mode: 1, frames: 3 });
    const r = run(t, { op: 'paintMany', pixels: [[0, 1, 1, 2], [2, 3, 3, 3]] });
    expect([r.items[0][1][1], r.items[2][3][3], r.items[1][1][1]]).toEqual([2, 3, 0]);
    expect(err(t, { op: 'paintMany', pixels: [[5, 0, 0, 1]] })).toMatch(/no tile 5/);
  });
});

describe('select, move, paste', () => {
  it('move lifts the area, leaves background, transparent cells do not overwrite', () => {
    const s = doc([g('12..', '34..', '....', '....')], { w: 4, h: 4, masked: true });
    const m = run(s, { op: 'move', item: 0, rect: { x: 0, y: 0, w: 2, h: 2 }, dx: 1, dy: 1 });
    expect(rows(m.items[0])).toEqual(['....', '.12.', '.34.', '....']);
    const c = run(s, { op: 'move', item: 0, rect: { x: 0, y: 0, w: 2, h: 2 }, dx: 2, dy: 0, copy: true });
    expect(rows(c.items[0])).toEqual(['1212', '3434', '....', '....']);
  });
  it('move in an unmasked document leaves pen 0 and clips at the edge', () => {
    const s = doc([g('12', '34')], { w: 2, h: 2, masked: false });
    const m = run(s, { op: 'move', item: 0, rect: { x: 0, y: 0, w: 2, h: 2 }, dx: 1, dy: 0 });
    expect(rows(m.items[0])).toEqual(['01', '03']);
  });
  it('paste skips transparent cells and clips', () => {
    const s = doc([g('0000', '0000')], { w: 4, h: 2, masked: false });
    const p = run(s, { op: 'paste', item: 0, x: 3, y: 1, rows: [[1, 2], [-1, 3]] });
    expect(rows(p.items[0])).toEqual(['0000', '0001']);
    const q = run(s, { op: 'paste', item: 0, x: 1, y: 0, rows: [[1, -1, 2]] });
    expect(rows(q.items[0])).toEqual(['0102', '0000']);
  });
  it('fillRect clears a selection', () => {
    const s = doc([g('1111', '1111')], { w: 4, h: 2, masked: true });
    expect(rows(run(s, { op: 'fillRect', item: 0, rect: { x: 1, y: 0, w: 2, h: 2 } }).items[0])).toEqual(['1..1', '1..1']);
    expect(err(s, { op: 'fillRect', item: 0, rect: { x: 3, y: 0, w: 2, h: 2 } })).toMatch(/outside/);
  });
});

describe('frames and tiles', () => {
  const three = (): SpriteState => doc([g('11'), g('22'), g('33')], { w: 2, h: 1, mode: 1, masked: false });
  it('add, duplicate, delete, reorder', () => {
    expect(run(three(), { op: 'addItem' }).items.map(rows)).toEqual([['11'], ['22'], ['33'], ['00']]);
    expect(run(three(), { op: 'addItem', at: 1 }).items.map(rows)).toEqual([['11'], ['00'], ['22'], ['33']]);
    expect(run(three(), { op: 'dupItem', item: 1 }).items.map(rows)).toEqual([['11'], ['22'], ['22'], ['33']]);
    expect(run(three(), { op: 'delItem', item: 1 }).items.map(rows)).toEqual([['11'], ['33']]);
    expect(run(three(), { op: 'moveItem', from: 0, to: 2 }).items.map(rows)).toEqual([['22'], ['33'], ['11']]);
    expect(err(three(), { op: 'moveItem', from: 1, to: 1 })).toBe('unchanged');
  });
  it('a sprite keeps at least one frame; a tile set may become empty', () => {
    const one = doc([g('11')], { w: 2, h: 1, mode: 1 });
    expect(err(one, { op: 'delItem', item: 0 })).toMatch(/at least one frame/);
    const t = newSprite('til', { mode: 1 });
    expect(run(t, { op: 'delItem', item: 0 }).items).toHaveLength(0);
  });
  it('new masked frames are transparent, unmasked are pen 0, Plus transparent', () => {
    expect(rows(run(doc([g('11')], { w: 2, h: 1, masked: true }), { op: 'addItem' }).items[1])).toEqual(['..']);
    expect(rows(run(doc([g('11')], { w: 2, h: 1, masked: false }), { op: 'addItem' }).items[1])).toEqual(['00']);
    expect(background(newSprite('spr', { kind: 'plus' }))).toBe(-1);
  });
  it('the 257th tile is refused with the tool wording', () => {
    const t = newSprite('til', { mode: 1 });
    t.items = Array.from({ length: 256 }, () => blankGrid(8, 8, 0));
    expect(err(t, { op: 'addItem' })).toBe('257 tiles; tile numbers go up to 255');
    expect(err(t, { op: 'dupItem', item: 0 })).toBe('257 tiles; tile numbers go up to 255');
  });
  it('tile duplicates are what --dedupe would drop', () => {
    const t = newSprite('til', { mode: 1 });
    const a = blankGrid(8, 8, 1), b = blankGrid(8, 8, 2);
    t.items = [a, b, a.map((r) => r.slice()), b.map((r) => r.slice()), a.map((r) => r.slice())];
    expect(analyse(t).duplicates).toEqual([[2, 0], [3, 1], [4, 0]]);
    // transparent and pen 0 pack alike, so they count as the same tile
    const u = newSprite('til', { mode: 1 });
    u.items = [blankGrid(8, 8, 0), blankGrid(8, 8, -1)];
    expect(analyse(u).duplicates).toEqual([[1, 0]]);
  });
});

describe('properties, mode and size', () => {
  it('name must be an identifier and the default output follows it', () => {
    const s = newSprite('spr', { name: 'hero' });
    expect(err(s, { op: 'setName', name: '1abc' })).toMatch(/not a valid name/);
    const r = run(s, { op: 'setName', name: 'villain' });
    expect([r.name, r.output]).toEqual(['villain', 'villain.bas']);
    const custom = run(s, { op: 'setOutput', path: 'assets/h.bas' });
    expect(run(custom, { op: 'setName', name: 'villain' }).output).toBe('assets/h.bas');
  });
  it('mode change converts pens by number; it asks when pens would be lost', () => {
    const s = doc([g('0123', '3210')], { w: 4, h: 2, mode: 0, palette: { pens: [0, 26, 6, 18, 2, 24] } });
    // nothing above pen 3 is used, but the palette has 6 pens: asks first
    expect(err(s, { op: 'setMode', mode: 1 })).toBe('mode 1 has 4 pens: pens 4-5 of the palette are dropped');
    const up = run(s, { op: 'setMode', mode: 1, force: true });
    expect(up.mode).toBe(1);
    expect(rows(up.items[0])).toEqual(['0123', '3210']);
  });
  it('mode change: warn about pixels, force turns them into pen 0, palette is cut, width snaps up', () => {
    const s = doc([g('0F', 'A1', '05')], { w: 2, h: 3, mode: 0, masked: false });
    expect(err(s, { op: 'setMode', mode: 1 })).toMatch(/mode 1 has 4 pens: 3 pixels use pens above 3, which become pen 0; pens 4-15 of the palette are dropped/);
    const f = run(s, { op: 'setMode', mode: 1, force: true });
    expect(f.mode).toBe(1);
    expect(f.w).toBe(4);
    expect(rows(f.items[0])).toEqual(['0000', '0100', '0000']); // F and A became pen 0, 5 too; padded with pen 0 (unmasked)
    expect('pens' in f.palette && f.palette.pens.length).toBe(4);
  });
  it('going to a mode with more pens keeps everything', () => {
    const s = doc([g('0123')], { w: 4, h: 1, mode: 1 });
    const up = run(s, { op: 'setMode', mode: 0 });
    expect(rows(up.items[0])).toEqual(['0123']);
    expect('pens' in up.palette && up.palette.pens).toEqual([0, 26, 6, 18]);
  });
  it('mode 2 keeps 2 pens', () => {
    const s = doc([g('01')], { w: 8, h: 1, mode: 1 }); // w 8 ok
    s.items = [g('01010101')];
    expect(err(s, { op: 'setMode', mode: 2 })).toMatch(/pens 2-3 of the palette/);
    const f = run(s, { op: 'setMode', mode: 2, force: true });
    expect('pens' in f.palette && f.palette.pens).toEqual([0, 26]);
  });
  it('size: width must suit the mode; shrinking asks; growing pads with the background', () => {
    const s = doc([g('1111', '1111')], { w: 4, h: 2, mode: 1, masked: true });
    expect(err(s, { op: 'setSize', w: 6, h: 2 })).toBe('frame width 6 is not a multiple of 4 (mode 1)');
    const grown = run(s, { op: 'setSize', w: 8, h: 3 });
    expect(rows(grown.items[0])).toEqual(['1111....', '1111....', '........']);
    expect(err(s, { op: 'setSize', w: 4, h: 1 })).toMatch(/^crop: 4 drawn pixels would be cropped/);
    expect(rows(run(s, { op: 'setSize', w: 4, h: 1, crop: true }).items[0])).toEqual(['1111']);
    const blank = doc([g('....', '....')], { w: 4, h: 2, mode: 1, masked: true });
    expect(run(blank, { op: 'setSize', w: 4, h: 1 }).h).toBe(1); // nothing drawn is lost: no confirmation
  });
  it('masked, palette, flags', () => {
    const s = newSprite('spr', { mode: 1 });
    expect(run(s, { op: 'setMasked', value: false }).masked).toBe(false);
    expect(err(s, { op: 'setMasked', value: true })).toBe('unchanged');
    expect(err(newSprite('til', {}), { op: 'setMasked', value: true })).toMatch(/only CPC sprites/);
    expect(run(s, { op: 'setPens', pens: [3, 4] }).palette).toEqual({ pens: [3, 4] });
    expect(err(s, { op: 'setPens', pens: [0, 1, 2, 3, 4] })).toMatch(/1-4 firmware colours/);
    const f = run(s, { op: 'setPaletteFile', file: 'pens.cpcpal', emitPalette: false });
    expect([f.palette, f.emitPalette]).toEqual([{ file: 'pens.cpcpal' }, false]);
    expect(run(newSprite('til', {}), { op: 'setDedupe', value: true }).dedupe).toBe(true);
    const p = newSprite('spr', { kind: 'plus' });
    expect(run(p, { op: 'setPacked', value: true }).packed).toBe(true);
    const asm = run(p, { op: 'setPlusFormat', value: 'asm' });
    expect([asm.plusFormat, asm.output]).toEqual(['asm', 'sprite.asm']);
    expect(run(p, { op: 'setColours', colours: ['abc'] }).palette).toEqual({ colours: ['ABC'] });
    expect(err(p, { op: 'setColours', colours: Array(16).fill('000') })).toMatch(/15 colours/);
  });
  it('resolves a palette file for CPC and Plus', () => {
    const s = newSprite('spr', { mode: 1, palette: { file: 'p.cpcpal' } });
    expect(resolvePalette(s, '# x\n0, 26, 6, 18\n')).toEqual({ pens: [0, 26, 6, 18] });
    expect(resolvePalette(s, '0, 99').problem).toMatch(/not a firmware colour/);
    expect(resolvePalette(s).problem).toMatch(/could not be read/);
    const p = newSprite('spr', { kind: 'plus', palette: { file: 'p.cpcpal12' } });
    expect(resolvePalette(p, 'F00, 0F0').colours).toEqual(['F00', '0F0']);
    const full = Array.from({ length: 32 }, (_, i) => (i + 1).toString(16).toUpperCase().padStart(3, '0')).join(',');
    expect(resolvePalette(p, full).colours).toEqual(Array.from({ length: 15 }, (_, i) => (i + 18).toString(16).toUpperCase().padStart(3, '0')));
  });
});

describe('analysis and limits', () => {
  it('sizes: NAME_W, NAME_SIZE (doubled when masked), totals', () => {
    const s = newSprite('spr', { mode: 1, w: 16, h: 16, masked: false, frames: 4 });
    let a = analyse(s);
    expect([a.wBytes, a.itemBytes, a.totalBytes]).toEqual([4, 64, 256]);
    a = analyse({ ...s, masked: true });
    expect([a.itemBytes, a.totalBytes]).toEqual([128, 512]);
    expect(analyse(newSprite('til', { mode: 0, frames: 3 })).itemBytes).toBe(32);
    const p = newSprite('spr', { kind: 'plus', frames: 2 });
    expect([analyse(p).itemBytes, analyse({ ...p, packed: true }).itemBytes]).toEqual([256, 128]);
  });
  it('library limits are warnings, constraints are problems', () => {
    const wide = newSprite('spr', { mode: 1, w: 40, h: 4, masked: false });
    expect(analyse(wide).warnings.join()).toMatch(/10 bytes wide; SprListDraw/);
    const huge = newSprite('spr', { mode: 2, w: 2056, h: 4 });
    expect(huge.w).toBe(2056);
    const bad = newSprite('spr', { mode: 1, w: 6, h: 4 });
    expect(analyse(bad).problems[0]).toBe('frame width 6 is not a multiple of 4 (mode 1)');
    const tall = newSprite('spr', { mode: 1, w: 4, h: 300, masked: false });
    expect(analyse(tall).warnings.join()).toMatch(/300 lines tall/);
    const big = newSprite('spr', { mode: 0, w: 256, h: 255, masked: true, frames: 2 });
    expect(analyse(big).problems.join()).toMatch(/would have 130560 bytes/);
  });
  it('unmasked documents count transparent pixels that will be pen 0', () => {
    const s = doc([g('1.1.')], { w: 4, h: 1, masked: false });
    expect(analyse(s).transparentAsPen0).toBe(2);
    expect(analyse({ ...s, masked: true }).transparentAsPen0).toBe(0);
  });
  it('pens beyond the palette are warned, beyond the mode are problems', () => {
    const s = doc([g('0F')], { w: 2, h: 1, mode: 0, palette: { pens: [0, 26] } });
    expect(analyse(s).warnings.join()).toMatch(/pen 15 is used but the palette has only 2 pens/);
    const t = doc([g('05')], { w: 2, h: 1, mode: 1 });
    expect(analyse(t).problems.join()).toMatch(/pen 5 is used but mode 1 has only 4 pens/);
  });
});

describe('shapes', () => {
  it('line includes both ends and leaves no gaps', () => {
    const l = lineCells(0, 0, 7, 3);
    expect(l[0]).toEqual([0, 0]);
    expect(l[l.length - 1]).toEqual([7, 3]);
    expect(l).toHaveLength(8);
    for (let i = 1; i < l.length; i++) expect(Math.max(Math.abs(l[i][0] - l[i - 1][0]), Math.abs(l[i][1] - l[i - 1][1]))).toBe(1);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
  });
  it('snap to 0, 45, 90 degrees', () => {
    expect(snapLine(0, 0, 10, 2)).toEqual([10, 0]);
    expect(snapLine(0, 0, 2, 10)).toEqual([0, 10]);
    expect(snapLine(0, 0, 6, 5)).toEqual([6, 6]);
    expect(snapLine(5, 5, 1, 2)).toEqual([1, 1]);
  });
  it('rectangle outline and filled', () => {
    expect(rectCells(1, 1, 3, 3, false)).toHaveLength(8);
    expect(rectCells(3, 3, 1, 1, true)).toHaveLength(9);
    expect(rectCells(2, 2, 2, 2, false)).toEqual([[2, 2]]);
  });
  it('ellipse stays in its box, is symmetric, and fills solid', () => {
    for (const [w, h] of [[8, 8], [7, 5], [16, 9], [3, 3], [1, 1], [2, 6]]) {
      const o = ellipseCells(0, 0, w - 1, h - 1, false);
      const set = new Set(o.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of o) {
        expect(x >= 0 && x < w && y >= 0 && y < h, `${w}x${h}`).toBe(true);
        expect(set.has(`${w - 1 - x},${y}`), `${w}x${h} mirror x`).toBe(true);
        expect(set.has(`${x},${h - 1 - y}`), `${w}x${h} mirror y`).toBe(true);
      }
      const f = ellipseCells(0, 0, w - 1, h - 1, true);
      expect(f.length).toBeGreaterThanOrEqual(o.length);
      // touches all four sides
      expect(f.some(([x]) => x === 0) && f.some(([x]) => x === w - 1) && f.some(([, y]) => y === 0) && f.some(([, y]) => y === h - 1)).toBe(true);
    }
    expect(ellipseCells(0, 0, 0, 0, false)).toEqual([[0, 0]]);
  });
  it('floodRegion and mirror stamps', () => {
    expect(floodRegion([[1, 1], [0, 1]], 0, 0)).toHaveLength(3);
    expect(mirrorPoints(1, 2, 8, 8, true, true)).toEqual([[1, 2], [6, 2], [1, 5], [6, 5]]);
    expect(mirrorPoints(1, 2, 8, 8, false, false)).toEqual([[1, 2]]);
  });
});
