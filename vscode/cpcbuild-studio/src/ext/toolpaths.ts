/** toolpaths.ts -- where the library and the Python tools live. No vscode import (unit-testable). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_ZXBC, isDefaultZxbc, poetryFallback, PoetryEnv } from './zxbcCommand';

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
 * project, then the SDK folder (its lib/), and last the copy bundled in the extension (`bundled`). An explicit but wrong setting or
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

// ------------------------------------------------------------------ the tool lookup order (release-setup C1)

/** `name` (+ `.exe` on Windows). */
export const exeName = (name: string, platform: NodeJS.Platform): string => (platform === 'win32' ? `${name}.exe` : name);

export interface LookupEnv {
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
  /** The PATH to search for zxbc (default process.env). */
  env?: NodeJS.ProcessEnv;
  home?: string;
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

/** An SDK folder holds bin/zxbc (bin/zxbc.exe). */
export const isSdkDir = (dir: string, platform: NodeJS.Platform, exists: (p: string) => boolean): boolean => exists(path.join(dir, 'bin', exeName('zxbc', platform)));

/**
 * The SDK folder: `cpcbuild.sdk.path` when set (undefined if it holds no bin/zxbc: never replaced by a guess),
 * else the first folder at or above the project (12 levels, like the library walk) that holds bin/zxbc.
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

export type CompilerKind = 'setting' | 'sdk' | 'managed' | 'path' | 'poetry';

export interface CompilerResolution {
  kind: CompilerKind;
  /** The command that starts the compiler. */
  zxbc: string[];
  /** The mkdsk program found next to zxbc (sdk, managed); otherwise mkdsk.py through Python, as before. */
  mkdsk?: string[];
  /** The folder it was found in (sdk, managed). */
  dir?: string;
}

/** Nothing resolved. `problem` is set when an explicit setting is wrong (it is reported, later steps are not tried). */
export interface NoCompiler {
  kind: 'none';
  problem?: string;
}

export interface CompilerSettings {
  zxbcCommand: readonly string[];
  zxbcCwd: string;
  sdkPath: string;
}

/**
 * Where the compiler comes from, first hit wins: 1. an explicit "cpcbuild.zxbc.command"; 2. the SDK folder
 * ("cpcbuild.sdk.path", else bin/zxbc at or above the project); 3. the managed tools in `managedDir`
 * (<globalStorage>/tools/zxbasic-<version>/); 4. zxbc on PATH; 5. `poetry run zxbc` in the zxbc.cwd checkout.
 */
export function resolveCompiler(s: CompilerSettings, projectDir: string, managedDir: string | undefined, platform: NodeJS.Platform = process.platform, o: LookupEnv & PoetryEnv = {}): CompilerResolution | NoCompiler {
  const has = o.exists ?? isFile;
  const zxbc = exeName('zxbc', platform);
  if (!isDefaultZxbc(s.zxbcCommand)) return { kind: 'setting', zxbc: [...s.zxbcCommand] };
  const cwd = s.zxbcCwd ? absFrom(projectDir, s.zxbcCwd) : projectDir;
  // a zxbc.cwd naming a checkout is an explicit choice too: it beats the SDK and managed copies
  const explicitFb = s.zxbcCwd ? poetryFallback(DEFAULT_ZXBC, cwd, { ...o, platform }) : undefined;
  if (explicitFb) return { kind: 'poetry', zxbc: explicitFb };
  const sdkSetting = s.sdkPath.trim();
  const sdk = findSdk(projectDir, sdkSetting, { platform, exists: has });
  if (sdkSetting && !sdk) return { kind: 'none', problem: `"cpcbuild.sdk.path" is ${JSON.stringify(sdkSetting)}, but there is no bin/${zxbc} under ${absFrom(projectDir, sdkSetting)}` };
  const direct = (bin: string): { zxbc: string[]; mkdsk?: string[] } => {
    const m = path.join(bin, exeName('mkdsk', platform));
    return { zxbc: [path.join(bin, zxbc)], mkdsk: has(m) ? [m] : undefined };
  };
  if (sdk) return { kind: 'sdk', dir: sdk, ...direct(path.join(sdk, 'bin')) };
  if (managedDir && has(path.join(managedDir, zxbc))) return { kind: 'managed', dir: managedDir, ...direct(managedDir) };
  const onPath = pathDirs(o.env ?? process.env, platform).map((d) => path.join(d, zxbc)).find(has);
  if (onPath) return { kind: 'path', zxbc: [onPath] };
  const fb = poetryFallback(DEFAULT_ZXBC, cwd, { ...o, platform });
  if (fb) return { kind: 'poetry', zxbc: fb };
  return { kind: 'none' };
}

/** How a resolution is described to the user ("sdk: /opt/cpcbuild"). */
export function describeCompiler(r: CompilerResolution): string {
  return r.kind === 'sdk' || r.kind === 'managed' ? `${r.kind}: ${r.dir}` : r.kind === 'path' ? `path: ${r.zxbc[0]}` : r.kind === 'poetry' ? `poetry: ${r.zxbc.join(' ')}` : `setting: ${r.zxbc.join(' ')}`;
}

/**
 * The command that creates a .dsk: mkdsk.py of the checkout zxbc.cwd names (through `python`), else the mkdsk
 * program next to the compiler (sdk, managed), else mkdsk.py beside the library (through `python`, as before).
 */
export function mkdskCommand(res: CompilerResolution | NoCompiler, s: { zxbcCwd: string }, projectDir: string, library: string | undefined, python: readonly string[]): string[] | undefined {
  const cwdPy = s.zxbcCwd ? resolveMkdskPure(s, projectDir) : undefined;
  if (cwdPy) return [...python, cwdPy];
  if (res.kind !== 'none' && res.mkdsk) return res.mkdsk;
  const py = resolveMkdskPure(s, projectDir, library);
  return py ? [...python, py] : undefined;
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
