/** activate.ts -- wiring: commands, task provider, status bar, project diagnostics. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MODELS, deriveDiscStem } from '../core/project';
import type { EmuEvent } from '../emuApi';
import { buildTarget, BuildResult, RunInfo } from './build';
import { channelSink, getChannel, tee } from './channel';
import { readSettings, resolveLibrary, resolveMkdsk, setBundledLibrary, setToolsStorage } from './config';
import { checkEnvironment, doctorCommand } from './doctor';
import { downloadToolsCommand } from './toolsCommand';
import { newProjectCommand } from './newProject';
import { ImporterEditorProvider, copyImporterCommandCommand, importImageCommand, regenerateAssetsCommand } from './importer';
import { PaletteEditorProvider, newPaletteCommand } from './paletteEditor';
import { generateAssetFileCommand, registerAssetGenerator } from './assetHooks';
import { SpriteEditorProvider, generateAssetFile, insertAssetUse, newAssetCommand, regenerateForPalette } from './spriteEditor';
import { findProjects, loadProjectFile, LoadedProject, pickProject, PROJECT_FILE, publishDiagnostics, selectedTarget } from './projects';
import { runFromCatalogue, targetForDsk } from './dskRun';
import { runInEmulator, setStorageDir } from './run';
import { runTool } from './runTool';
import { chooseTarget, recordEmuEvent, setTargetStore, state } from './state';
import { requireTrust, trustTestApi } from './trust';
import { CpcbuildTaskProvider, createTask, runLast, TASK_TYPE } from './tasks';
import { registerStubs } from './stubs';
import { registerLintAndHover } from './lintHover';
import { DebugApi, registerDebugFeatures } from './debugFeatures';
import { emuMissingTestApi } from './emuMissing';
import { emuInstallTestApi, installEmulator, setEmuInstallContext } from './emuInstall';
import { offerToolsAtActivation, setStudioExtensionId, setupTestApi, updateSetupContext } from './setupPrompts';
import { musicConvertCommand, musicPlayCommand, musicStopCommand } from './music';
import { generateTmxAsset, openInTiledCommand, TmxViewerProvider, tmxGenerateCommand } from './tmxViewer';

/** What the extension exports (used by the extension-host tests; not a public API). */
export interface StudioApi {
  apiVersion: 1;
  lastBuild(): BuildResult | undefined;
  /** Builds one target of the project in `root` (no task, no terminal). */
  build(root: string, targetId: string): Promise<BuildResult>;
  emuEvents(): EmuEvent[];
  /** The palette editor's provider (documents, edit, undo: used by the extension-host tests). */
  palette: PaletteEditorProvider;
  /** The image importer's provider (.cpcimp documents). */
  importer: ImporterEditorProvider;
  /** The sprite (.cpcspr) and tile (.cpctil) editors' providers. */
  sprite: SpriteEditorProvider;
  tile: SpriteEditorProvider;
  /** The .tmx viewer's provider (documents, requests: extension-host tests). */
  tmx: TmxViewerProvider;
  /** Live views and debug controls (extension-host tests). */
  debug: DebugApi;
  /** The missing-emulator warning: test hooks. */
  emuMissing: typeof emuMissingTestApi;
  /** The setup notifications (activation, build failure, Arkos): test hooks. */
  setup: typeof setupTestApi;
  /** The emulator install from the release: test hooks. */
  emuInstall: typeof emuInstallTestApi;
  /** How many lint passes ran for a document (tests wait on this). */
  lintRuns(uri: vscode.Uri): number;
  /** Workspace Trust test hooks (pretend the workspace is untrusted). */
  trust: typeof trustTestApi;
  /** runInEmulator with explicit settings (tests: no prompts, no real emulator). */
  runIn: typeof runInEmulator;
  /** discToRun with a stubbable quick pick (extension-host tests). */
  disc: typeof discTestApi;
}

