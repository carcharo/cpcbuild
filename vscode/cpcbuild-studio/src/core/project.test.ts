import { describe, expect, it } from 'vitest';
import { compileInput, deriveDiscStem, parseAddress, parseCompilerArgs, parseProject } from './project';

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
          { id: 'fast', main: 'src/main.bas', defines: ['CPC464'], model: '464', optimize: 's', heap: 2048, package: 'bin' },
        ],
        assets: ['assets/**/*.cpcimp'],
      }),
    );
    expect(r.errors).toEqual([]);
    expect(r.project!.targets.map((t) => t.package)).toEqual(['dsk', 'cpr', 'bin']);
    expect(r.project!.targets[0].disc).toBe('MYGAME');
    expect(r.project!.targets[2]).toMatchObject({ optimize: 's', heap: 2048 });
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
  it('spectrum targets and tapes are refused with the way out', () => {
    const r = parseProject(base({ arch: 'zx48k' }));
    expect(r.project).toBeUndefined();
    expect(r.errors[0].path).toBe('targets[0].arch');
    expect(r.errors[0].message).toMatch(/removed in CPCBuild 0\.2\.0.*CPCBuild 0\.1\.x.*Convert Project to CPC BASIC/);
    expect(parseProject(base({ package: 'tap' })).errors[0].message).toMatch(/Spectrum targets were removed/);
    expect(parseProject(base({ arch: 'mips' })).errors[0].message).toMatch(/must be "cpc"/);
  });
  it('optimize takes 0-3 or s', () => {
    for (const o of [0, 1, 2, 3, 's', '2']) expect(parseProject(base({ optimize: o })).errors).toEqual([]);
    expect(parseProject(base({ optimize: 4 })).errors[0].path).toBe('targets[0].optimize');
    expect(parseProject(base({ optimize: 'fast' })).errors[0].path).toBe('targets[0].optimize');
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

describe('compileInput (golden)', () => {
  const tgt = (t: object) => parseProject(base(t)).project!.targets[0];
  const proj = parseProject(base({})).project!;
  it('a firmware disc', () => {
    expect(compileInput(tgt({ defines: ['CPC6128'], org: '0x40' }), proj)).toEqual({
      main: 'src/main.bas',
      includePaths: [],
      defines: { CPC6128: '' },
      options: { format: 'dsk', dskName: 'CPC6128.BIN', org: 0x40, map: true },
      warnings: [],
    });
  });
  it('bare + ownFont, a define with a value, compiler args, the default org', () => {
    const i = compileInput(tgt({ defines: ['PLUS', 'FRAMES=100'], bare: true, ownFont: true, package: 'cpr' }), proj, {
      buildOrg: 0x40,
      compilerArgs: ['-O3', '-D', 'EXTRA=2', '-DFRAMES=200', '-I', 'inc', '--heap', '&1000', '-Werror', '-W', '301,W302', '-Wimplicit', '--opt-disable=peephole,strip'],
    });
    expect(i).toEqual({
      main: 'src/main.bas',
      includePaths: ['inc'],
      defines: { PLUS: '', FRAMES: '200', CPC_BAREMETAL: '', CPC_OWNFONT: '', EXTRA: '2' },
      options: { format: 'cpr', org: 0x40, heapSize: 0x1000, optimize: 3, optDisable: ['peephole', 'strip'], map: true, disabledWarnings: [301, 'W302'], warningsAsErrors: true, warnImplicit: true },
      warnings: [],
    });
  });
  it('the target beats the compiler args beats the setting: org, heap, optimize', () => {
    const i = compileInput(tgt({ org: 0x8000, heap: 100, optimize: 0 }), proj, { buildOrg: 0x40, compilerArgs: ['--org', '0x4000', '--heap', '5', '-O1'] });
    expect([i.options.org, i.options.heapSize, i.options.optimize]).toEqual([0x8000, 100, 0]);
    const j = compileInput(tgt({}), proj, { buildOrg: 0x40, compilerArgs: ['--org', '0x4000'] });
    expect(j.options.org).toBe(0x4000);
    expect(compileInput(tgt({}), proj).options.org).toBeUndefined();
  });
  it('a bin target has no disc name; Windows paths become POSIX', () => {
    const i = compileInput(tgt({ main: 'src\\main.bas', package: 'bin' }), proj, { compilerArgs: ['-I', 'a\\b'] });
    expect(i.main).toBe('src/main.bas');
    expect(i.includePaths).toEqual(['a/b']);
    expect(i.options.dskName).toBeUndefined();
  });
});

describe('parseCompilerArgs', () => {
  it('honours the CLI spellings', () => {
    const a = parseCompilerArgs(['-O', 's', '--heap=4096', '--heap-address', '$9000', '--org', '&4000', '-Isrc', '-DA', '-D', 'B=1']);
    expect(a).toMatchObject({ optimize: 's', heap: 4096, heapAddress: 0x9000, org: 0x4000, includes: ['src'], defines: { A: '', B: '1' }, warnings: [] });
  });
  it('names every flag it does not honour', () => {
    const a = parseCompilerArgs(['-f', 'cpr', '-o', 'x', '--stage=asm', 'main.bas', '-O9', '--org', 'zzz', '-W', 'E300']);
    expect(a.warnings.map((w) => w.replace(/^"cpcbuild.compiler.args": /, ''))).toEqual([
      expect.stringContaining('-f is not used'),
      expect.stringContaining('-o is not used'),
      expect.stringContaining('--stage is not used'),
      expect.stringContaining('"main.bas" is not a flag'),
      expect.stringContaining('-O 9: not 0, 1, 2, 3 or s'),
      expect.stringContaining('--org zzz: not an address'),
      expect.stringContaining('"E300" is not a warning code'),
    ]);
  });
});
