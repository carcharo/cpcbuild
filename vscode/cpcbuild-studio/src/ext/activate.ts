/** activate.ts -- wiring: commands, task provider, status bar, project diagnostics. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { MODELS, deriveDiscStem } from '../core/project';
import type { EmuEvent } from '../emuApi';
import { buildTarget, BuildResult, RunInfo } from './build';
import { channelSink, getChannel, tee } from './channel';
import { readSettings, resolveLibrary, resolveMkdsk } from './config';
import { checkEnvironment, doctorCommand } from './doctor';
import { newProjectCommand } from './newProject';
import { ImporterEditorProvider, copyImporterCommandCommand, importImageCommand, regenerateAssetsCommand } from './importer';
import { PaletteEditorProvider, newPaletteCommand } from './paletteEditor';
import { generateAssetFileCommand, registerAssetGenerator } from './assetHooks';
import { SpriteEditorProvider, generateAssetFile, insertAssetUse, newAssetCommand } from './spriteEditor';
import { findProjects, loadProjectFile, LoadedProject, pickProject, PROJECT_FILE, publishDiagnostics, selectedTarget } from './projects';
import { runInEmulator } from './run';
import { runTool } from './runTool';
import { state } from './state';
import { CpcbuildTaskProvider, createTask, runLast, TASK_TYPE } from './tasks';
import { registerStubs } from './stubs';
import { registerLintAndHover } from './lintHover';
import { DebugApi, registerDebugFeatures } from './debugFeatures';
import { emuMissingTestApi } from './emuMissing';
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
  /** runInEmulator with explicit settings (tests: no prompts, no real emulator). */
  runIn: typeof runInEmulator;
}

async function configTarget(): Promise<vscode.ConfigurationTarget> {
  return vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

async function projectAndTarget(): Promise<{ lp: LoadedProject; targetId?: string } | undefined> {
  const lp = pickProject(await findProjects());
  if (!lp) {
    const a = await vscode.window.showInformationMessage('CPCBuild: no cpcbuild.json in this workspace.', 'New Project');
    if (a) void vscode.commands.executeCommand('cpcbuild.newProject');
    return undefined;
  }
  if (!lp.project) {
    void vscode.window.showErrorMessage(`CPCBuild: ${lp.file} has problems: ${lp.errors[0]?.message ?? 'invalid'}`);
    void vscode.window.showTextDocument(vscode.Uri.file(lp.file));
    return undefined;
  }
  return { lp, targetId: selectedTarget(lp, readSettings(lp.root).targetDefault)?.id };
}

async function runTask(run: boolean): Promise<void> {
  const pt = await projectAndTarget();
  if (!pt) return;
  const wf = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(pt.lp.file));
  const rel = wf ? path.relative(wf.uri.fsPath, pt.lp.root) : pt.lp.root;
  const def = { type: TASK_TYPE, target: pt.targetId, ...(run ? { run: true } : {}), project: rel || '.' };
  await vscode.tasks.executeTask(createTask(def, wf ?? vscode.TaskScope.Workspace, `${run ? 'build and run' : 'build'} ${pt.targetId}`));
}

/** Explorer "Run in emulator" on a .dsk, .cpr or .bin. */
async function runFile(uri?: vscode.Uri): Promise<void> {
  const file = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
  if (!file) {
    void vscode.window.showInformationMessage('CPCBuild: choose a .dsk, .cpr or .bin file to run.');
    return;
  }
  const s = readSettings(path.dirname(file));
  const ext = path.extname(file).toLowerCase();
  const sink = tee(channelSink);
  getChannel().show(true);
  let run: RunInfo;
  if (ext === '.dsk') run = { file, kind: 'dsk', name: deriveDiscStem(path.basename(file, ext)), model: s.model };
  else if (ext === '.cpr') run = { file, kind: 'cpr', model: 'plus' };
  else if (ext === '.bin') {
    // package first (the emulator never gets a raw .bin): origin from the map beside it, else &0040
    const mapFile = file.replace(/\.bin$/i, '.map');
    let load = 0x40;
    if (fs.existsSync(mapFile)) {
      const { parseMap, programStart } = await import('../core/map');
      load = programStart(parseMap(fs.readFileSync(mapFile, 'utf8'))) ?? 0x40;
    }
    const lib = resolveLibrary(path.dirname(file), s);
    const mkdsk = resolveMkdsk(s, path.dirname(file), lib);
    if (!mkdsk) {
      void vscode.window.showErrorMessage('CPCBuild: mkdsk.py was not found. Set "cpcbuild.zxbc.cwd" to your zxbasic checkout.');
      return;
    }
    const stem = deriveDiscStem(path.basename(file, ext));
    const dsk = file.replace(/\.bin$/i, '.dsk');
    const hex = '0x' + load.toString(16).toUpperCase();
    const r = await runTool([s.pythonPath], [mkdsk, '-o', dsk, '--load', hex, '--exec', hex, '--name', `${stem}.BIN`, file], { sink });
    if (r.code !== 0) {
      void vscode.window.showErrorMessage(`CPCBuild: packaging failed${r.error ? `: ${r.error}` : ` (mkdsk.py exited ${r.code})`}.`);
      return;
    }
    run = { file: dsk, kind: 'dsk', name: stem, model: s.model };
  } else {
    void vscode.window.showInformationMessage(`CPCBuild: cannot run a ${ext || 'file without extension'}; use .dsk, .cpr or .bin.`);
    return;
  }
  const out = await runInEmulator(path.dirname(file), run, sink);
  if (!out.ok) void vscode.window.showErrorMessage(`CPCBuild: ${out.message}`);
}

