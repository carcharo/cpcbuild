/** toolpaths.ts -- where the library and the Python tools live. No vscode import (unit-testable). */
import * as fs from 'node:fs';
import * as path from 'node:path';

const exists = (p: string): boolean => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

/** Absolute path from a setting; relative ones are taken from the project folder. */
export function absFrom(base: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}

export function isLibraryDir(dir: string): boolean {
  return exists(path.join(dir, 'lib', 'cpcbuild.bas'));
}

/**
 * The cpcbuild folder (lib/ and tools/): the setting, then the project's "library", then upwards from the
 * project, and last the copy bundled in the extension (`bundled`). An explicit but wrong setting or
 * "library" is never replaced by a guess.
 */
export function resolveLibraryPure(projectDir: string, s: { libraryPath: string }, projectLibrary?: string | null, bundled?: string): string | undefined {
  const cands: string[] = [];
  if (s.libraryPath) cands.push(absFrom(projectDir, s.libraryPath));
  if (projectLibrary) cands.push(absFrom(projectDir, projectLibrary));
  for (const c of cands) if (isLibraryDir(c)) return c;
  if (cands.length) return undefined;
  let d = projectDir;
  for (let i = 0; i < 12; i++) {
    if (isLibraryDir(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return bundled && isLibraryDir(bundled) ? bundled : undefined;
}

/** mkdsk.py (AGPL, so it is not bundled): zxbc.cwd's tools/cpc/, then the zxbasic sibling of the library. */
export function resolveMkdskPure(s: { zxbcCwd: string }, projectDir: string, library?: string): string | undefined {
  const tryDir = (d: string): string | undefined => {
    const p = path.join(d, 'tools', 'cpc', 'mkdsk.py');
    return exists(p) ? p : undefined;
  };
  if (s.zxbcCwd) {
    const p = tryDir(absFrom(projectDir, s.zxbcCwd));
    if (p) return p;
  }
  if (library) {
    const p = tryDir(path.resolve(library, '..', 'zxbasic'));
    if (p) return p;
  }
  return undefined;
}

export function resolveMkcpr(library?: string): string | undefined {
  if (!library) return undefined;
  const p = path.join(library, 'tools', 'mkcpr.py');
  return exists(p) ? p : undefined;
}

export function fileExists(p: string): boolean {
  return exists(p);
}
