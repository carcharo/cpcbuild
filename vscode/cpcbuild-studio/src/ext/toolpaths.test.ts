import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../core/testutil';
import { cap32Candidates, cpcecCandidates, exeName, findSdk, resolveLibraryPure, tiledCandidates } from './toolpaths';

const base = scratchDir('toolpaths-');
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
const mkLib = (dir: string): string => {
  fs.mkdirSync(path.join(dir, 'tools'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tools', 'img2cpc.py'), '# tool\n');
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
    fs.rmSync(path.join(above, 'tools'), { recursive: true });
  });
  it('never replaces an explicit but wrong path with a guess (or the bundled copy)', () => {
    const bundled = path.join(base, 'ext', 'bundled');
    expect(resolveLibraryPure(project, { libraryPath: path.join(base, 'wrong') }, null, bundled)).toBeUndefined();
    expect(resolveLibraryPure(project, { libraryPath: '' }, '../missing', bundled)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- the lookup order (release-setup C1)

const j = (...p: string[]): string => path.join(path.sep, ...p);
const has = (...files: string[]) => (p: string) => files.includes(p);

it('exeName adds .exe on Windows only', () => {
  expect(exeName('cap32', 'win32')).toBe('cap32.exe');
  expect(exeName('cap32', 'darwin')).toBe('cap32');
});

describe('findSdk', () => {
  it('walks up at most 12 levels from the project', () => {
    const deep = j('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm');
    expect(findSdk(deep, '', { platform: 'linux', exists: has(j('a', 'bin', 'cpcbas.mjs')) })).toBeUndefined(); // 13th folder up
    expect(findSdk(deep, '', { platform: 'linux', exists: has(j('a', 'b', 'bin', 'cpcbas.mjs')) })).toBe(j('a', 'b'));
    expect(findSdk(j('x'), '', { platform: 'linux', exists: has() })).toBeUndefined();
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
