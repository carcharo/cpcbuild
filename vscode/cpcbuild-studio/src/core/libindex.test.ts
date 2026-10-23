import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findZxbasic, warnNoZxbasic } from './testutil';
import { mask } from './bastok';
import { callAt, describeRoutine, paramRanges } from './libhover';
import { indexDocs, sectionFor, slugify } from './libdocs';
import { libraryFiles, loadIndex, stdlibDirOf, stdlibFiles } from './libfs';
import { buildIndex, LibIndex, parseParams } from './libindex';

const REPO = path.resolve(__dirname, '../../../..');
const ZXBASIC = findZxbasic(REPO);
warnNoZxbasic(ZXBASIC);
const d = ZXBASIC ? describe : describe.skip;
const stdlib = (ZXBASIC ? stdlibDirOf(ZXBASIC) : undefined);
const lib = loadIndex(REPO);
const both: LibIndex = loadIndex(REPO, stdlib);

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
    'zxbuild/sprites.bas': 14,
    'music/music_cpc.bas': 8,
    'music/music_zx.bas': 6,
  };
  for (const [f, n] of Object.entries(expected)) {
    it(`${f}: ${n} routines, same names as a column-0 regex`, () => {
      const got = (lib.perFile.get(f) ?? []).map((r) => r.name.toLowerCase()).sort();
      expect(got.length).toBe(n);
      expect(got).toEqual(oracle(path.join(REPO, 'lib', f)));
    });
  }
  it('indexes every library file that declares routines, and no others', () => {
    const files = libraryFiles(REPO).map((f) => f.path).filter((p) => oracle(path.join(REPO, 'lib', p)).length > 0);
    expect([...lib.perFile.keys()].sort()).toEqual(files.sort());
    expect(lib.routines.length).toBe(Object.values(expected).reduce((a, b) => a + b, 0));
  });
  it.skipIf(!stdlib)('the compiler cpc stdlib: 26 routines in 8 files', () => {
    const std = both.routines.filter((r) => !r.file.includes('/'));
    expect(std.length).toBe(26);
    expect(new Set(std.map((r) => r.file))).toEqual(new Set(['cpc.bas', 'font.bas', 'framehook.bas', 'input.bas', 'keys.bas', 'play.bas', 'point.bas', 'screen.bas']));
    for (const f of stdlibFiles(stdlib!)) {
      const got = (both.perFile.get(f.path) ?? []).map((r) => r.name.toLowerCase());
      for (const n of oracle(path.join(stdlib!, f.path))) expect(got, `${f.path}: ${n}`).toContain(n);
    }
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
      line: 33,
      platform: 'cpc',
      requires: ['cpcbuild/sprput.asm'],
      signature: 'SUB PutSprite(x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE, spr AS UINTEGER)',
    });
    expect(r.doc).toBe('copy w*h bytes (row by row, top row first) to the screen');
    expect(r.params.map((p) => p.name)).toEqual(['x', 'y', 'w', 'h', 'spr']);
  });
  it('a function with a return type and FASTCALL', () => {
    const r = lib.byName.get('keydown')![0];
    expect(r).toMatchObject({ kind: 'FUNCTION', returns: 'UBYTE', fastcall: true, signature: 'FUNCTION KeyDown(key AS UBYTE) AS UBYTE' });
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
    const fw = both.routines.filter((r) => r.restriction === 'firmware').map((r) => r.name).sort();
    expect(fw).toEqual(['BankLoad', 'SoundBusy', 'SoundEnvelope', 'SoundFree', 'SoundQueue']);
    const bare = both.routines.filter((r) => r.restriction === 'bare').map((r) => r.name).sort();
    expect(bare).toEqual(['RasterIntAt', 'RasterIntClear', 'RasterIntMove', 'RasterIntOff']);
  });
  it('Spectrum routines are platform zx; MusicInit exists for both with documentation from music.bas / music_cpc.bas', () => {
    expect(lib.byName.get('spritesinit')![0].platform).toBe('zx');
    const mi = lib.byName.get('musicinit')!;
    expect(mi.map((r) => r.platform).sort()).toEqual(['cpc', 'zx']);
    for (const r of mi) expect(r.doc.length).toBeGreaterThan(20);
  });
  it('multi-name header lines document each name', () => {
    expect(lib.byName.get('pluspagein')![0].doc).toMatch(/ASIC's registers at &4000-&7FFF/);
    expect(lib.byName.get('pluspageout')![0].doc).toMatch(/ASIC's registers at &4000-&7FFF/);
  });
  it('settings named in the headers', () => {
    expect(lib.settings.map((s) => s.name).sort()).toEqual(['SPRLIST_MAX', 'TEXT_QUEUE']);
    expect(lib.settings.find((s) => s.name === 'TEXT_QUEUE')!.doc).toMatch(/default 160/);
  });
  it.skipIf(!stdlib)('compiler stdlib: header entries and the comment above, nested subs and asm "sub" ignored', () => {
    const ink = both.byName.get('setink')![0];
    expect(ink.doc).toMatch(/sets a pen to firmware colour/);
    expect(ink.details).toMatch(/pens above 15 and colours above 26 are ignored/);
    const mode = both.byName.get('mode')![0];
    expect(mode).toMatchObject({ kind: 'SUB', fastcall: true });
    expect(mode.doc).toMatch(/screen mode 0/);
    expect(both.byName.get('sound' + 'queue')![0].details).toMatch(/period = 62500/);
    expect(both.byName.has('readchar')).toBe(false); // nested in Play
    expect(both.byName.get('play')![0].params.map((p) => p.name)).toEqual(['channel0', 'channel1', 'channel2']);
    expect(both.byName.get('getmode')![0].params).toEqual([]);
  });
  it('hover content is produced for 10 sampled calls', () => {
    for (const n of ['PutSprite', 'FillRect', 'TileMap', 'KeyDown', 'SetPalette', 'SprListDraw', 'TextAt', 'BankSelect', 'SpriteMove', 'MusicInit']) {
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
    const known = new Set(both.routines.map((r) => r.name.toLowerCase()));
    // table rows that are not SUB/FUNCTION: variables, macros, SoundQueue's argument table, and the tools table
    const notRoutines = new Set([
      'musicauto', 'frames', 'channels', 'period', 'duration', 'envelope', 'volume', 'build_assets', 'cpcrun', 'run', 'zxbc',
      'dma_load', 'dma_pause', 'dma_repeat', 'dma_nop', 'dma_loop', 'dma_int', 'dma_stop',
    ]);
    const missing = [...docs.byName.keys()].filter((k) => !known.has(k) && !notRoutines.has(k)).sort();
    // without the compiler checkout the stdlib routines (Mode, SetInk, ...) are unknown, so only check with it
    if (stdlib) expect(missing, 'documented but not found in any header').toEqual([]);
    else expect(missing.length).toBeGreaterThan(0);
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
