import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mask } from './bastok';
import { callAt, describeRoutine, paramRanges } from './libhover';
import { indexDocs, sectionFor, slugify } from './libdocs';
import { libraryFiles, loadIndex } from './libfs';
import { buildIndex, LibIndex, parseParams } from './libindex';

const REPO = path.resolve(__dirname, '../../../..');
// the library is cpcbas's lib/, linked into vendor/cpcbas by scripts/link-cpcbas.mjs (its docs are this repo's docs/library.md)
const VENDOR = path.resolve(__dirname, '../../vendor/cpcbas');
const lib: LibIndex = loadIndex(VENDOR);
const d = describe;

/** An independent oracle: unindented SUB/FUNCTION lines (the library declares at column 0; nested and asm `sub` lines are indented). */
function oracle(file: string): string[] {
  const names = new Set<string>();
  for (const l of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^(?:sub|function)\s+(?:fastcall\s+)?([A-Za-z_]\w*)/i.exec(l);
    if (m && !/^private/i.test(m[1])) names.add(m[1].toLowerCase());
  }
  return [...names].sort();
}

d('library index: counts per file', () => {
  const expected: Record<string, number> = {
    'cpcbuild/banks.bas': 9,
    'cpcbuild/display.bas': 7,
    'cpcbuild/fill.bas': 3,
    'cpcbuild/keyboard.bas': 3,
    'cpcbuild/palette.bas': 2,
    'cpcbuild/reserve.bas': 1,
    'cpcbuild/spritelist.bas': 5,
    'cpcbuild/sprites.bas': 3,
    'cpcbuild/text.bas': 6,
    'cpcbuild/tiles.bas': 8,
    'cpcplus/cpcplus.bas': 35,
    'cpcplus/palcycle.bas': 4,
    'cpcplus/sprman.bas': 11,
    'music/music_cpc.bas': 8,
    'stdlib/cpc.bas': 10,
    'stdlib/framehook.bas': 4,
  };
  for (const [f, n] of Object.entries(expected)) {
    it(`${f}: ${n} routines, same names as a column-0 regex`, () => {
      const got = (lib.perFile.get(f) ?? []).map((r) => r.name.toLowerCase()).sort();
      expect(got.length).toBe(n);
      expect(got).toEqual(oracle(path.join(VENDOR, 'lib', f)));
    });
  }
  it('indexes every library file that declares routines, and no others', () => {
    const files = libraryFiles(VENDOR).map((f) => f.path).filter((p) => oracle(path.join(VENDOR, 'lib', p)).length > 0);
    expect([...lib.perFile.keys()].sort()).toEqual(files.sort());
    expect(lib.routines.length).toBe(Object.values(expected).reduce((a, b) => a + b, 0));
  });
});

