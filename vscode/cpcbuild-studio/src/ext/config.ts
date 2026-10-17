/** config.ts -- the `cpcbuild.*` settings (spec 6) and where the tools live. */
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
  /** Image importer engine (spec 4.4) and the header of generated files. */
  assetsEngine: 'builtin' | 'python';
  assetsHeader: 'img2cpc' | 'studio' | 'none';
  generateOnSave: boolean;
  regenerateBeforeBuild: boolean;
  /** Arkos command-line tools folder (empty = $AT3_TOOLS, then tools/arkos/work/bin). */
  arkosToolsPath: string;
  arkosTrackerPath: string;
  arkosPsg: 'cpc' | 'spectrum';
  tiledPath: string;
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
    assetsEngine: c.get<string>('assets.engine') === 'python' ? 'python' : 'builtin',
    assetsHeader: ((h) => (h === 'studio' || h === 'none' ? h : 'img2cpc'))(c.get<string>('assets.header')),
    generateOnSave: c.get<boolean>('assets.generateOnSave', true),
    regenerateBeforeBuild: c.get<boolean>('assets.regenerateBeforeBuild', true),
    arkosToolsPath: c.get<string>('arkos.toolsPath') ?? '',
    arkosTrackerPath: c.get<string>('arkos.trackerPath') ?? '',
    arkosPsg: c.get<string>('arkos.psg') === 'spectrum' ? 'spectrum' : 'cpc',
    tiledPath: c.get<string>('tiled.path') ?? '',
  };
}

import { absFrom, fileExists, isLibraryDir, resolveLibraryPure, resolveMkcpr, resolveMkdskPure } from './toolpaths';
import { isTrusted } from './trust';

export { absFrom, fileExists, isLibraryDir, resolveMkcpr };

/** The copy of lib/ and tools/ shipped inside the extension (set at activation); the last place the library is looked for. */
let bundledDir: string | undefined;
export function setBundledLibrary(dir: string | undefined): void {
  bundledDir = dir;
}
export function bundledLibrary(): string | undefined {
  return bundledDir;
}

/** The cpcbuild folder: setting, then the project's "library" (ignored in Restricted Mode), then upwards from the project, then the bundled copy. */
export function resolveLibrary(projectDir: string, s: Settings, projectLibrary?: string | null): string | undefined {
  return resolveLibraryPure(projectDir, s, isTrusted() ? projectLibrary : null, bundledDir);
}

/** mkdsk.py (zxbc.cwd, then the zxbasic sibling of the library). It is AGPL and lives in the compiler's repo, so it is not bundled. */
export function resolveMkdsk(s: Settings, projectDir: string, library?: string): string | undefined {
  return resolveMkdskPure(s, projectDir, library);
}
