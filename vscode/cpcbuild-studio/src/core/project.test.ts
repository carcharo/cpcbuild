import { describe, expect, it } from 'vitest';
import { deriveDiscStem, parseAddress, parseProject, zxbcArgs } from './project';

const base = (t: object, extra: object = {}): string =>
  JSON.stringify({ version: 1, name: 'mygame', targets: [{ id: 'cpc6128', main: 'src/main.bas', ...t }], ...extra });

describe('parseProject', () => {
  it('accepts the spec example', () => {
    const r = parseProject(
      JSON.stringify({
        version: 1,
        name: 'mygame',
        library: null,
        targets: [
          { id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', model: '6128', defines: ['CPC6128'], bare: false, ownFont: false, org: null, package: 'dsk', disc: 'MYGAME' },
          { id: 'plus-cart', arch: 'cpc', main: 'src/main.bas', model: 'plus', defines: ['PLUS'], bare: true, ownFont: true, package: 'cpr' },
          { id: 'zx128', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX128'], package: 'tap' },
        ],
        assets: ['assets/**/*.cpcimp'],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.project!.targets.map((t) => t.package)).toEqual(['dsk', 'cpr', 'tap']);
    expect(r.project!.targets[0].disc).toBe('MYGAME');
  });
  it('defaults: arch cpc, dsk, model 6128, derived disc with a note', () => {
    const r = parseProject(base({ id: 'my_game' }));
    expect(r.errors).toEqual([]);
    const t = r.project!.targets[0];
    expect([t.arch, t.package, t.model, t.disc]).toEqual(['cpc', 'dsk', '6128', 'MYGAME']);
    expect(r.notes[0].message).toContain('MYGAME');
  });
  it.each([
    ['d_s'], ['toolongname'], ['lower'], [''],
  ])('rejects the disc name %j', (disc) => {
    const r = parseProject(base({ disc }));
    expect(r.errors.map((e) => e.path)).toContain('targets[0].disc');
  });
  it('cpr needs bare and ownFont', () => {
    for (const t of [{ package: 'cpr' }, { package: 'cpr', bare: true }, { package: 'cpr', ownFont: true }]) {
      const r = parseProject(base(t));
      expect(r.errors[0].message).toMatch(/bare.*ownFont/);
    }
    expect(parseProject(base({ package: 'cpr', bare: true, ownFont: true })).errors).toEqual([]);
  });
  it('org below &0040 is refused before the compiler runs', () => {
    expect(parseProject(base({ org: '0x20' })).errors[0].message).toMatch(/below &0040/);
    expect(parseProject(base({ org: 16 })).errors[0].path).toBe('targets[0].org');
    expect(parseProject(base({ org: '0x8000' })).errors).toEqual([]);
    expect(parseProject(base({ org: 'banana' })).errors[0].message).toMatch(/address/);
  });
  it('spectrum targets: tap default, no bare', () => {
    const r = parseProject(base({ arch: 'zx48k' }));
    expect(r.project!.targets[0].package).toBe('tap');
    expect(parseProject(base({ arch: 'zx48k', bare: true })).errors[0].message).toMatch(/only apply to arch "cpc"/);
    expect(parseProject(base({ arch: 'zx48k', package: 'dsk' })).errors[0].path).toBe('targets[0].package');
  });
  it('reports bad structure with a fix', () => {
    expect(parseProject('{').errors[0].message).toMatch(/not valid JSON/);
    expect(parseProject('[]').errors[0].message).toMatch(/object/);
    expect(parseProject('{"version":2,"name":"x","targets":[]}').errors.map((e) => e.path)).toEqual(['version', 'targets']);
    expect(parseProject(base({ id: 'bad id' })).errors[0].path).toBe('targets[0].id');
    const dup = JSON.stringify({ version: 1, name: 'x', targets: [{ id: 'a', main: 'm.bas' }, { id: 'a', main: 'm.bas' }] });
    expect(parseProject(dup).errors[0].message).toMatch(/used twice/);
    expect(parseProject(base({ defines: ['A B'] })).errors[0].path).toBe('targets[0].defines');
    expect(parseProject(base({ model: '128' })).errors[0].path).toBe('targets[0].model');
  });
});

describe('helpers', () => {
  it('parseAddress', () => {
    expect(parseAddress('0x40')).toBe(0x40);
    expect(parseAddress('&4000')).toBe(0x4000);
    expect(parseAddress('$8000')).toBe(0x8000);
    expect(parseAddress('32768')).toBe(32768);
    expect(parseAddress('0x10000')).toBeUndefined();
    expect(parseAddress('')).toBeUndefined();
  });
  it('deriveDiscStem', () => {
    expect(deriveDiscStem('My Game 2!')).toBe('MYGAME2');
    expect(deriveDiscStem('starfall_long_name')).toBe('STARFALL');
    expect(deriveDiscStem('名前')).toBe('PROG');
  });
});

describe('zxbcArgs (golden)', () => {
  const o = { libraryDir: '/repo', main: '/p/src/main.bas', out: '/p/build/t.bin', map: '/p/build/t.map' };
  const tgt = (t: object) => parseProject(base(t)).project!.targets[0];
  it('firmware', () => {
    expect(zxbcArgs(tgt({ defines: ['CPC6128'], org: '0x40' }), o)).toEqual([
      '--arch', 'cpc', '--org', '0x40', '-I', '/repo/lib', '-D', 'CPC6128', '-M', '/p/build/t.map', '-o', '/p/build/t.bin', '/p/src/main.bas',
    ]);
  });
  it('bare + ownFont, define with a value, extra args, default org', () => {
    expect(zxbcArgs(tgt({ defines: ['PLUS', 'FRAMES=100'], bare: true, ownFont: true }), { ...o, extra: ['-O2'], defaultOrg: 0x40 })).toEqual([
      '--arch', 'cpc', '--org', '0x40', '-I', '/repo/lib', '-D', 'PLUS', '-D', 'FRAMES=100', '-D', 'CPC_BAREMETAL', '-D', 'CPC_OWNFONT',
      '-M', '/p/build/t.map', '-O2', '-o', '/p/build/t.bin', '/p/src/main.bas',
    ]);
  });
  it('target org beats the default; no org when neither', () => {
    expect(zxbcArgs(tgt({ org: 0x8000 }), { ...o, defaultOrg: 0x40 }).slice(0, 4)).toEqual(['--arch', 'cpc', '--org', '0x8000']);
    expect(zxbcArgs(tgt({}), o).includes('--org')).toBe(false);
  });
  it('spectrum tape as build_zx.sh', () => {
    expect(zxbcArgs(tgt({ arch: 'zx48k', defines: ['ZX128'], org: 31744, heap: 256 }), { ...o, out: '/p/build/t.tap', map: undefined })).toEqual([
      '--arch', 'zx48k', '-f', 'tap', '-B', '-a', '--org', '31744', '-H', '256', '-I', '/repo/lib', '-D', 'ZX128', '-o', '/p/build/t.tap', '/p/src/main.bas',
    ]);
  });
});