async function configTarget(): Promise<vscode.ConfigurationTarget> {
  return vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

async function projectAndTarget(): Promise<{ lp: LoadedProject; targetId?: string } | undefined> {
  const lp = pickProject(await findProjects());
  if (!lp) {
    const a = await vscode.window.showInformationMessage('CPC Game Studio: no cpcbuild.json in this workspace.', 'New Project');
    if (a) void vscode.commands.executeCommand('cpcbuild.newProject');
    return undefined;
  }
  if (!lp.project) {
    void vscode.window.showErrorMessage(`CPC Game Studio: ${lp.file} has problems: ${lp.errors[0]?.message ?? 'invalid'}`);
    void vscode.window.showTextDocument(vscode.Uri.file(lp.file));
    return undefined;
  }
  return { lp, targetId: selectedTarget(lp, readSettings(lp.root).targetDefault)?.id };
}

async function runTask(run: boolean): Promise<void> {
  if (!requireTrust(run ? 'Build and Run' : 'Build')) return;
  const pt = await projectAndTarget();
  if (!pt) return;
  const wf = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pt.lp.file));
  const rel = wf ? path.relative(wf.uri.fsPath, pt.lp.root) : pt.lp.root;
  const def = { type: TASK_TYPE, target: pt.targetId, ...(run ? { run: true } : {}), project: rel || '.' };
  await vscode.tasks.executeTask(createTask(def, wf ?? vscode.TaskScope.Workspace, `${run ? 'build and run' : 'build'} ${pt.targetId}`));
}

/**
 * The program to RUN from a .dsk: the disc name of the project target that builds this file, else the
 * disc's own catalogue (one .BIN or .BAS runs; several ask). Undefined = nothing to run (already told).
 */
/** Test hooks for discToRun: `pick` answers the "which program" quick pick without showing it. */
export const discTestApi: { pick?: (candidates: string[]) => Promise<string | undefined>; discToRun: typeof discToRun } = {
  discToRun: (file, s) => discToRun(file, s),
};

async function discToRun(file: string, s: ReturnType<typeof readSettings>): Promise<{ name: string; model: RunInfo['model'] } | undefined> {
  for (const lp of await findProjects()) {
    if (!lp.project) continue;
    const t = targetForDsk(lp.root, readSettings(lp.root).outputDir, lp.project.targets, file);
    if (t) return { name: t.disc, model: s.modelOverride ?? t.model };
  }
  let img: Uint8Array;
  try {
    img = fs.readFileSync(file);
  } catch (e) {
    void vscode.window.showErrorMessage(`CPC Game Studio: cannot read ${file}: ${(e as Error).message}`);
    return undefined;
  }
  const c = runFromCatalogue(img);
  if (c.kind === 'one') return { name: c.name, model: s.model };
  if (c.kind === 'many') {
    const pick = await (discTestApi.pick ?? ((cs: string[]) => vscode.window.showQuickPick(cs, { title: 'CPC Game Studio: which program to run from this disc?' })))(c.candidates);
    return pick ? { name: pick, model: s.model } : undefined;
  }
  void vscode.window.showInformationMessage(
    c.kind === 'none' ? 'CPC Game Studio: the disc has no .BIN or .BAS program to run.' : `CPC Game Studio: ${path.basename(file)} is not a readable CPC disc image.`,
  );
  return undefined;
}

