import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { insideRoot, insideRootFrom, isInsideRoot, PathEscapeError } from './paths';

const base = mkdtempSync(path.join(tmpdir(), 'paths-'));
const root = path.join(base, 'proj');
const outside = path.join(base, 'outside');
mkdirSync(root);
mkdirSync(outside);
writeFileSync(path.join(outside, 'secret.txt'), 'x');
symlinkSync(outside, path.join(root, 'link'));
mkdirSync(path.join(root, 'assets'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe('insideRoot', () => {
  it('accepts plain, nested and not-yet-existing relative paths', () => {
    expect(insideRoot(root, 'assets/a.bas')).toBe(path.join(root, 'assets', 'a.bas'));
    expect(insideRoot(root, 'new/dir/a.bas')).toBe(path.join(root, 'new', 'dir', 'a.bas'));
    expect(insideRoot(root, 'assets/../b.bas')).toBe(path.join(root, 'b.bas'));
  });
  it('refuses ../x', () => {
    expect(() => insideRoot(root, '../x')).toThrow(PathEscapeError);
    expect(() => insideRoot(root, 'assets/../../x')).toThrow(/outside the project folder/);
  });
  it('refuses absolute paths (posix and windows spellings)', () => {
    expect(() => insideRoot(root, path.join(outside, 'secret.txt'))).toThrow(/absolute/);
    expect(() => insideRoot(root, '/etc/passwd')).toThrow(PathEscapeError);
    expect(() => insideRoot(root, 'C:\\Windows\\x')).toThrow(PathEscapeError);
  });
  it('refuses a symlink that escapes, for existing and new files', () => {
    expect(() => insideRoot(root, 'link/secret.txt')).toThrow(/symbolic link/);
    expect(() => insideRoot(root, 'link/new.bas')).toThrow(/symbolic link/);
    expect(isInsideRoot(root, 'link/secret.txt')).toBe(false);
  });
  it('refuses empty and NUL paths', () => {
    expect(isInsideRoot(root, '')).toBe(false);
    expect(isInsideRoot(root, 'a\0b')).toBe(false);
  });
});

describe('insideRootFrom (paths relative to a document folder)', () => {
  it('resolves from the document folder and keeps the project root as the boundary', () => {
    const docDir = path.join(root, 'assets');
    expect(insideRootFrom(root, docDir, 'a.bas')).toBe(path.join(root, 'assets', 'a.bas'));
    expect(insideRootFrom(root, docDir, '../b.bas')).toBe(path.join(root, 'b.bas'));
    expect(() => insideRootFrom(root, docDir, '../../x')).toThrow(PathEscapeError);
    expect(() => insideRootFrom(root, docDir, '/etc/passwd')).toThrow(/absolute/);
    expect(() => insideRootFrom(root, docDir, 'a/../../../x')).toThrow(PathEscapeError);
    expect(() => insideRootFrom(root, path.join(root, 'link'), 'secret.txt')).toThrow(/symbolic link/);
  });
});
