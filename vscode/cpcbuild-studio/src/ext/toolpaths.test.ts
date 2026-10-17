import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../core/testutil';
import { resolveLibraryPure, resolveMkdskPure } from './toolpaths';

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
