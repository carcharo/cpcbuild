import * as fs from 'node:fs';
import * as path from 'node:path';
import { compile } from '@cpcbuild/cpcbas';
import { diskTree } from '@cpcbuild/cpcbas/node';
import { describe, expect, it } from 'vitest';
import { parseMap } from './map';
import { basicName, buildSymbols, decodeScalar, findByName, groupSymbols, matchesFilter, planScalarReads, resolveTarget, symbolAt, describeAddress, valuesFromRange } from './symbols';

// real cpcbas -M output (the maps of the repo's own programs, compiled with the pinned cpcbas)
const fx = (n: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', n + '.map'), 'utf8');
const LIB = new Set(['mode', 'waitvsync', 'putsprite', 'screeninit', 'fillrect', 'scankeys', 'keydown', 'anykeydown', 'setpalette12', 'framehook', 'framehookoff', 'enabledoublebuffer', 'flipbuffer', 'cbreserve4000', 'plusavailable', 'setborder12']);
const isLibrary = (n: string): boolean => LIB.has(n.toLowerCase());
const load = (n: string, lib = true) => buildSymbols(parseMap(fx(n)), lib ? { isLibrary } : {});

describe('buildSymbols on the real maps', () => {
  it('keeps every map line (count equals the number of non-blank lines, like the awk reference)', () => {
    for (const n of ['plusdemo', 'bounce', 'mode1text', 'starfall']) {
      const lines = fx(n).split('\n').filter((l) => l.trim()).length;
      expect(load(n).symbols.length).toBe(lines);
    }
  });

  it('sorts by address and gives each label the distance to the next higher one', () => {
    const t = load('plusdemo');
    for (let i = 1; i < t.symbols.length; i++) expect(t.symbols[i].addr).toBeGreaterThanOrEqual(t.symbols[i - 1].addr);
    const byLabel = (l: string) => t.symbols.find((s) => s.label === l)!;
    expect(byLabel('._barIdx').size).toBe(1); // 09AB -> 09AC
    expect(byLabel('._frame_').size).toBe(2); // 0EA8 -> 0EAA
    expect(t.symbols[t.symbols.length - 1].size).toBeUndefined();
  });

  it('plusdemo: data area 0059-0EB4, variables are data, MoveSprites a BASIC routine, PutSprite a library one', () => {
    const t = load('plusdemo');
    expect([t.dataStart, t.dataEnd]).toEqual([0x59, 0xeb4]);
    const k = (l: string) => t.symbols.find((s) => s.label === l)!;
    expect(k('._barIdx')).toMatchObject({ kind: 'data', addr: 0x9ab, scalar: 1, internal: false, name: 'barIdx' });
    expect(k('._frame_')).toMatchObject({ kind: 'data', scalar: 2, name: 'frame_' });
    expect(k('._dsprite__a')).toMatchObject({ kind: 'data', name: 'dsprite' }); // an array is shown by its BASIC name
    expect(k('._dsprite__a').scalar).toBeUndefined(); // its pointer cell is not a value to show
    expect(k('._dsprite__a.__DATA__')).toMatchObject({ kind: 'data', name: 'dsprite.__DATA__' });
    expect(k('._dsprite__a.__DATA__').scalar).toBeUndefined(); // an array body is not a scalar
    for (const tail of ['__DIMS__', '__UBOUND__']) {
      expect(k(`._dsprite__a.${tail}`)).toMatchObject({ kind: 'runtime', internal: true });
      expect(k(`._dsprite__a.${tail}`).scalar).toBeUndefined();
    }
    expect(k('._MoveSprites')).toMatchObject({ kind: 'basic', addr: 0x1928 });
    expect(k('._PutSprite').kind).toBe('library');
    expect(k('._MoveSprites__leave')).toMatchObject({ kind: 'runtime', internal: true });
    expect(k('._MoveSprites__exit')).toMatchObject({ kind: 'runtime', internal: true });
    expect(k('.pd_ms')).toMatchObject({ kind: 'runtime', internal: true }); // the program's own inline-asm label
    expect(k('.T.2')).toMatchObject({ kind: 'runtime', internal: true }); // a compiler label
    expect(k('.core.__START_PROGRAM')).toMatchObject({ kind: 'runtime', internal: false, name: '__START_PROGRAM', addr: 0x40 });
  });

  it('library assembly names (.__MUSIC_RUN) count as library routines even without the header index', () => {
    const t = load('starfall', false);
    expect(t.symbols.find((s) => s.label === '.__MUSIC_RUN')!.kind).toBe('library');
    expect(t.symbols.find((s) => s.label === '._KeyDown')!.kind).toBe('basic'); // no index: cannot tell
  });

  it('groups: BASIC, library, data; runtime only when asked; internal labels never in the first three', () => {
    const t = load('plusdemo');
    expect(groupSymbols(t).map((g) => g.title)).toEqual(['BASIC routines', 'Library routines', 'Data']);
    const all = groupSymbols(t, { runtime: true });
    expect(all.map((g) => g.kind)).toEqual(['basic', 'library', 'data', 'runtime']);
    const basic = all[0].items.map((s) => s.name);
    expect(basic).toContain('MoveSprites');
    expect(basic).not.toContain('PutSprite');
    expect(basic.some((n) => n.endsWith('__leave') || n.endsWith('__exit'))).toBe(false);
    expect(all[3].items.some((s) => s.internal)).toBe(true);
    // every symbol lands in exactly one group when runtime is shown (internal ones in 'runtime')
    expect(all.reduce((n, g) => n + g.items.length, 0)).toBe(t.symbols.length);
  });

  it('filters by name, label or address', () => {
    const t = load('plusdemo');
    expect(groupSymbols(t, { filter: 'movespr' })[0].items.map((s) => s.name)).toEqual(['MoveSprites']);
    expect(groupSymbols(t, { filter: '&1928' }).flatMap((g) => g.items.map((s) => s.name))).toContain('MoveSprites');
    expect(groupSymbols(t, { filter: 'zzzz' })).toEqual([]);
    expect(matchesFilter(t.symbols[0], '')).toBe(true);
    expect(groupSymbols(t, { filter: 'START_PROGRAM', runtime: true })[0].items[0].name).toBe('__START_PROGRAM');
    expect(groupSymbols(t, { filter: 'START_PROGRAM' })).toEqual([]);
  });

  it('starfall: has the globals the game keeps (gScore is a word)', () => {
    const t = load('starfall');
    const s = findByName(t, 'gScore')!;
    expect(s).toMatchObject({ kind: 'data', scalar: 2 });
  });
});

describe('addresses and names', () => {
  const t = load('plusdemo');
  it('symbolAt: nearest named label below, skipping internal ones, none outside the program', () => {
    expect(symbolAt(t, 0x1928)).toMatchObject({ offset: 0 });
    expect(symbolAt(t, 0x1928)!.symbol.name).toBe('MoveSprites');
    const mid = symbolAt(t, 0x1940)!; // inside MoveSprites, past the .pd_ms asm label
    expect(mid.symbol.name).toBe('MoveSprites');
    expect(mid.offset).toBe(0x1940 - 0x1928);
    expect(symbolAt(t, 0x10)).toBeUndefined();
    expect(symbolAt(t, 0xc000)).toBeUndefined();
  });
  it('describeAddress', () => {
    expect(describeAddress(t, 0x1928)).toBe('MoveSprites');
    expect(describeAddress(t, 0x192b)).toBe('MoveSprites+3');
    expect(describeAddress(t, 0xc000)).toBe('&C000');
    expect(describeAddress(undefined, 0x4f2a)).toBe('&4F2A');
  });
  it('resolveTarget: numbers, names, name+offset, errors that say what to do', () => {
    expect(resolveTarget(t, '&1928')).toEqual({ addr: 0x1928 });
    expect(resolveTarget(t, '0x1928')).toEqual({ addr: 0x1928 });
    expect(resolveTarget(t, '$1928')).toEqual({ addr: 0x1928 });
    expect(resolveTarget(t, '6440')).toEqual({ addr: 6440 });
    const r = resolveTarget(t, 'movesprites') as { addr: number; symbol: { name: string } };
    expect([r.addr, r.symbol.name]).toEqual([0x1928, 'MoveSprites']);
    expect((resolveTarget(t, 'MoveSprites+3') as { addr: number }).addr).toBe(0x192b);
    expect((resolveTarget(t, '_MoveSprites') as { addr: number }).addr).toBe(0x1928);
    expect((resolveTarget(t, '.core.__START_PROGRAM') as { addr: number }).addr).toBe(0x40);
    expect((resolveTarget(t, 'nothing') as { error: string }).error).toMatch(/no symbol "nothing".*build/);
    expect((resolveTarget(undefined, 'x') as { error: string }).error).toMatch(/no map loaded/);
    expect((resolveTarget(t, '&12345') as { error: string }).error).toMatch(/not an address/);
    expect((resolveTarget(t, '') as { error: string }).error).toMatch(/type an address/);
  });
});

describe('values of data labels', () => {
  it('decodes a byte and a little-endian word', () => {
    expect(decodeScalar([0x03], 1)).toEqual({ value: 3, text: '3 (&03)' });
    expect(decodeScalar([0xd8, 0x04], 2)).toEqual({ value: 1240, text: '1240 (&04D8)' });
    expect(decodeScalar([0xff, 0xff], 2).value).toBe(65535);
  });
  it('plans few reads that cover every scalar, and splits the bytes back', () => {
    const t = load('plusdemo');
    const plan = planScalarReads(t);
    const scalars = t.symbols.filter((s) => s.scalar);
    expect(plan.reduce((n, r) => n + r.items.length, 0)).toBe(scalars.length);
    expect(plan.length).toBeLessThan(scalars.length / 3);
    for (const r of plan) {
      expect(r.length).toBeLessThanOrEqual(2048);
      for (const s of r.items) expect(s.addr >= r.start && s.addr + (s.scalar as number) <= r.start + r.length).toBe(true);
    }
    // a fake memory: byte at address a holds a & 0xff
    const r0 = plan[0];
    const mem = Uint8Array.from({ length: r0.length }, (_, i) => (r0.start + i) & 0xff);
    const vals = valuesFromRange(r0, mem);
    const first = r0.items[0];
    expect(vals.get(first.label)!.value).toBe(first.scalar === 1 ? first.addr & 0xff : (first.addr & 0xff) | (((first.addr + 1) & 0xff) << 8)); // little-endian
    expect(valuesFromRange(r0, mem.subarray(0, 2)).size).toBeLessThan(vals.size); // short data leaves symbols out
  });
});

describe('names as cpcbas writes them (a program with every kind of name, compiled here)', () => {
  const SRC = [
    'DIM a AS UBYTE', 'DIM score AS INTEGER', 'DIM n%', 'DIM r!', 'DIM s$',
    'DIM arr(3) AS UBYTE', 'DIM names$(2)',
    'DEF FN twice(x) = x * 2',
    'SUB Bump()', 'IF a > 3 THEN EXIT SUB', 'a = a + 1', 'END SUB',
    'FUNCTION Half(v AS UBYTE) AS UBYTE', 'RETURN v / 2', 'END FUNCTION',
    '10 Bump(): a = Half(a)', 'again: GOSUB sub1', 'n% = FN twice(2)', 'r! = 1.5: s$ = "x": arr(1) = 2: names$(1) = "y": score = n%',
    'GOTO again', 'sub1: RETURN', 'ASM', 'myAsm: nop', 'END ASM', '',
  ].join('\n');
  const r = compile({ files: new Map([['main.bas', SRC]]), main: 'main.bas', runtime: diskTree(path.join(__dirname, '..', '..', 'vendor', 'cpcbas', 'lib')), options: { map: true, format: 'bin' } });
  const t = buildSymbols(parseMap(r.map ?? ''));
  const sym = (label: string) => t.symbols.find((x) => x.label === label);
  it('compiles', () => {
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.message)).toEqual([]);
    expect(r.map).toBeTruthy();
  });
  it('suffixed variables are shown as written; findByName takes either spelling', () => {
    expect(sym('._n__i')).toMatchObject({ name: 'n%', kind: 'data', scalar: 2 });
    expect(sym('._r__r')).toMatchObject({ name: 'r!', kind: 'data' });
    expect(sym('._s__s')).toMatchObject({ name: 's$', kind: 'data', scalar: 2 });
    expect(findByName(t, 'n%')).toBe(sym('._n__i'));
    expect(findByName(t, '_n__i')).toBe(sym('._n__i'));
    expect(findByName(t, 'S$')).toBe(sym('._s__s'));
    expect(sym('._a')).toMatchObject({ name: 'a', scalar: 1 });
  });
  it('arrays: the name without the suffix; the plumbing is internal and never a scalar', () => {
    expect(sym('._arr__a')).toMatchObject({ name: 'arr', kind: 'data' });
    expect(sym('._arr__a')!.scalar).toBeUndefined();
    expect(sym('._names__s__a')).toMatchObject({ name: 'names$', kind: 'data' });
    expect(findByName(t, 'arr')).toBe(sym('._arr__a'));
    expect(findByName(t, 'names$')).toBe(sym('._names__s__a'));
    for (const l of ['._arr__a.__DIMS__', '._arr__a.__UBOUND__']) {
      expect(sym(l)).toMatchObject({ kind: 'runtime', internal: true });
      expect(sym(l)!.scalar).toBeUndefined();
    }
    expect(t.symbols.filter((x) => x.scalar && /__(DIMS|UBOUND|BACK)__/.test(x.label))).toEqual([]);
  });
  it('DEF FN is shown as FN name; SUB and FUNCTION end labels (__leave, __exit) are internal', () => {
    expect(sym('._FN__twice')).toMatchObject({ name: 'FN twice', kind: 'basic' });
    expect(findByName(t, 'fn twice')).toBe(sym('._FN__twice'));
    expect(sym('._Bump')).toMatchObject({ kind: 'basic', internal: false });
    expect(sym('._Half')).toMatchObject({ kind: 'basic', internal: false });
    for (const l of ['._Bump__exit', '._Bump__leave', '._FN__twice__leave']) expect(sym(l)).toMatchObject({ internal: true });
    expect(groupSymbols(t)[0].items.map((x) => x.name).sort()).toEqual(['Bump', 'FN twice', 'Half']);
  });
  it('numbered lines, labels, GOSUB targets and ASM labels are internal', () => {
    for (const x of t.symbols.filter((y) => /^\.(T|S|V|L)\./.test(y.label) || y.label === '.myAsm')) expect(x).toMatchObject({ kind: 'runtime', internal: true });
    expect(sym('.myAsm')).toBeDefined();
  });
  it('basicName', () => {
    expect([basicName('n__i'), basicName('r__r'), basicName('s__s'), basicName('v'), basicName('names__s__a'), basicName('FN__f__i'), basicName('x__a.__DATA__'), basicName('_MUSIC_RUN')]).toEqual(['n%', 'r!', 's$', 'v', 'names$', 'FN f%', 'x.__DATA__', '_MUSIC_RUN']);
  });
});
