/**
 * importer.ts -- the image importer as a custom editor for .cpcimp recipes, plus its commands
 * (Import Image, Regenerate Assets, Copy Importer Command).
 *
 * The recipe model, the option -> command-line mapping, the converter and the preview all live in
 * src/core/cpcimp.ts; this file is the glue: the document (a Recipe), the view the webview draws,
 * the dialogs, generating on save, and the requests that touch files and settings.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  applyRecipeOp, argvToRecipe, commandLine, composeSheet, effectiveOutput, newRecipe, outputsOf,
  parseRecipe, previewOf, RecipeError, serialiseRecipe, shellSplit, type Recipe, type RecipeOp,
} from '../core/cpcimp';
import { decodeImage, ImageReadError } from '../core/imageio';
import { defaultName } from '../core/img2cpc';
import { encodePng } from '../core/image';
import type { GenerateOutcome, ImporterView, PickWhich, PreviewResponse, SourceImage } from '../shared/importerProtocol';
import { insideRoot } from '../core/paths';
import { cachedDecode, decoderFor, describeError, generate, isStale, regenerateAll, rootIo, type GenResult, type GenSettings } from './assetsGen';
import { channelSink, getChannel, tee } from './channel';
import { readSettings, resolveLibrary, type Settings } from './config';
import { StudioDocument, StudioEditorProvider } from './customEditor';
import { isTrusted, requireTrust, restrictedText } from './trust';
import { findProjects, loadProjectFile, pickProject, PROJECT_FILE } from './projects';

export const IMPORTER_VIEW_TYPE = 'cpcbuild.importer';
export const IMAGE_EXTS = ['png', 'gif', 'bmp'];

/** Folder the file's paths are relative to: the nearest cpcbuild.json above it, or undefined (not in a CPCBuild project). */
export function projectRootOf(file: string): string | undefined {
  let d = path.dirname(file);
  for (let i = 0; i < 20; i++) {
    if (fs.existsSync(path.join(d, PROJECT_FILE))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return undefined;
}

/** For read-only previews: the project root, else the file's own folder (reads are still contained to it). Never used to write. */
export function viewRootOf(file: string): string {
  return projectRootOf(file) ?? path.dirname(file);
}

export const NOT_IN_PROJECT = 'not in a CPCBuild project: there is no cpcbuild.json in this folder or above it. Create one with "CPCBuild: New Project".';

/** The project root for a write, or undefined after telling the user. */
export function requireProjectRoot(file: string): string | undefined {
  const r = projectRootOf(file);
  if (!r) void vscode.window.showWarningMessage(`CPCBuild: ${path.basename(file)} is ${NOT_IN_PROJECT}`);
  return r;
}

const toRel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

export function genSettings(root: string, s: Settings = readSettings(root)): GenSettings {
  return { engine: s.assetsEngine, header: s.assetsHeader, pythonPath: s.pythonPath, library: resolveLibrary(root, s) };
}

const MAX_TEXT = 120000;

export class ImporterEditorProvider extends StudioEditorProvider<Recipe, RecipeOp, ImporterView> {
  readonly viewType = IMPORTER_VIEW_TYPE;
  readonly bundle = 'importer';
  readonly title = 'CPCBuild Image Importer';

  /** Test hooks: answer the dialogs without showing them. */
  dialogOverride?: vscode.Uri;
  confirmOverride?: boolean;
  /** Test hook: the editor-specific requests the webviews made, in order (proves the render path ran). */
  readonly requestLog: string[] = [];
  /** The last generation per document (shown as a notice in the panel). */
  private readonly lastGen = new Map<string, GenerateOutcome>();

  /** Documents with a remembered generation outcome (the entry goes when its document is disposed). */
  get generatedCount(): number {
    return this.lastGen.size;
  }

  async openCustomDocument(uri: vscode.Uri, ctx: vscode.CustomDocumentOpenContext): Promise<StudioDocument<Recipe>> {
    const doc = await super.openCustomDocument(uri, ctx);
    const dispose = doc.dispose.bind(doc);
    doc.dispose = () => {
      this.lastGen.delete(uri.toString());
      dispose();
    };
    return doc;
  }

  parse(text: string): Recipe {
    return parseRecipe(text);
  }
  serialise(state: Recipe): string {
    return serialiseRecipe(state);
  }
  saveProblem(): string | undefined {
    return undefined;
  }
  apply(state: Recipe, op: RecipeOp) {
    return applyRecipeOp(state, op);
  }

  private rootOf(doc: StudioDocument<Recipe>): string {
    return viewRootOf(doc.uri.fsPath);
  }

  view(state: Recipe, doc: StudioDocument<Recipe>): Omit<ImporterView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    const root = this.rootOf(doc);
    const s = readSettings(root);
    const recipePath = toRel(root, doc.uri.fsPath);
    const cmd = commandLine(state);
    let sourceKey = `${state.source}:none`;
    let stale = false;
    let outputExists = false;
    if (state.source) {
      try {
        const st = fs.statSync(insideRoot(root, state.source));
        sourceKey = `${state.source}:${st.size}:${st.mtimeMs}`;
      } catch {
        sourceKey = `${state.source}:missing`;
      }
      try {
        outputExists = fs.existsSync(insideRoot(root, effectiveOutput(state)));
        stale = isStale(root, recipePath, state);
      } catch {
        // an unreadable tree is not worth a failed render
      }
    }
    return {
      recipe: state,
      recipePath,
      root,
      sourceKey,
      defaultName: defaultName(state.source || 'img'),
      defaultOutput: effectiveOutput({ ...state, output: undefined }),
      command: cmd.command,
      commandReason: cmd.reason,
      engine: s.assetsEngine,
      header: s.assetsHeader,
      outputs: outputsOf(state),
      outputExists,
      stale,
      generated: this.lastGen.get(doc.uri.toString()),
    };
  }

  protected async afterSave(doc: StudioDocument<Recipe>): Promise<void> {
    const root = projectRootOf(doc.uri.fsPath);
    if (!root || !isTrusted() || !readSettings(root).generateOnSave || !doc.state.source) return; // outside a project or in Restricted Mode: nothing is written
    const out = await this.run(doc);
    if (!out.ok) {
      getChannel().appendLine(`${toRel(root, doc.uri.fsPath)}: ${out.error}`);
      void vscode.window.showWarningMessage(`CPCBuild: could not generate ${effectiveOutput(doc.state)}: ${out.error}`);
    }
  }

  /** Generates the document's current state (saved or not) and remembers the outcome. */
  async run(doc: StudioDocument<Recipe>): Promise<GenerateOutcome> {
    const root = projectRootOf(doc.uri.fsPath);
    const blocked = !isTrusted() ? restrictedText('Generate') : !root ? `${path.basename(doc.uri.fsPath)} is ${NOT_IN_PROJECT}` : undefined;
    if (blocked || !root) {
      const out: GenerateOutcome = { ok: false, written: [], error: blocked, at: Date.now() };
      this.lastGen.set(doc.uri.toString(), out);
      this.broadcast(doc);
      return out;
    }
    const r = await generate(root, toRel(root, doc.uri.fsPath), doc.state, genSettings(root), { sink: channelSink });
    const out: GenerateOutcome = { ok: r.ok, written: r.written, error: r.error, at: Date.now() };
    this.lastGen.set(doc.uri.toString(), out);
    this.broadcast(doc);
    return out;
  }

  protected async handleRequest(doc: StudioDocument<Recipe>, name: string, args: unknown): Promise<unknown> {
    const root = this.rootOf(doc);
    const a = args as Record<string, unknown>;
    this.requestLog.push(name);
    switch (name) {
      case 'sourceImage':
        return this.sourceImage(doc, root);
      case 'preview':
        return this.preview(doc, root, (a.version as number) ?? doc.version);
      case 'generate':
        return this.run(doc);
      case 'pickSource':
        return this.pickSource(doc, root, a.baseVersion as number);
      case 'pickFile':
        return this.pickFile(doc, root, a.baseVersion as number, a.which as PickWhich);
      case 'importCommand':
        return this.importCommand(doc, a.baseVersion as number, String(a.line ?? ''));
      case 'copyCommand':
        return this.copyCommand(doc);
      case 'useEngine':
        return this.useEngine();
      case 'savePreprocessed':
        return this.savePreprocessed(doc, root);
      case 'openPalette': {
        const f = doc.state.palette?.file ?? doc.state.plus?.palette?.file;
        if (!f) return { ok: false };
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(insideRoot(root, f)));
        return { ok: true };
      }
      default:
        return super.handleRequest(doc, name, args);
    }
  }

  private checkBase(doc: StudioDocument<Recipe>, base: number): void {
    if (base !== doc.version) {
      this.broadcast(doc);
      throw new Error('the document changed in another view; try again');
    }
  }

  private sourceImage(doc: StudioDocument<Recipe>, root: string): SourceImage {
    const src = doc.state.source;
    if (!src) return { ok: false, error: '', empty: true };
    try {
      const abs = insideRoot(root, src);
      const bytes = fs.readFileSync(abs);
      const img = cachedDecode(abs, new Uint8Array(bytes));
      return { ok: true, width: img.width, height: img.height, format: path.extname(src).slice(1).toLowerCase(), rgba: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength).toString('base64') };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false, error: `${src}: the image was not found. Use Change... to pick it again.` };
      return { ok: false, error: e instanceof ImageReadError ? e.message : describeError(e) };
    }
  }

  private preview(doc: StudioDocument<Recipe>, root: string, version: number): PreviewResponse {
    if (!doc.state.source) return { ok: false, version, error: '', empty: true };
    try {
      const p = previewOf(doc.state, rootIo(root), { decode: decoderFor(root) });
      const truncated = p.text.length > MAX_TEXT;
      if (truncated) p.text = p.text.slice(0, MAX_TEXT);
      return { ok: true, version, preview: p, truncated };
    } catch (e) {
      return { ok: false, version, error: describeError(e) };
    }
  }

  private async pickSource(doc: StudioDocument<Recipe>, root: string, base: number): Promise<{ picked: boolean }> {
    this.checkBase(doc, base);
    const uri = this.dialogOverride ?? (await vscode.window.showOpenDialog({
      canSelectMany: false,
      defaultUri: vscode.Uri.file(doc.state.source ? path.dirname(path.resolve(root, doc.state.source)) : root),
      filters: { Images: IMAGE_EXTS },
      openLabel: 'Use image',
      title: 'Source image for this recipe',
    }))?.[0];
    if (!uri) return { picked: false };
    const rel = toRel(root, uri.fsPath);
    const patch: { [k: string]: unknown } = { source: rel };
    if (!doc.state.output) patch.output = defaultOutputFor(root, doc.uri.fsPath, rel);
    this.commit(doc, { op: 'set', patch, label: 'Change source image' });
    return { picked: true };
  }

  private async pickFile(doc: StudioDocument<Recipe>, root: string, base: number, which: PickWhich): Promise<{ picked: boolean }> {
    this.checkBase(doc, base);
    const dir = vscode.Uri.file(root);
    let uri = this.dialogOverride;
    if (!uri) {
      if (which === 'palette' || which === 'plusPalette') {
        uri = (await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: dir, filters: { Palette: ['cpcpal', 'cpcpal12', 'pal'] }, openLabel: 'Use palette' }))?.[0];
      } else {
        uri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(dir, which === 'output' ? effectiveOutput(doc.state) : doc.state.writePalette ?? 'palette.cpcpal'),
          filters: which === 'output' ? { Output: ['bas', 'asm', 'bin'] } : { Palette: ['cpcpal', 'pal'] },
        });
      }
    }
    if (!uri) return { picked: false };
    const rel = toRel(root, uri.fsPath);
    const r = doc.state;
    const patch: { [k: string]: unknown } =
      which === 'palette' ? { palette: { file: rel } }
        : which === 'plusPalette' ? { plus: { ...(r.plus ?? {}), palette: { file: rel } } }
          : which === 'writePalette' ? { writePalette: rel }
            : { output: rel };
    this.commit(doc, { op: 'set', patch, label: 'Change file' });
    return { picked: true };
  }

  private importCommand(doc: StudioDocument<Recipe>, base: number, line: string): { ok: boolean; unrecognised: string[]; error?: string } {
    this.checkBase(doc, base);
    try {
      const { recipe, unrecognised } = argvToRecipe(shellSplit(line.replace(/\\\r?\n/g, ' ')));
      if (!recipe.output && doc.state.output) recipe.output = doc.state.output;
      this.commit(doc, { op: 'replace', recipe, label: 'Import recipe from command line' });
      return { ok: true, unrecognised };
    } catch (e) {
      const m = e instanceof RecipeError ? e.message : describeError(e);
      return { ok: false, unrecognised: [], error: m };
    }
  }

  async copyCommand(doc: StudioDocument<Recipe>): Promise<{ copied: boolean; reason?: string }> {
    const c = commandLine(doc.state);
    if (!c.command) return { copied: false, reason: c.reason };
    await vscode.env.clipboard.writeText(c.command);
    return { copied: true };
  }

  private async useEngine(): Promise<{ changed: boolean }> {
    const ok = this.confirmOverride ?? (await vscode.window.showWarningMessage(
      'Use the Python engine for the image importer? It needs Python 3 with Pillow (python3 -m pip install Pillow) and the cpcbuild tools/ folder.',
      { modal: true },
      'Use the Python engine',
    )) === 'Use the Python engine';
    if (!ok) return { changed: false };
    await vscode.workspace.getConfiguration('cpcbuild').update('assets.engine', 'python', vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
    return { changed: true };
  }

  private async savePreprocessed(doc: StudioDocument<Recipe>, root: string): Promise<{ file?: string; error?: string }> {
    const r = doc.state;
    if (!r.grid || !r.source) return { error: 'There is no pre-processing to save.' };
    if (!projectRootOf(doc.uri.fsPath)) return { error: `${path.basename(doc.uri.fsPath)} is ${NOT_IN_PROJECT}` };
    try {
      const img = composeSheet(decodeImage(rootIo(root).readFile(r.source)), r.grid);
      const stem = path.basename(doc.uri.fsPath).replace(/\.cpcimp$/i, '');
      const out = path.join(path.dirname(doc.uri.fsPath), `${stem}.sheet.png`);
      fs.writeFileSync(out, encodePng(img));
      return { file: toRel(root, out) };
    } catch (e) {
      return { error: describeError(e) };
    }
  }
}