d('library index: entries', () => {
  it('PutSprite', () => {
    const r = lib.byName.get('putsprite')![0];
    expect(r).toMatchObject({
      name: 'PutSprite',
      kind: 'SUB',
      returns: null,
      file: 'cpcbuild/sprites.bas',
      line: 31,
      platform: 'cpc',
      requires: ['cpcbuild/sprput.asm'],
      signature: 'SUB PutSprite(x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE, spr AS UINTEGER)',
    });
    expect(r.doc).toBe('copy w*h bytes (row by row, top row first) to the screen');
    expect(r.params.map((p) => p.name)).toEqual(['x', 'y', 'w', 'h', 'spr']);
  });
  it('a function with a return type and FASTCALL', () => {
    const r = lib.byName.get('keydown')![0];
    expect(r).toMatchObject({ kind: 'FUNCTION', returns: 'UBYTE', fastcall: true, signature: 'FUNCTION KeyDown(keyNo AS UBYTE) AS UBYTE' });
    expect(r.doc).toBe('1 if that key was down at the last ScanKeys, else 0');
  });
  it('a default parameter value', () => {
    const r = lib.byName.get('textfont')![0];
    expect(r.params[3]).toEqual({ name: 'last', type: 'UBYTE', default: '255' });
    expect(r.signature).toContain('last AS UBYTE = 255');
  });
  it('Plus routines: platform, and bare-only restriction from the #ifdef pair', () => {
    expect(lib.byName.get('spritemove')![0].platform).toBe('plus');
    const r = lib.byName.get('rasterintat')![0];
    expect(r.restriction).toBe('bare');
    expect(r.doc).toMatch(/^BARE MODE ONLY/);
    expect(describeRoutine(r).notes[0]).toMatch(/Bare-metal builds only/);
    expect(lib.byName.get('rasterintclear')![0].restriction).toBe('bare');
    expect(lib.byName.get('plusunlock')![0].restriction).toBeUndefined();
  });
  it('firmware-only routines are found from the refusal stubs, matching the lint list', () => {
    const fw = lib.routines.filter((r) => r.restriction === 'firmware').map((r) => r.name).sort();
    expect(fw).toEqual(['BankLoad', 'SoundBusy', 'SoundEnvelope', 'SoundFree', 'SoundQueue']);
    const bare = lib.routines.filter((r) => r.restriction === 'bare').map((r) => r.name).sort();
    expect(bare).toEqual(['RasterIntAt', 'RasterIntClear', 'RasterIntMove', 'RasterIntOff']);
  });
  it('MusicInit is documented from music.bas / music_cpc.bas; there is no Spectrum variant', () => {
    const mi = lib.byName.get('musicinit')!;
    expect(mi.map((r) => r.platform)).toEqual(['cpc']);
    expect(mi[0].doc.length).toBeGreaterThan(20);
    expect(lib.routines.every((r) => r.platform === 'cpc' || r.platform === 'plus')).toBe(true);
  });
  it('the renamed parameters: penNo, keyNo, scanLine; Mode and WaitVsync are gone', () => {
    expect(lib.byName.get('penbyte')![0].params.map((p) => p.name)).toEqual(['penNo']);
    expect(lib.byName.get('fillrect')![0].signature).toContain('penNo AS UBYTE');
    expect(lib.byName.get('clearscreen')![0].params.map((p) => p.name)).toEqual(['penNo']);
    expect(lib.byName.get('setink')![0].params.map((p) => p.name)).toEqual(['penNo', 'colour']);
    expect(lib.byName.get('setpalette12')![0].params[0].name).toBe('penNo');
    expect(lib.byName.get('keydown')![0].params.map((p) => p.name)).toEqual(['keyNo']);
    for (const n of ['splitscreen', 'splitscreencrtc', 'rasterintat', 'rasterintoff']) expect(lib.byName.get(n)![0].params[0].name, n).toBe('scanLine');
    expect(lib.byName.has('mode')).toBe(false);
    expect(lib.byName.has('waitvsync')).toBe(false);
  });
  it('multi-name header lines document each name', () => {
    expect(lib.byName.get('pluspagein')![0].doc).toMatch(/ASIC's registers at &4000-&7FFF/);
    expect(lib.byName.get('pluspageout')![0].doc).toMatch(/ASIC's registers at &4000-&7FFF/);
  });
  it('settings named in the headers', () => {
    expect(lib.settings.map((s) => s.name).sort()).toEqual(['SPRLIST_MAX', 'TEXT_QUEUE']);
    expect(lib.settings.find((s) => s.name === 'TEXT_QUEUE')!.doc).toMatch(/default 160/);
  });
  it('stdlib/cpc.bas: header entries and the comment above, nested subs and asm "sub" ignored', () => {
    const ink = lib.byName.get('setink')![0];
    expect(ink.doc).toMatch(/sets a pen to firmware colour/);
    expect(ink.details).toMatch(/pens above 15 and colours above 26 are ignored/);
    expect(lib.byName.get('soundqueue')![0].details).toMatch(/period = 62500/);
    expect(lib.byName.get('getmode')![0].params).toEqual([]);
  });
  it('hover content is produced for 10 sampled calls', () => {
    for (const n of ['PutSprite', 'FillRect', 'TileMap', 'KeyDown', 'SetPalette', 'SprListDraw', 'TextAt', 'BankSelect', 'SpriteMove', 'MusicInit', 'SetInk']) {
      const r = lib.byName.get(n.toLowerCase())![0];
      const h = describeRoutine(r);
      expect(h.signature, n).toContain(n);
      expect(h.doc.length, n).toBeGreaterThan(5);
      expect(h.source, n).toMatch(/\.bas:\d+$/);
    }
  });
});

d('parseParams / buildIndex edge cases', () => {
  it('byval, defaults, empty', () => {
    expect(parseParams('byval row as ubyte, col as ubyte = 3')).toEqual([
      { name: 'row', type: 'UBYTE' },
      { name: 'col', type: 'UBYTE', default: '3' },
    ]);
    expect(parseParams('')).toEqual([]);
    expect(parseParams(undefined)).toEqual([]);
  });
  it('is case-insensitive, skips asm "sub" lines, nested subs and strings', () => {
    const idx = buildIndex([
      {
        path: 'x.bas',
        platform: 'cpc',
        text: [
          "' x.bas",
          "'",
          "'   Foo(a, b)   does foo",
          "'                and more",
          '',
          'SUB FASTCALL Foo(a AS UBYTE, b AS INTEGER)',
          '    asm',
          '    sub c',
          '    sub (hl)',
          '    end asm',
          '    PRINT "sub Nope()"',
          '    sub Inner()',
          '    end sub',
          'END SUB',
          'Function bar as ubyte',
          'end function',
        ].join('\n'),
      },
    ]);
    expect(idx.routines.map((r) => r.name)).toEqual(['Foo', 'bar']);
    expect(idx.routines[0].doc).toBe('does foo and more');
    expect(idx.routines[1]).toMatchObject({ kind: 'FUNCTION', returns: 'UBYTE', params: [] });
  });
  it('mask blanks comments, strings and asm but keeps columns', () => {
    const m = mask(['a = 1 \' c', 'b$ = "x\'y" : REM tail', 'asm', 'ld a, 1', 'end asm', 'c = 2'].join('\n'));
    expect(m.code.slice(0, 2).map((c) => c.length)).toEqual(m.raw.slice(0, 2).map((c) => c.length));
    expect(m.code[0].trimEnd()).toBe('a = 1');
    expect(m.code[1].trimEnd()).toBe('b$ = "   " :');
    // REM after THEN / ELSE / a line number, and `""` inside a string; a name that starts with rem is code
    expect(mask('IF a THEN REM x').code[0].trimEnd()).toBe('IF a THEN');
    expect(mask('10 REM x').code[0].trimEnd()).toBe('10');
    expect(mask('a$ = "he said ""hi"" \' x"').code[0].replace(/"/g, '').trim()).toBe('a$ =');
    expect(mask('remain = 1').code[0]).toBe('remain = 1');
    expect(mask("a = &HFF : b = &X101 ' c").code[0].trimEnd()).toBe('a = &HFF : b = &X101');
    expect(mask("/' block\nstill '/ x = 1").code.map((l) => l.trim())).toEqual(['', 'x = 1']);
    expect(m.code[2].trim()).toBe('');
    expect(m.code[3].trim()).toBe('');
    expect(m.code[5]).toBe('c = 2');
  });
});

d('docs mapping', () => {
  const md = fs.readFileSync(path.join(REPO, 'docs/library.md'), 'utf8');
  const docs = indexDocs(md);
  it('slugs follow GitHub rules', () => {
    expect(slugify('7.3 Sprites (`cpcbuild/sprites.bas`)')).toBe('73-sprites-cpcbuildspritesbas');
  });
  it('maps routines to the heading of the table that lists them, by text', () => {
    expect(sectionFor(docs, 'PutSprite')!.text).toMatch(/^\d+\.\d+ Sprites \(`cpcbuild\/sprites\.bas`\)/);
    expect(sectionFor(docs, 'SetInk')!.text).toMatch(/Screen basics/);
    expect(sectionFor(docs, 'SpriteMove')!.text).toBeTruthy();
    expect(sectionFor(docs, 'MusicInit')!.text).toMatch(/Music/);
    expect(sectionFor(docs, 'NoSuchThing')).toBeUndefined();
    expect(sectionFor(docs, 'NoSuchThing', 'cpcbuild/display.bas')!.text).toMatch(/Display/);
  });
  it('every call in a library.md API table is in the index (documented calls cross-check)', () => {
    const known = new Set(lib.routines.map((r) => r.name.toLowerCase()));
    // table rows that are not SUB/FUNCTION: variables, macros, SoundQueue's argument table, and the tools table
    const notRoutines = new Set([
      'musicauto', 'frames', 'channels', 'period', 'duration', 'envelope', 'volume', 'build_assets', 'cpcrun', 'run', 'zxbc',
      'dma_load', 'dma_pause', 'dma_repeat', 'dma_nop', 'dma_loop', 'dma_int', 'dma_stop',
    ]);
    const missing = [...docs.byName.keys()].filter((k) => !known.has(k) && !notRoutines.has(k)).sort();
    // library.md still has rows for routines the library no longer has (the Spectrum sprite module, the Boriel
    // `Mode`, `WaitVsync`, `input`, `point`, `screen`, `SetFont`): the reference is rewritten separately. Any other
    // documented name must be in a header.
    const removed = new Set(['input', 'mode', 'point', 'screen', 'setfont', 'waitvsync', ...[...docs.byName.keys()].filter((k) => /^sprites?(add|image|begin|done|flip|init|reset|screen|sync)$/.test(k))]);
    expect(missing.filter((k) => !removed.has(k)), 'documented but not found in any header').toEqual([]);
  });
});

d('call parsing for signature help', () => {
  it('finds the call and the argument index', () => {
    expect(callAt('x = PutSprite(1, 2, ')).toEqual({ name: 'PutSprite', active: 2 });
    expect(callAt('PutSprite(Foo(1, 2), ')).toEqual({ name: 'PutSprite', active: 1 });
    expect(callAt('PutSprite(1)')).toBeUndefined();
    expect(callAt('a = 1')).toBeUndefined();
  });
  it('parameter ranges point into the signature', () => {
    const r = lib.byName.get('putsprite')![0];
    const rs = paramRanges(r.signature, r.params);
    expect(rs.map(([a, b]) => r.signature.slice(a, b))).toEqual(['x AS INTEGER', 'y AS INTEGER', 'w AS UBYTE', 'h AS UBYTE', 'spr AS UINTEGER']);
  });
});