async function showReport(): Promise<void> {
  const b = state.lastBuild;
  if (!b) {
    void vscode.window.showInformationMessage('CPCBuild: no build yet. Run "CPCBuild: Build" first.');
    return;
  }
  const ch = getChannel();
  ch.appendLine(`--- build report: ${b.targetId} (${b.ok ? 'ok' : 'failed'}, ${b.ms} ms) ---`);
  for (const l of b.reportLines) ch.appendLine(`  ${l}`);
  if (b.message) ch.appendLine(`  ${b.message}`);
  ch.show(true);
}

export function activate(context: vscode.ExtensionContext): StudioApi {
  const diag = vscode.languages.createDiagnosticCollection('cpcbuild-project');
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  status.command = 'cpcbuild.selectTarget';
  context.subscriptions.push(diag, status, getChannel());

  async function refresh(): Promise<void> {
    const projects = await findProjects();
    diag.clear();
    for (const p of projects) publishDiagnostics(diag, p);
    const lp = pickProject(projects);
    const s = readSettings(lp?.root);
    const t = lp && selectedTarget(lp, s.targetDefault);
    if (lp && t) {
      status.text = `$(chip) ${t.id}`;
      status.tooltip = `CPCBuild target (${t.package}); emulator: ${s.emulator}. Click to change the target.`;
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
  reg('cpcbuild.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', 'cpcbuild'));
  reg('cpcbuild.selectTarget', async () => {
    const pt = await projectAndTarget();
    if (!pt?.lp.project) return;
    const pick = await vscode.window.showQuickPick(
      pt.lp.project.targets.map((t) => ({ label: t.id, description: `${t.arch}, ${t.package}${t.bare ? ', bare' : ''}`, picked: t.id === pt.targetId })),
      { title: 'CPCBuild: target for Build and Run' },
    );
    if (pick) await vscode.workspace.getConfiguration('cpcbuild').update('target.default', pick.label, await configTarget());
  });
  reg('cpcbuild.selectEmulator', async () => {
    const items = [
      { label: 'emu', description: 'CPCBuild Emulator extension (in a tab)' },
      { label: 'caprice32', description: 'Caprice32 (patched build from `make cap32`)' },
      { label: 'cpcec', description: 'CPCEC (`make cpcec`)' },
      { label: 'rvm', description: 'Retro Virtual Machine' },
      { label: 'custom', description: 'cpcbuild.run.customCommand' },
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'CPCBuild: emulator for Run' });
    if (pick) await vscode.workspace.getConfiguration('cpcbuild').update('run.emulator', pick.label, await configTarget());
  });
  reg('cpcbuild.selectModel', async () => {
    const pick = await vscode.window.showQuickPick([...MODELS], { title: 'CPCBuild: emulated model (overrides each target\'s model)' });
    if (pick) await vscode.workspace.getConfiguration('cpcbuild').update('model', pick, await configTarget());
  });
  // The emulator extension runs this on its pause/resume/close events (design section 2); for now just log.
  const debugApi = registerDebugFeatures(context, reg);
  reg('cpcbuild.emuEvent', (ev: EmuEvent) => {
    state.emuEvents.push(ev);
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
  registerLintAndHover(context, reg);

  return {
    apiVersion: 1,
    lastBuild: () => state.lastBuild,
    emuEvents: () => state.emuEvents,
    debug: debugApi,
    emuMissing: emuMissingTestApi,
    runIn: runInEmulator,
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
