/** toolpaths.ts -- where the Python tools, the SDK and the emulators live. No vscode import (unit-testable). */
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

/**
 * A cpcbuild folder: the one that holds tools/ (the Python image engine, the converters). The BASIC library itself
 * is always the one bundled with the extension, which must match the bundled compiler.
 */
export function isLibraryDir(dir: string): boolean {
  return exists(path.join(dir, 'tools', 'img2cpc.py'));
}

/**
 * The cpcbuild folder (tools/): the setting, then the project's "library", then upwards from the
 * project, then the SDK folder, and last the copy bundled in the extension (`bundled`). An explicit but wrong setting or
 * "library" is never replaced by a guess.
 */
export function resolveLibraryPure(projectDir: string, s: { libraryPath: string }, projectLibrary?: string | null, bundled?: string, sdk?: string): string | undefined {
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
  if (sdk && isLibraryDir(sdk)) return sdk;
  return bundled && isLibraryDir(bundled) ? bundled : undefined;
}

export function fileExists(p: string): boolean {
  return exists(p);
}

// ------------------------------------------------------------------ the tool lookup order (release-setup C1)

/** `name` (+ `.exe` on Windows). */
export const exeName = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? `${name}.exe` : name);

export interface LookupEnv {
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** The directories of a PATH value. */
export function pathDirs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  return (key ? env[key] ?? '' : '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
}

/** An SDK folder holds bin/cpcbas.mjs (the command-line compiler). */
export const isSdkDir = (dir: string, _platform: NodeJS.Platform, exists: (p: string) => boolean): boolean => exists(path.join(dir, 'bin', 'cpcbas.mjs'));

/**
 * The SDK folder: `cpcbuild.sdk.path` when set (undefined if it holds no bin/cpcbas.mjs: never replaced by a guess),
 * else the first folder at or above the project (12 levels, like the library walk) that holds bin/cpcbas.mjs.
 */
export function findSdk(projectDir: string, sdkSetting: string, o: LookupEnv = {}): string | undefined {
  const platform = o.platform ?? process.platform;
  const has = o.exists ?? isFile;
  if (sdkSetting.trim()) {
    const d = absFrom(projectDir, sdkSetting.trim());
    return isSdkDir(d, platform, has) ? d : undefined;
  }
  let d = projectDir;
  for (let i = 0; i < 12; i++) {
    if (isSdkDir(d, platform, has)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return undefined;
}

// --------------------------------------------------------------------------- emulators and Tiled (release-setup C5)

/** Tiled: the usual install places per platform (flatpak is not a path: set "cpcbuild.tiled.path"). */
export function tiledCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (platform === 'win32') {
    return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs')].filter((d): d is string => !!d).map((d) => path.win32.join(d, 'Tiled', 'tiled.exe'));
  }
  if (platform === 'darwin') return ['/Applications/Tiled.app', '/usr/local/bin/tiled', '/opt/homebrew/bin/tiled'];
  return ['/usr/bin/tiled', '/usr/local/bin/tiled', '/snap/bin/tiled'];
}

/** Where a checkout keeps its built Caprice32 (the binary is `cap32.exe` when built on Windows). */
export function cap32Candidates(library: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  return library ? [path.join(library, 'tools/caprice32/work/src', exeName('cap32', platform)), path.resolve(library, '../caprice32', exeName('cap32', platform))] : [];
}

export function cpcecCandidates(library: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  return library ? [path.join(library, 'tools/cpcec/work', exeName('cpcec', platform))] : [];
}