/** assets/<stem>.bas beside the recipe. */
function defaultOutputFor(root: string, recipeFile: string, sourceRel: string): string {
  const stem = path.basename(sourceRel).replace(/\.[^.]*$/, '');
  return toRel(root, path.join(path.dirname(recipeFile), `${stem}.bas`));
}

// ------------------------------------------------------------------ commands

/**
 * CPCBuild: Import Image. Writes assets/<stem>.cpcimp (beside the image when it already sits in a
 * folder called assets) with defaults and opens it; an existing recipe is opened, never overwritten.
 */
export async function importImageCommand(arg?: vscode.Uri | { uri?: vscode.Uri; open?: boolean }): Promise<vscode.Uri | undefined> {
  const opts = arg instanceof vscode.Uri ? { uri: arg } : (arg ?? {});
  let image = opts.uri;
  if (!image) {
    image = (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: IMAGE_EXTS }, openLabel: 'Import', title: 'Import an image as a CPC asset' }))?.[0];
    if (!image) return undefined;
  }
  const ext = path.extname(image.fsPath).slice(1).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) {
    void vscode.window.showErrorMessage(`CPCBuild: ${path.basename(image.fsPath)} is not a PNG, GIF or BMP image.`);
    return undefined;
  }
  const root = requireProjectRoot(image.fsPath);
  if (!root) return undefined;
  const src = toRel(root, image.fsPath);
  const stem = path.basename(image.fsPath).replace(/\.[^.]*$/, '');
  const inAssets = path.dirname(src).split('/').includes('assets');
  const dir = inAssets ? path.dirname(image.fsPath) : path.join(root, 'assets');
  const file = path.join(dir, `${stem}.cpcimp`);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, serialiseRecipe(newRecipe(src, { output: defaultOutputFor(root, file, src) })));
  }
  const uri = vscode.Uri.file(file);
  if (opts.open !== false) await vscode.commands.executeCommand('vscode.openWith', uri, IMPORTER_VIEW_TYPE);
  return uri;
}