/** Explorer "Run in emulator" on a .dsk, .cpr or .bin. */
async function runFile(uri?: vscode.Uri): Promise<void> {
  const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!file) {
    void vscode.window.showInformationMessage('CPC Game Studio: choose a .dsk, .cpr or .bin file to run.');
    return;
  }
  const s = readSettings(path.dirname(file));
  const ext = path.extname(file).toLowerCase();
  const sink = tee(channelSink);
  getChannel().show(true);
  let run: RunInfo;
  if (ext === '.dsk') {
    const found = await discToRun(file, s);
    if (!found) return;
    run = { file, kind: 'dsk', name: found.name, model: found.model };
  }
  else if (ext === '.cpr') run = { file, kind: 'cpr', model: 'plus' };
  else if (ext === '.bin') {
    // package first (the emulator never gets a raw .bin): origin from the map beside it, else &0040
    const mapFile = file.replace(/\.bin$/i, '.map');
    let load = 0x40;
    if (fs.existsSync(mapFile)) {
      const { parseMap, programStart } = await import('../core/map');
      load = programStart(parseMap(fs.readFileSync(mapFile, 'utf8'))) ?? 0x40;
    }
    if (!requireTrust('Run in Emulator for a .bin file (it is packaged with mkdsk first)')) return;
    const lib = resolveLibrary(path.dirname(file), s);
    const mkdsk = resolveMkdsk(s, path.dirname(file), lib);
    if (!mkdsk) {
      void vscode.window.showErrorMessage('CPC Game Studio: mkdsk was not found. Run "CPC Game Studio: Download Tools", or set "cpcbuild.zxbc.cwd" to your zxbasic checkout.');
      return;
    }
    const stem = deriveDiscStem(path.basename(file, ext));
    const dsk = file.replace(/\.bin$/i, '.dsk');
    const hex = '0x' + load.toString(16).toUpperCase();
    const r = await runTool(mkdsk, ['-o', dsk, '--load', hex, '--exec', hex, '--name', `${stem}.BIN`, file], { sink });
    if (r.code !== 0) {
      void vscode.window.showErrorMessage(`CPC Game Studio: packaging failed${r.error ? `: ${r.error}` : ` (mkdsk exited ${r.code})`}.`);
      return;
    }
    run = { file: dsk, kind: 'dsk', name: stem, model: s.model };
  } else {
    void vscode.window.showInformationMessage(`CPC Game Studio: cannot run a ${ext || 'file without extension'}; use .dsk, .cpr or .bin.`);
    return;
  }
  const out = await runInEmulator(path.dirname(file), run, sink);
  if (!out.ok) void vscode.window.showErrorMessage(`CPC Game Studio: ${out.message}`);
}

async function showReport(): Promise<void> {
  const b = state.lastBuild;
  if (!b) {
    void vscode.window.showInformationMessage('CPC Game Studio: no build yet. Run "CPC Game Studio: Build" first.');
    return;
  }
  const ch = getChannel();
  ch.appendLine(`--- build report: ${b.targetId} (${b.ok ? 'ok' : 'failed'}, ${b.ms} ms) ---`);
  for (const l of b.reportLines) ch.appendLine(`  ${l}`);
  if (b.message) ch.appendLine(`  ${b.message}`);
  ch.show(true);
}

