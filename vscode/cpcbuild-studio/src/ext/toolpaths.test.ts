import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../core/testutil';
import { CompilerResolution, cap32Candidates, cpcecCandidates, describeCompiler, exeName, findSdk, mkdskCommand, resolveCompiler, resolveLibraryPure, resolveMkdskPure, tiledCandidates } from './toolpaths';

const base = scratchDir('toolpaths-');
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
const mkLib = (dir: string): string => {
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'lib', 'cpcbuild.bas'), "' lib\n");
  return dir;
};
const project = path.join(base, 'a', 'b', 'proj');
fs.mkdirSync(project, { recursive: true });

describe('resolveLibrary', () => {
  it('falls back to the bundled copy when no setting and no checkout above the project', () => {
    const bundled = mkLib(path.join(base, 'ext', 'bundled'));
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, bundled)).toBe(bundled);
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, undefined)).toBeUndefined();
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, path.join(base, 'nope'))).toBeUndefined();
  });
  it('prefers the setting, then the project field, then a checkout above, then the bundled copy', () => {
    const bundled = path.join(base, 'ext', 'bundled');
    const set = mkLib(path.join(base, 'set'));
    const field = mkLib(path.join(base, 'field'));
    expect(resolveLibraryPure(project, { libraryPath: set }, field, bundled)).toBe(set);
    expect(resolveLibraryPure(project, { libraryPath: '' }, field, bundled)).toBe(field);
    const above = mkLib(path.join(base, 'a'));
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, bundled)).toBe(above);
    fs.rmSync(path.join(above, 'lib'), { recursive: true });
  });
  it('never replaces an explicit but wrong path with a guess (or the bundled copy)', () => {
    const bundled = path.join(base, 'ext', 'bundled');
    expect(resolveLibraryPure(project, { libraryPath: path.join(base, 'wrong') }, null, bundled)).toBeUndefined();
    expect(resolveLibraryPure(project, { libraryPath: '' }, '../missing', bundled)).toBeUndefined();
  });
  it('mkdsk.py is never taken from the bundle (it is AGPL and stays in the compiler checkout)', () => {
    const bundled = path.join(base, 'ext', 'bundled');
    fs.mkdirSync(path.join(bundled, 'tools'), { recursive: true });
    fs.writeFileSync(path.join(bundled, 'tools', 'mkdsk.py'), '');
    expect(resolveMkdskPure({ zxbcCwd: '' }, project, bundled)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the lookup order (release-setup C1)

const j = (...p: string[]): string => path.join(path.sep, ...p);
const has = (...files: string[]) => (p: string) => files.includes(p);
const proj = j('work', 'game');
const bs = { zxbcCommand: ['zxbc'], zxbcCwd: '', sdkPath: '' };
const managed = j('store', 'tools', 'zxbasic-1.19.0-cpc.1');

describe('resolveCompiler: first hit wins', () => {
  const sdkBin = j('work', 'bin', 'zxbc');
  const managedBin = path.join(managed, 'zxbc');
  const onPath = j('usr', 'local', 'bin', 'zxbc');
  const pyproject = j('zx', 'pyproject.toml');
  const poetry = j('home', 'u', '.local', 'bin', 'poetry');
  const o = (...files: string[]) => ({ exists: has(...files), env: { PATH: `${j('opt')}:${j('usr', 'local', 'bin')}` }, home: j('home', 'u') });
  const all = [sdkBin, managedBin, onPath, pyproject, poetry];

  it('1. an explicit zxbc.command beats everything and is used as given', () => {
    const r = resolveCompiler({ ...bs, zxbcCommand: ['/my/zxbc', '-x'] }, proj, managed, 'linux', o(...all));
    expect(r).toEqual({ kind: 'setting', zxbc: ['/my/zxbc', '-x'] });
  });
  it('2. the SDK folder (bin/zxbc at or above the project) beats managed, PATH and Poetry', () => {
    const r = resolveCompiler(bs, proj, managed, 'linux', o(...all));
    expect(r).toMatchObject({ kind: 'sdk', zxbc: [sdkBin], dir: j('work') });
    expect(describeCompiler(r as any)).toBe(`sdk: ${j('work')}`);
  });
  it('2. cpcbuild.sdk.path names the SDK (relative to the project); a wrong one is reported, never replaced by a guess', () => {
    const sdk = j('elsewhere', 'sdk');
    const r = resolveCompiler({ ...bs, sdkPath: sdk }, proj, managed, 'linux', o(...all, path.join(sdk, 'bin', 'zxbc')));
    expect(r).toMatchObject({ kind: 'sdk', dir: sdk, zxbc: [path.join(sdk, 'bin', 'zxbc')] });
    const rel = resolveCompiler({ ...bs, sdkPath: '../sdk' }, proj, managed, 'linux', o(j('work', 'sdk', 'bin', 'zxbc')));
    expect(rel).toMatchObject({ kind: 'sdk', dir: j('work', 'sdk') });
    const wrong = resolveCompiler({ ...bs, sdkPath: j('nope') }, proj, managed, 'linux', o(...all));
    expect(wrong.kind).toBe('none');
    expect((wrong as any).problem).toMatch(/"cpcbuild.sdk.path" is .*no bin\/zxbc under/);
  });
  it('3. the managed tools come next', () => {
    const r = resolveCompiler(bs, proj, managed, 'linux', o(managedBin, onPath, pyproject, poetry));
    expect(r).toMatchObject({ kind: 'managed', zxbc: [managedBin], dir: managed });
  });
  it('3. a managed folder without zxbc (half-installed, or none yet) is skipped', () => {
    expect(resolveCompiler(bs, proj, managed, 'linux', o(onPath)).kind).toBe('path');
    expect(resolveCompiler(bs, proj, undefined, 'linux', o(onPath)).kind).toBe('path');
  });
  it('4. zxbc on PATH, found as a full path', () => {
    expect(resolveCompiler(bs, proj, managed, 'linux', o(onPath, pyproject, poetry))).toEqual({ kind: 'path', zxbc: [onPath] });
  });
  it('5. poetry run zxbc only when zxbc.cwd holds a pyproject.toml and poetry exists', () => {
    const s = { ...bs, zxbcCwd: j('zx') };
    const r = resolveCompiler(s, proj, managed, 'linux', { ...o(pyproject, poetry), env: { PATH: '' } });
    expect(r).toEqual({ kind: 'poetry', zxbc: [poetry, 'run', 'zxbc'] });
    expect(resolveCompiler(s, proj, managed, 'linux', { ...o(poetry), env: { PATH: '' } }).kind).toBe('none');
    expect(resolveCompiler(s, proj, managed, 'linux', { ...o(pyproject), env: { PATH: '' } }).kind).toBe('none');
  });
  it('a zxbc.cwd checkout is an explicit choice: it beats the SDK, managed and PATH copies', () => {
    const s = { ...bs, zxbcCwd: j('zx') };
    expect(resolveCompiler(s, proj, managed, 'linux', o(...all))).toEqual({ kind: 'poetry', zxbc: [poetry, 'run', 'zxbc'] });
    // a zxbc.cwd that is not a checkout does not stop the lookup
    expect(resolveCompiler({ ...bs, zxbcCwd: j('elsewhere') }, proj, managed, 'linux', o(...all)).kind).toBe('sdk');
  });
  it('nothing found: none, without a problem', () => {
    expect(resolveCompiler(bs, proj, managed, 'linux', o())).toEqual({ kind: 'none' });
  });
  it('uses the .exe names on Windows (and not the plain ones)', () => {
    const wsdk = j('work', 'bin', 'zxbc.exe');
    expect(resolveCompiler(bs, proj, managed, 'win32', { exists: has(wsdk), env: { PATH: '' } })).toMatchObject({ kind: 'sdk', zxbc: [wsdk] });
    expect(resolveCompiler(bs, proj, managed, 'win32', { exists: has(sdkBin), env: { PATH: '' } }).kind).toBe('none');
    const wman = path.join(managed, 'zxbc.exe');
    expect(resolveCompiler(bs, proj, managed, 'win32', { exists: has(wman), env: { PATH: '' } })).toMatchObject({ kind: 'managed', zxbc: [wman] });
    const dir = 'C:\\tools';
    expect(resolveCompiler(bs, proj, undefined, 'win32', { exists: has(path.join(dir, 'zxbc.exe')), env: { Path: dir } })).toMatchObject({ kind: 'path' });
    expect(exeName('mkdsk', 'win32')).toBe('mkdsk.exe');
    expect(exeName('mkdsk', 'darwin')).toBe('mkdsk');
  });
  it('mkdsk next to the SDK or managed zxbc is run directly', () => {
    const mk = j('work', 'bin', 'mkdsk');
    expect(resolveCompiler(bs, proj, managed, 'linux', o(sdkBin, mk))).toMatchObject({ kind: 'sdk', mkdsk: [mk] });
    const mm = path.join(managed, 'mkdsk');
    expect(resolveCompiler(bs, proj, managed, 'linux', o(managedBin, mm))).toMatchObject({ kind: 'managed', mkdsk: [mm] });
    expect((resolveCompiler(bs, proj, managed, 'linux', o(sdkBin)) as CompilerResolution).mkdsk).toBeUndefined();
    const wmk = path.join(managed, 'mkdsk.exe');
    expect(resolveCompiler(bs, proj, managed, 'win32', { exists: has(path.join(managed, 'zxbc.exe'), wmk), env: { PATH: '' } })).toMatchObject({ mkdsk: [wmk] });
  });
});

describe('findSdk', () => {
  it('walks up at most 12 levels from the project', () => {
    const deep = j('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm');
    expect(findSdk(deep, '', { platform: 'linux', exists: has(j('a', 'bin', 'zxbc')) })).toBeUndefined(); // 13th folder up
    expect(findSdk(deep, '', { platform: 'linux', exists: has(j('a', 'b', 'bin', 'zxbc')) })).toBe(j('a', 'b'));
    expect(findSdk(j('x'), '', { platform: 'linux', exists: has() })).toBeUndefined();
  });
});

describe('mkdskCommand', () => {
  const py = ['python3'];
  const sdk = { kind: 'sdk' as const, zxbc: ['/s/bin/zxbc'], mkdsk: ['/s/bin/mkdsk'] };
  it('runs the mkdsk program directly when the compiler came with one', () => {
    expect(mkdskCommand(sdk, { zxbcCwd: '' }, proj, undefined, py)).toEqual(['/s/bin/mkdsk']);
  });
  it('runs mkdsk.py through Python from the zxbc.cwd checkout, even next to a managed compiler', () => {
    const co = scratchDir('mkdsk-co-');
    fs.mkdirSync(path.join(co, 'tools', 'cpc'), { recursive: true });
    fs.writeFileSync(path.join(co, 'tools', 'cpc', 'mkdsk.py'), '#');
    expect(mkdskCommand(sdk, { zxbcCwd: co }, proj, undefined, py)).toEqual(['python3', path.join(co, 'tools', 'cpc', 'mkdsk.py')]);
    expect(mkdskCommand({ kind: 'poetry', zxbc: ['poetry'] }, { zxbcCwd: co }, proj, undefined, ['py', '-3'])).toEqual(['py', '-3', path.join(co, 'tools', 'cpc', 'mkdsk.py')]);
    fs.rmSync(co, { recursive: true, force: true });
  });
  it('is undefined when there is neither', () => {
    expect(mkdskCommand({ kind: 'path', zxbc: ['/x/zxbc'] }, { zxbcCwd: '' }, proj, undefined, py)).toBeUndefined();
    expect(mkdskCommand({ kind: 'none' }, { zxbcCwd: '' }, proj, undefined, py)).toBeUndefined();
  });
});

describe('the SDK folder in the library lookup', () => {
  const base0 = base;
  it('comes after the project settings and the walk, before the bundled copy', () => {
    const sdk = mkLib(path.join(base0, 'sdk'));
    const bundled = mkLib(path.join(base0, 'bundled2'));
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, bundled, sdk)).toBe(sdk);
    const set = mkLib(path.join(base0, 'set2'));
    expect(resolveLibraryPure(project, { libraryPath: set }, null, bundled, sdk)).toBe(set);
    expect(resolveLibraryPure(project, { libraryPath: path.join(base0, 'wrong2') }, null, bundled, sdk)).toBeUndefined();
    expect(resolveLibraryPure(project, { libraryPath: '' }, null, bundled, path.join(base0, 'no-lib'))).toBe(bundled);
  });
});

describe('Tiled candidates per platform', () => {
  it('Windows: Program Files, with .exe', () => {
    const c = tiledCandidates('win32', { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' });
    expect(c[0]).toBe('C:\\Program Files\\Tiled\\tiled.exe');
    expect(c).toContain('C:\\Users\\u\\AppData\\Local\\Programs\\Tiled\\tiled.exe');
  });
  it('Linux and macOS', () => {
    expect(tiledCandidates('linux')).toEqual(['/usr/bin/tiled', '/usr/local/bin/tiled', '/snap/bin/tiled']);
    expect(tiledCandidates('darwin')[0]).toBe('/Applications/Tiled.app');
  });
});

describe('Caprice32 and CPCEC in a checkout carry .exe on Windows', () => {
  it('names the binaries per platform', () => {
    const lib = j('cpc');
    expect(cap32Candidates(lib, 'win32')).toEqual([path.join(lib, 'tools/caprice32/work/src', 'cap32.exe'), path.resolve(lib, '../caprice32', 'cap32.exe')]);
    expect(cap32Candidates(lib, 'linux')[0]).toBe(path.join(lib, 'tools/caprice32/work/src', 'cap32'));
    expect(cpcecCandidates(lib, 'win32')).toEqual([path.join(lib, 'tools/cpcec/work', 'cpcec.exe')]);
    expect(cpcecCandidates(undefined, 'win32')).toEqual([]);
  });
});
