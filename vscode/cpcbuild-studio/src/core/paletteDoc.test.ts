import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FW_TABLE, fwRgb, nearestFw, parsePalList, rgb12 } from './palette';
import {
  PaletteOp,
  PaletteState,
  applyOp,
  coloursOfImage,
  duplicatePens,
  emptyPaletteText,
  entryBytes,
  entryRgb,
  kindForFile,
  parsePalette,
  saveProblem,
  serialise,
  snippets,
} from './paletteDoc';

const repo = path.resolve(__dirname, '../../../..');
const fixtures = ['examples/assets/bounce.pal', 'tests/conformance/assets/pens16.pal', 'games/shooter/assets/starfall.pal'];

function must(s: PaletteState, op: PaletteOp): PaletteState {
  const r = applyOp(s, op);
  if ('error' in r) throw new Error(r.error);
  return r.state;
}

describe('palette document: round trip', () => {
  for (const f of fixtures) {
    it(`${f}: serialise(parse(text)) is the text; the pens equal the tool's parse`, () => {
      const text = fs.readFileSync(path.join(repo, f), 'utf8');
      const s = parsePalette(text, 'fw');
      expect(s.errors).toEqual([]);
      expect(serialise(s)).toBe(text);
      expect(s.entries).toEqual(parsePalList(text));
    });
  }

  it('keeps CRLF text and comments exactly while untouched', () => {
    const text = '# my palette\r\n0 , 26,6\r\n18 # trailing\r\n';
    expect(serialise(parsePalette(text, 'fw'))).toBe(text);
  });

  it('after an edit: header and own comments stay, one list line, same eol, img2cpc header count follows', () => {
    const text = '# firmware colours for pens 0-3 (img2cpc, mode 1)\r\n0, 26, 6, 18\r\n# the end\r\n';
    let s = parsePalette(text, 'fw');
    s = must(s, { op: 'addEntry', value: 9 });
    expect(serialise(s)).toBe('# firmware colours for pens 0-4 (img2cpc, mode 1)\r\n0, 26, 6, 18, 9\r\n# the end\r\n');
    expect(parsePalList(serialise(s))).toEqual([0, 26, 6, 18, 9]);
  });

  it('editing back to the loaded entries gives the loaded text again', () => {
    const text = '# x\n0,26,  6,18\n';
    let s = parsePalette(text, 'fw');
    s = must(s, { op: 'setEntry', index: 1, value: 5 });
    expect(serialise(s)).not.toBe(text);
    s = must(s, { op: 'setEntry', index: 1, value: 26 });
    expect(serialise(s)).toBe(text);
  });

  it('the border is a comment the importer ignores', () => {
    let s = parsePalette('0, 1\n', 'fw');
    s = must(s, { op: 'setBorder', value: 13 });
    const t = serialise(s);
    expect(t).toBe('0, 1\n# border: 13\n');
    expect(parsePalList(t)).toEqual([0, 1]);
    expect(parsePalette(t, 'fw').border).toBe(13);
    expect(serialise(must(parsePalette(t, 'fw'), { op: 'setBorder', value: null }))).toBe('0, 1\n');
  });

  it('new-file templates parse cleanly', () => {
    expect(parsePalette(emptyPaletteText('fw'), 'fw').errors).toEqual([]);
    const p12 = parsePalette(emptyPaletteText('rgb12'), 'rgb12');
    expect(p12.errors).toEqual([]);
    expect(p12.entries).toEqual([0x000, 0xfff, 0xf00, 0x0f0]);
  });

  it('kindForFile goes by extension', () => {
    expect(kindForFile('a.cpcpal')).toBe('fw');
    expect(kindForFile('/x/B.CPCPAL12')).toBe('rgb12');
  });
});

describe('palette document: errors match the tool', () => {
  it('a colour outside 0-26 is an error slot with the tool text; saving is refused; fixing it clears it', () => {
    let s = parsePalette('0, 31, 5\n', 'fw');
    expect(s.entries).toEqual([0, -1, 5]);
    expect(s.errors[0]).toMatchObject({ index: 1, token: '31', message: 'palette colour 31 is not a firmware colour (0-26)' });
    expect(saveProblem(s)).toContain('palette colour 31 is not a firmware colour (0-26)');
    // an unrelated edit keeps the bad token verbatim
    expect(serialise(must(s, { op: 'addEntry', value: 2 }))).toBe('0, 31, 5, 2\n');
    s = must(s, { op: 'setEntry', index: 1, value: 3 });
    expect(s.errors).toEqual([]);
    expect(saveProblem(s)).toBeUndefined();
    expect(serialise(s)).toBe('0, 3, 5\n');
  });
  it('a word is a bad entry', () => {
    expect(parsePalette('red\n', 'fw').errors[0].message).toBe("bad palette entry 'red'");
  });
  it('moving and removing keep the error tied to its token', () => {
    const s = parsePalette('1, 99, 2\n', 'fw');
    const m = must(s, { op: 'moveEntry', from: 1, to: 0 });
    expect(m.errors[0].index).toBe(0);
    expect(serialise(m)).toBe('99, 1, 2\n');
    expect(must(s, { op: 'removeEntry', index: 0 }).errors[0].index).toBe(0);
  });
  it('12-bit: bad token message', () => {
    const s = parsePalette('F00, 12, 0G0\n', 'rgb12');
    expect(s.errors.map((e) => e.token)).toEqual(['12', '0G0']);
    expect(s.errors[0].message).toContain('expected three hex digits RGB');
  });
});

