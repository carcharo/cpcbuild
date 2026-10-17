import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseMap } from './map';
import { buildSymbols, decodeScalar, findByName, groupSymbols, matchesFilter, planScalarReads, resolveTarget, symbolAt, describeAddress, valuesFromRange } from './symbols';

// real zxbc -M output (the maps of the repo's own programs)
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
    expect(byLabel('._barIdx').size).toBe(1); // 0059 -> 005A
    expect(byLabel('._frame').size).toBe(2); // 0063 -> 0065
    expect(t.symbols[t.symbols.length - 1].size).toBeUndefined();
  });

  it('plusdemo: data area 0059-0E9C, variables are data, MoveSprites a BASIC routine, PutSprite a library one', () => {
    const t = load('plusdemo');
    expect([t.dataStart, t.dataEnd]).toEqual([0x59, 0xe9c]);
    const k = (l: string) => t.symbols.find((s) => s.label === l)!;
    expect(k('._barIdx')).toMatchObject({ kind: 'data', addr: 0x59, scalar: 1, internal: false, name: 'barIdx' });
    expect(k('._frame')).toMatchObject({ kind: 'data', scalar: 2 });
    expect(k('._dsprite.__DATA__').scalar).toBeUndefined(); // an array body is not a scalar
    expect(k('._MoveSprites')).toMatchObject({ kind: 'basic', addr: 0x17bd });
    expect(k('._PutSprite').kind).toBe('library');
    expect(k('._MoveSprites__leave')).toMatchObject({ kind: 'runtime', internal: true });
    expect(k('.pd_ms')).toMatchObject({ kind: 'runtime', internal: true }); // the program's own inline-asm label
    expect(k('.LABEL.__LABEL90')).toMatchObject({ kind: 'runtime', internal: true });
    expect(k('.core.__START_PROGRAM')).toMatchObject({ kind: 'runtime', internal: false, name: '__START_PROGRAM', addr: 0x40 });
  });

  it('library assembly names (.__MUSIC_RUN) count as library routines even without the header index', () => {
    const t = load('bounce', false);
    expect(t.symbols.find((s) => s.label === '.__MUSIC_RUN')!.kind).toBe('library');
    expect(t.symbols.find((s) => s.label === '._Mode')!.kind).toBe('basic'); // no index: cannot tell
  });

  it('groups: BASIC, library, data; runtime only when asked; internal labels never in the first three', () => {
    const t = load('plusdemo');
    expect(groupSymbols(t).map((g) => g.title)).toEqual(['BASIC routines', 'Library routines', 'Data']);
    const all = groupSymbols(t, { runtime: true });
    expect(all.map((g) => g.kind)).toEqual(['basic', 'library', 'data', 'runtime']);
    const basic = all[0].items.map((s) => s.name);
    expect(basic).toContain('MoveSprites');
    expect(basic).not.toContain('PutSprite');
    expect(basic.some((n) => n.endsWith('__leave'))).toBe(false);
    expect(all[3].items.some((s) => s.internal)).toBe(true);
    // every symbol lands in exactly one group when runtime is shown (internal ones in 'runtime')
    expect(all.reduce((n, g) => n + g.items.length, 0)).toBe(t.symbols.length);
  });

  it('filters by name, label or address', () => {
    const t = load('plusdemo');
    expect(groupSymbols(t, { filter: 'movespr' })[0].items.map((s) => s.name)).toEqual(['MoveSprites']);
    expect(groupSymbols(t, { filter: '&17BD' }).flatMap((g) => g.items.map((s) => s.name))).toContain('MoveSprites');
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
    expect(symbolAt(t, 0x17bd)).toMatchObject({ offset: 0 });
    expect(symbolAt(t, 0x17bd)!.symbol.name).toBe('MoveSprites');
    const mid = symbolAt(t, 0x17ca)!; // inside MoveSprites, past the .pd_ms asm label
    expect(mid.symbol.name).toBe('MoveSprites');
    expect(mid.offset).toBe(0x17ca - 0x17bd);
    expect(symbolAt(t, 0x10)).toBeUndefined();
    expect(symbolAt(t, 0xc000)).toBeUndefined();
  });
  it('describeAddress', () => {
    expect(describeAddress(t, 0x17bd)).toBe('MoveSprites');
    expect(describeAddress(t, 0x17c0)).toBe('MoveSprites+3');
    expect(describeAddress(t, 0xc000)).toBe('&C000');
    expect(describeAddress(undefined, 0x4f2a)).toBe('&4F2A');
  });
  it('resolveTarget: numbers, names, name+offset, errors that say what to do', () => {
    expect(resolveTarget(t, '&17BD')).toEqual({ addr: 0x17bd });
    expect(resolveTarget(t, '0x17bd')).toEqual({ addr: 0x17bd });
    expect(resolveTarget(t, '$17bd')).toEqual({ addr: 0x17bd });
    expect(resolveTarget(t, '6077')).toEqual({ addr: 6077 });
    const r = resolveTarget(t, 'movesprites') as { addr: number; symbol: { name: string } };
    expect([r.addr, r.symbol.name]).toEqual([0x17bd, 'MoveSprites']);
    expect((resolveTarget(t, 'MoveSprites+3') as { addr: number }).addr).toBe(0x17c0);
    expect((resolveTarget(t, '_MoveSprites') as { addr: number }).addr).toBe(0x17bd);
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
    expect(vals.get('._barIdx')).toEqual({ value: 0x59, text: '89 (&59)' });
    expect(vals.get('._dmaP')!.value).toBe(0x5d | (0x5e << 8)); // little-endian
    expect(valuesFromRange(r0, mem.subarray(0, 2)).size).toBeLessThan(vals.size); // short data leaves symbols out
  });
});
