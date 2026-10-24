/** config.ts -- the `cpcbuild.*` settings (spec 6) and where the tools live. */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MODELS, Model, parseAddress } from '../core/project';
import { arkosDirName, ToolsManifest, zxbasicDirName } from '../core/tools';
import { manifest } from './toolsManifest';

export type EmulatorChoice = 'emu' | 'caprice32' | 'cpcec' | 'rvm' | 'custom';

export interface Settings {
  zxbcCommand: string[];
  zxbcCwd: string;
  zxbcArgs: string[];
  /** "cpcbuild.sdk.path" (empty = look for an SDK folder above the project). */
  sdkPath: string;
  /** The Python program ("py -3" = the Windows launcher, when the setting is unset there). */
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
  /** External Spectrum emulator for .tap targets (empty = none) and its arguments (${file} = the .tap). */
  zxEmulator: string;
  zxEmulatorArgs: string[];
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

/** `python3`, or `py -3` on Windows while the setting is unset (an explicit value is always used as given). */
function pythonSetting(c: vscode.WorkspaceConfiguration): string {
  const i = c.inspect<string>('python.path');
  const set = i?.globalValue ?? i?.workspaceValue ?? i?.workspaceFolderValue;
  if (set) return set;
  return process.platform === 'win32' ? PY_LAUNCHER : 'python3';
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
    sdkPath: c.get<string>('sdk.path') ?? '',
    pythonPath: pythonSetting(c),
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
    zxEmulator: c.get<string>('run.zxEmulator') ?? '',
    zxEmulatorArgs: c.get<string[]>('run.zxEmulatorArgs') ?? ['${file}'],
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

import { findArkosTools } from './arkos';
import { PY_LAUNCHER, pythonCmd, toolEnv } from './runTool';
import { absFrom, CompilerResolution, fileExists, findSdk, isLibraryDir, mkdskCommand, NoCompiler, pathDirs, resolveCompiler, resolveLibraryPure, resolveMkcpr } from './toolpaths';
import { isTrusted } from './trust';

export { absFrom, fileExists, isLibraryDir, resolveMkcpr };

export { manifest };

/** Where Studio may keep files of its own (ExtensionContext.globalStorageUri), set at activation. */
let storageRoot: string | undefined;
export function setToolsStorage(dir: string | undefined): void {
  storageRoot = dir;
}
/** <globalStorage>/tools: the managed tools live under it, one folder per version. */
export const toolsRoot = (): string | undefined => (storageRoot ? path.join(storageRoot, 'tools') : undefined);
export const managedZxbasicDir = (m: ToolsManifest = manifest): string | undefined => {
  const r = toolsRoot();
  return r ? path.join(r, zxbasicDirName(m.zxbasic.version)) : undefined;
};
export const managedArkosDir = (m: ToolsManifest = manifest): string | undefined => {
  const r = toolsRoot();
  return r ? path.join(r, arkosDirName(m.arkos.version), 'bin') : undefined;
};

/** The copy of lib/ and tools/ shipped inside the extension (set at activation); the last place the library is looked for. */
let bundledDir: string | undefined;
export function setBundledLibrary(dir: string | undefined): void {
  bundledDir = dir;
}
export function bundledLibrary(): string | undefined {
  return bundledDir;
}

/** The SDK folder for a project (the setting, else bin/zxbc at or above it). */
export function sdkFolder(projectDir: string, s: Settings): string | undefined {
  return findSdk(projectDir, s.sdkPath);
}

/** The cpcbuild folder: setting, then the project's "library" (ignored in Restricted Mode), then upwards from the project, then the SDK's lib/, then the bundled copy. */
export function resolveLibrary(projectDir: string, s: Settings, projectLibrary?: string | null): string | undefined {
  return resolveLibraryPure(projectDir, s, isTrusted() ? projectLibrary : null, bundledDir, sdkFolder(projectDir, s));
}

/** Where the compiler comes from (explicit setting, SDK, managed tools, PATH, Poetry checkout). */
export function resolveCompilerFor(projectDir: string, s: Settings): CompilerResolution | NoCompiler {
  return resolveCompiler(s, projectDir, managedZxbasicDir(), process.platform, { env: toolEnv() });
}

/** The command that starts the compiler: the resolved one, else the setting (whose "not found" error is then reported). */
export const compilerCommand = (r: CompilerResolution | NoCompiler, s: Settings): string[] => (r.kind === 'none' ? s.zxbcCommand : r.zxbc);

/** The command that creates a .dsk (mkdsk next to the compiler, or mkdsk.py through Python); undefined when neither exists. */
export function resolveMkdsk(s: Settings, projectDir: string, library?: string, res: CompilerResolution | NoCompiler = resolveCompilerFor(projectDir, s)): string[] | undefined {
  return mkdskCommand(res, s, projectDir, library, pythonCmd(s.pythonPath));
}

/** The Arkos command-line tools: setting, SDK, managed, $AT3_TOOLS, PATH, then a checkout's tools/arkos/work/bin. */
export function resolveArkos(projectDir: string, s: Settings, library?: string, override?: string): string | undefined {
  return findArkosTools({
    setting: override ?? s.arkosToolsPath,
    sdk: sdkFolder(projectDir, s),
    managed: managedArkosDir(),
    env: process.env.AT3_TOOLS,
    pathDirs: pathDirs(toolEnv(), process.platform),
    library,
    base: projectDir,
  });
}