export function activate(context: vscode.ExtensionContext): StudioApi {
  setStorageDir(context.globalStorageUri.fsPath);
  setToolsStorage(context.globalStorageUri.fsPath);
  setTargetStore(context.workspaceState);
  setStudioExtensionId(context.extension.id);
  setEmuInstallContext(String(context.extension.packageJSON.version), context.globalStorageUri.fsPath);
  setBundledLibrary(vscode.Uri.joinPath(context.extensionUri, 'bundled').fsPath);
  const diag = vscode.languages.createDiagnosticCollection('cpcbuild-project');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'cpcbuild.selectTarget';
  context.subscriptions.push(diag, status, getChannel());

  async function refresh(): Promise<void> {
    const projects = await findProjects();
    // menus for project files (Run, Import Image, ...) show only where a cpcbuild.json exists
    void vscode.commands.executeCommand('setContext', 'cpcbuild.inProject', projects.length > 0);
    diag.clear();
    for (const p of projects) publishDiagnostics(diag, p);
    const lp = pickProject(projects);
    const s = readSettings(lp?.root);
    const t = lp && selectedTarget(lp, s.targetDefault);
    if (lp && t) {
      status.text = `$(chip) ${t.id}`;
      status.tooltip = `CPC Game Studio target (${t.package}); emulator: ${s.emulator}. Click to change the target.`;
      status.show();
    } else if (lp) {
      status.text = '$(warning) cpcbuild.json';
      status.tooltip = 'cpcbuild.json has problems';
      status.show();
    } else status.hide();
  }
  const watcher = vscode.workspace.createFileSystemWatcher(`**/${PROJECT_FILE}`);
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => void refresh()),
    watcher.onDidCreate(() => void refresh()),
    watcher.onDidDelete(() => void refresh()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpcbuild') && void refresh()),
    vscode.window.onDidChangeActiveTextEditor(() => void refresh()),
    vscode.tasks.registerTaskProvider(TASK_TYPE, new CpcbuildTaskProvider()),
  );
  void refresh();
  // walkthrough completion (cpcbuild.toolsInstalled, cpcbuild.emuInstalled) and the one-per-session "no compiler" notice
  void updateSetupContext();
  context.subscriptions.push(
    vscode.extensions.onDidChange(() => void updateSetupContext()),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpcbuild') && void updateSetupContext()),
  );
  // the extension-host tests start with no tools on purpose: they ask for the notice through setupTestApi
  if (context.extensionMode !== vscode.ExtensionMode.Test) void offerToolsAtActivation();

  const reg = (id: string, fn: (...a: any[]) => unknown): void => void context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('cpcbuild.newProject', (args) => newProjectCommand(args));
  reg('cpcbuild.build', () => runTask(false));
  reg('cpcbuild.buildAndRun', () => runTask(true));
  reg('cpcbuild.run', async () => {
    getChannel().show(true);
    await runLast(channelSink);
  });
  reg('cpcbuild.runFile', runFile);
  reg('cpcbuild.showBuildReport', showReport);
  reg('cpcbuild.checkEnvironment', async () => doctorCommand(pickProject(await findProjects())?.root, channelSink, () => getChannel().show(true)));
  reg('cpcbuild.downloadTools', async (arg) => {
    const r = await downloadToolsCommand(arg);
    void updateSetupContext();
    return r;
  });
  reg('cpcbuild.installEmulator', async (arg) => {
    const lp = pickProject(await findProjects());
    const base = lp?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    return installEmulator(arg ?? { library: resolveLibrary(base, readSettings(lp?.root)) });
  });
  reg('cpcbuild.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'cpcbuild'));
  reg('cpcbuild.selectTarget', async () => {
    const pt = await projectAndTarget();
    if (!pt?.lp.project) return;
    const pick = await vscode.window.showQuickPick(
      pt.lp.project.targets.map((t) => ({ label: t.id, description: `${t.arch}, ${t.package}${t.bare ? ', bare' : ''}`, picked: t.id === pt.targetId })),
      { title: 'CPC Game Studio: target for Build and Run' },
    );
    if (pick) {
      await chooseTarget(pt.lp.root, pick.label);
      void refresh();
    }
  });
  reg('cpcbuild.selectEmulator', async () => {
    const items = [
      { label: 'emu', description: 'CPC Game Studio Emulator extension (in a tab)' },
      { label: 'caprice32', description: 'Caprice32 (patched build from `make cap32`)' },
      { label: 'cpcec', description: 'CPCEC (`make cpcec`)' },
      { label: 'rvm', description: 'Retro Virtual Machine' },
      { label: 'custom', description: 'cpcbuild.run.customCommand' },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'CPC Game Studio: emulator for Run' });
    if (pick) await vscode.workspace.getConfiguration('cpcbuild').update('run.emulator', pick.label, await configTarget());
  });
  reg('cpcbuild.selectModel', async () => {
    const pick = await vscode.window.showQuickPick([...MODELS], { title: 'CPC Game Studio: emulated model (overrides each target\'s model)' });
    if (pick) await vscode.workspace.getConfiguration('cpcbuild').update('model', pick, await configTarget());
  });
  // The emulator extension runs this on its pause/resume/close events (design section 2); for now just log.
  const debugApi = registerDebugFeatures(context, reg);
  reg('cpcbuild.emuEvent', (ev: EmuEvent) => {
    recordEmuEvent(ev);
    getChannel().appendLine(`emu event: ${JSON.stringify(ev)}`);
    debugApi.onEvent(ev);
  });
  const palette = new PaletteEditorProvider(context);
  context.subscriptions.push(palette.register());
  reg('cpcbuild.newPalette', (args) => newPaletteCommand(args));
  const importer = new ImporterEditorProvider(context);
  context.subscriptions.push(importer.register());
  reg('cpcbuild.importImage', (arg) => importImageCommand(arg));
  reg('cpcbuild.regenerateAssets', (args) => regenerateAssetsCommand(args));
  reg('cpcbuild.copyImporterCommand', () => copyImporterCommandCommand(importer));
  const sprite = new SpriteEditorProvider(context, 'spr');
  const tile = new SpriteEditorProvider(context, 'til');
  context.subscriptions.push(sprite.register(), tile.register(), registerAssetGenerator((uri) => generateAssetFile({ sprite, tile }, uri)));
  palette.onSaved = (uri) => regenerateForPalette({ sprite, tile }, uri);
  reg('cpcbuild.newSprite', (args) => newAssetCommand('sprite', args));
  reg('cpcbuild.newTileset', (args) => newAssetCommand('tileset', args));
  reg('cpcbuild.newPlusSprite', (args) => newAssetCommand('plus', args));
  reg('cpcbuild.generateAssetFile', (uri) => generateAssetFileCommand(uri));
  reg('cpcbuild.insertAssetUse', (uri) => insertAssetUse({ sprite, tile }, uri));
  reg('cpcbuild.openAsText', async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const u = target instanceof vscode.Uri ? target : (target as { uri?: vscode.Uri } | undefined)?.uri;
    if (u) await vscode.commands.executeCommand('vscode.openWith', u, 'default');
  });
  const tmx = new TmxViewerProvider(context);
  context.subscriptions.push(tmx.register(), registerAssetGenerator((uri) => generateTmxAsset(uri)));
  reg('cpcbuild.tmx.generate', (arg) => tmxGenerateCommand(arg));
  reg('cpcbuild.openInTiled', (arg) => openInTiledCommand(arg));
  reg('cpcbuild.music.convert', (arg) => musicConvertCommand(arg));
  reg('cpcbuild.music.play', (arg) => musicPlayCommand(arg));
  reg('cpcbuild.music.stop', () => musicStopCommand());
  registerStubs(reg);
  const lint = registerLintAndHover(context, reg);

  return {
    apiVersion: 1,
    lastBuild: () => state.lastBuild,
    emuEvents: () => state.emuEvents,
    debug: debugApi,
    emuMissing: emuMissingTestApi,
    setup: setupTestApi,
    emuInstall: emuInstallTestApi,
    runIn: runInEmulator,
    disc: discTestApi,
    lintRuns: (uri) => lint.runs(uri),
    trust: trustTestApi,
    palette,
    importer,
    sprite,
    tile,
    tmx,
    async build(root, targetId) {
      const lp = loadProjectFile(path.join(root, PROJECT_FILE));
      if (!lp.project) throw new Error(`${lp.file}: ${lp.errors.map((e) => e.message).join('; ')}`);
      const t = lp.project.targets.find((x) => x.id === targetId);
      if (!t) throw new Error(`no target ${targetId} in ${lp.file}`);
      const res = await buildTarget(root, lp.project, t, channelSink);
      state.lastBuild = res;
      return res;
    },
  };
}

export function deactivate(): void {}

export { checkEnvironment };