describe('palette document: edit operations', () => {
  const base = (): PaletteState => parsePalette('0, 26, 6, 18\n', 'fw');
  it('setEntry validates and extends by one pen', () => {
    expect('error' in applyOp(base(), { op: 'setEntry', index: 0, value: 27 })).toBe(true);
    expect('error' in applyOp(base(), { op: 'setEntry', index: 6, value: 1 })).toBe(true);
    expect(must(base(), { op: 'setEntry', index: 4, value: 1 }).entries).toEqual([0, 26, 6, 18, 1]);
    expect('error' in applyOp(base(), { op: 'setEntry', index: 0, value: 0 })).toBe(true); // unchanged
  });
  it('add stops at 16 pens', () => {
    let s = parsePalette(Array.from({ length: 16 }, (_, i) => i).join(',') + '\n', 'fw');
    expect('error' in applyOp(s, { op: 'addEntry' })).toBe(true);
    s = must(s, { op: 'removeEntry', index: 0 });
    expect(s.entries.length).toBe(15);
  });
  it('move reorders', () => {
    expect(must(base(), { op: 'moveEntry', from: 0, to: 3 }).entries).toEqual([26, 6, 18, 0]);
    expect(must(base(), { op: 'moveEntry', from: 3, to: 1 }).entries).toEqual([0, 18, 26, 6]);
  });
  it('truncate drops pens; reset restores the loaded palette', () => {
    const t = must(base(), { op: 'truncate', count: 2 });
    expect(t.entries).toEqual([0, 26]);
    expect(must(t, { op: 'reset' }).entries).toEqual([0, 26, 6, 18]);
    expect(serialise(must(t, { op: 'reset' }))).toBe('0, 26, 6, 18\n');
  });
  it('an empty palette serialises to an empty list (the tool says "empty palette" when it reads it)', () => {
    const s = must(base(), { op: 'truncate', count: 0 });
    expect(serialise(s)).toBe('');
  });
  it('12-bit entries are positional: gaps fill with 000, only the last can go', () => {
    let s = parsePalette('F00,0F0\n', 'rgb12');
    s = must(s, { op: 'setEntry', index: 4, value: 0x123 });
    expect(s.entries).toEqual([0xf00, 0x0f0, 0, 0, 0x123]);
    expect(serialise(s)).toBe('F00, 0F0, 000, 000, 123\n');
    expect('error' in applyOp(s, { op: 'removeEntry', index: 1 })).toBe(true);
    expect(must(s, { op: 'removeEntry', index: 4 }).entries.length).toBe(4);
    expect('error' in applyOp(s, { op: 'setEntry', index: 32, value: 1 })).toBe(true);
  });
  it('duplicates are reported against the lower pen', () => {
    expect(duplicatePens([0, 5, 7, 5], 4)).toEqual([[1, 3]]);
    expect(duplicatePens([0, 5, 7, 5], 3)).toEqual([]);
  });
});

describe('palette document: colours and snippets', () => {
  it('the grid colours are fw_rgb(n) for n = 0..26', () => {
    for (let n = 0; n < 27; n++) {
      expect(entryRgb('fw', n)).toEqual(FW_TABLE[n]);
      expect(entryRgb('fw', n)).toEqual(fwRgb(n));
    }
    expect(entryRgb('fw', 26)).toEqual([255, 255, 255]);
    expect(entryRgb('fw', 1)).toEqual([0, 0, 128]);
  });
  it('12-bit display value is n*17 and the ASIC bytes are red<<4|blue, green', () => {
    expect(entryRgb('rgb12', 0x1f8)).toEqual([17, 255, 136]);
    expect(entryBytes(0xf0a)).toEqual([0xfa, 0x00]);
    expect(entryBytes(0x1f8)).toEqual([0x18, 0x0f]);
  });
  it('copy as: Boriel snippet, bare list, SetInk lines (spec 4.1 US4)', () => {
    const s = must(parsePalette('0, 26, 6, 18\n', 'fw'), { op: 'setBorder', value: 0 });
    const [b, l, i] = snippets(s);
    expect(b.text).toBe('DIM pal(3) AS UBYTE => {0, 26, 6, 18}\nSetPalette(@pal(0), 4)\nSetBorder 0\n');
    expect(l.text).toBe('0,26,6,18');
    expect(i.text).toBe('SetInk 0, 0\nSetInk 1, 26\nSetInk 2, 6\nSetInk 3, 18\nSetBorder 0\n');
  });
  it('copy as, Plus: SetPalette12 lines and the SetPalette12Block byte array (US5)', () => {
    const s = parsePalette('000, FFF, F0A\n', 'rgb12');
    const [lines, arr] = snippets(s);
    expect(lines.text).toBe('SetPalette12 0, &H0000\nSetPalette12 1, &H0FFF\nSetPalette12 2, &H0F0A\n');
    expect(arr.text).toBe('DIM pal12(5) AS UBYTE => {&H00, &H00, &HFF, &H0F, &HFA, &H00}\nSetPalette12Block(@pal12(0), 0, 3)\n');
  });
  it('Plus entries 16 and 17+ become SetBorder12 and SpriteColour', () => {
    const s = parsePalette(Array.from({ length: 18 }, () => '123').join(','), 'rgb12');
    const t = snippets(s)[0].text;
    expect(t).toContain('SetBorder12 &H0123');
    expect(t).toContain('SpriteColour 1, &H0123');
  });
  it('colours of an image: first appearance, nearest firmware colour, one entry per colour', () => {
    const px: ([number, number, number] | null)[] = [[255, 255, 255], null, [10, 10, 10], [250, 250, 250], [0, 0, 0], [255, 0, 0]];
    expect(coloursOfImage('fw', px, nearestFw, rgb12)).toEqual([26, 0, 6]);
    expect(coloursOfImage('rgb12', px, nearestFw, rgb12)).toEqual([0xfff, 0x111, 0x000, 0xf00]);
  });
});