/** CPCBuild: Regenerate Assets: every recipe the project's assets globs match, with the selected engine. */
export async function regenerateAssetsCommand(args?: { root?: string }): Promise<GenResult[] | undefined> {
  if (!requireTrust('Regenerate Assets')) return undefined;
  let root = args?.root;
  let globs: string[] = [];
  if (root) {
    const lp = loadProjectFile(path.join(root, PROJECT_FILE));
    globs = lp.project?.assets ?? [];
  } else {
    const lp = pickProject(await findProjects());
    if (!lp?.project) {
      void vscode.window.showInformationMessage('CPCBuild: no valid cpcbuild.json in this workspace.');
      return undefined;
    }
    root = lp.root;
    globs = lp.project.assets;
  }
  const sink = tee(channelSink);
  getChannel().show(true);
  const s = readSettings(root);
  sink.line(`--- regenerate assets (${s.assetsEngine} engine) in ${root} ---`);
  const results = await regenerateAll(root, globs, genSettings(root, s), { sink });
  const bad = results.filter((r) => !r.ok);
  if (!results.length) void vscode.window.showInformationMessage('CPCBuild: no .cpcimp recipes match the "assets" globs of cpcbuild.json.');
  else if (bad.length) void vscode.window.showErrorMessage(`CPCBuild: ${bad.length} of ${results.length} asset recipes failed: ${bad[0].error}`);
  else void vscode.window.showInformationMessage(`CPCBuild: regenerated ${results.length} asset recipe${results.length === 1 ? '' : 's'}.`);
  return results;
}

/** CPCBuild: Copy Importer Command, for the importer editor that is active. */
export async function copyImporterCommandCommand(provider: ImporterEditorProvider): Promise<boolean> {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const uri = input instanceof vscode.TabInputCustom && input.viewType === IMPORTER_VIEW_TYPE ? input.uri : undefined;
  const doc = uri && provider.documents.get(uri.toString());
  if (!doc) {
    void vscode.window.showInformationMessage('CPCBuild: open a .cpcimp recipe (the image importer) first.');
    return false;
  }
  const r = await provider.copyCommand(doc);
  if (!r.copied) void vscode.window.showInformationMessage(`CPCBuild: ${r.reason ?? 'there is no command to copy.'}`);
  else void vscode.window.setStatusBarMessage('CPCBuild: command copied', 2500);
  return r.copied;
}

