/** config.ts -- the `cpcbuild.*` settings (spec 6) and where the tools live. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MODELS, Model, parseAddress } from '../core/project';

export type EmulatorChoice = 'emu' | 'caprice32' | 'cpcec' | 'rvm' | 'custom';

export interface Settings {
  zxbcCommand: string[];
  zxbcCwd: string;
  zxbcArgs: string[];
  pythonPath: string;
  libraryPath: string;
  buildOrg?: number;
  outputDir: string;
  memoryLimits: Record<string, number>;
  targetDefault: string;
  /** The `model` setting when the user set it explicitly; undefined = use each target's own model. */
  modelOverride?: Model;
  model: Model;
  emulator: EmulatorChoice;
  caprice32Path: string;
  cpcecPath: string;
  rvmPath: string;
  customCommand: string;
  autorunCommand: string;
}

/** A resource scope only when the folder is inside a workspace folder (else the workspace-level settings apply). */
function scopeFor(dir?: string): vscode.Uri | undefined {
  if (!dir) return undefined;
  const uri = vscode.Uri.file(dir);
  return vscode.workspace.getWorkspaceFolder(uri) ? uri : undefined;
}

export function readSettings(projectDir?: string): Settings {
  const c = vscode.workspace.getConfiguration('cpcbuild', scopeFor(projectDir));
  const limits: Record<string, number> = {};
  for (const [k, v] of Object.entries(c.get<Record<string, unknown>>('build.memoryLimits') ?? {})) {
    const n = parseAddress(v);
    if (n !== undefined) limits[k] = n;
  }
  const modelInfo = c.inspect<string>('model');
  const explicit = modelInfo?.workspaceFolderValue ?? modelInfo?.workspaceValue ?? modelInfo?.globalValue;
  const model = c.get<string>('model', '6128');
  const orgText = (c.get<string>('build.org') ?? '').trim();
  return {
    zxbcCommand: c.get<string[]>('zxbc.command') ?? ['zxbc'],
    zxbcCwd: c.get<string>('zxbc.cwd') ?? '',
    zxbcArgs: c.get<string[]>('zxbc.args') ?? [],
    pythonPath: c.get<string>('python.path') || 'python3',
    libraryPath: c.get<string>('library.path') ?? '',
    buildOrg: orgText ? parseAddress(orgText) : undefined,
    outputDir: c.get<string>('build.outputDir') || 'build',
    memoryLimits: limits,
    targetDefault: c.get<string>('target.default') ?? '',
    modelOverride: explicit && MODELS.includes(explicit as Model) ? (explicit as Model) : undefined,
    model: MODELS.includes(model as Model) ? (model as Model) : '6128',
    emulator: c.get<EmulatorChoice>('run.emulator') ?? 'emu',
    caprice32Path: c.get<string>('run.caprice32Path') ?? '',
    cpcecPath: c.get<string>('run.cpcecPath') ?? '',
    rvmPath: c.get<string>('run.rvmPath') ?? '',
    customCommand: c.get<string>('run.customCommand') ?? '',
    autorunCommand: c.get<string>('run.autorunCommand') || 'run"${name}',
  };
}

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

/** The cpcbuild checkout (folder with lib/ and tools/): setting, then the project's "library", then upwards from the project. */
export function resolveLibrary(projectDir: string, s: Settings, projectLibrary?: string | null): string | undefined {
  const cands: string[] = [];
  if (s.libraryPath) cands.push(absFrom(projectDir, s.libraryPath));
  if (projectLibrary) cands.push(absFrom(projectDir, projectLibrary));
  for (const c of cands) if (isLibraryDir(c)) return c;
  if (cands.length) return undefined; // an explicit but wrong path: do not guess
  let d = projectDir;
  for (let i = 0; i < 12; i++) {
    if (isLibraryDir(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return undefined;
}

/** The zxbasic checkout holding tools/cpc/mkdsk.py: zxbc.cwd, else the sibling of the cpcbuild checkout. */
export function resolveMkdsk(s: Settings, projectDir: string, library?: string): string | undefined {
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
