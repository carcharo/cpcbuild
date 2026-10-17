/**
 * spriteEditor.ts -- the sprite and tile editor (.cpcspr, .cpctil) as custom editors. The document model
 * and every rule are in src/core/spriteDoc.ts, the export in src/core/spriteExport.ts; this file is the
 * glue: the view the webview draws, the shared palette file (read, watched, live), generate (command,
 * button, on save), PNG in / out, "insert asset use", and the "new ..." commands.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { decodePng, encodePng } from '../core/image';
import { MAXPENS, type Mode } from '../core/pixels';
import {
  analyse, applySpriteOp, newSprite, nameFromStem, parseSprite, resolvePalette, rowsOf, serialiseSprite,
  type DocType, type ResolvedPalette, type SpriteOp, type SpriteState,
} from '../core/spriteDoc';
import { assetSnippets, equivalentCommand, exportAsset, gridFromImage, renderSheet, type HeaderStyle } from '../core/spriteExport';
import type { SpriteRequests, SpriteView, GenerateResult } from '../shared/spriteProtocol';
import { insideRootFrom } from '../core/paths';
import { getChannel } from './channel';
import { StudioDocument, StudioEditorProvider } from './customEditor';
import { NOT_IN_PROJECT, projectRootOf, viewRootOf } from './importer';
import { isTrusted, restrictedText } from './trust';

export const SPRITE_VIEW_TYPE = 'cpcbuild.spriteEditor';
export const TILE_VIEW_TYPE = 'cpcbuild.tileEditor';
const PALETTE_VIEW_TYPE = 'cpcbuild.paletteEditor';

type Doc = StudioDocument<SpriteState>;

/** Per-document state that lives beside the document model: the palette file and the output file as read from disk. */
interface Aux {
  palPath?: string;
  palText?: string;
  palLoaded: boolean;
  outPath?: string;
  /** undefined = not read yet, null = no such file. */
  outText?: string | null;
  generated?: { seq: number; ok: boolean; message: string };
  seq: number;
  watchers: Map<string, vscode.Disposable>;
}

const dirOf = (uri: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(uri, '..');
const stemOf = (uri: vscode.Uri): string => path.posix.basename(uri.path).replace(/\.[^.]*$/, '');

/**
 * A path as written in a document (posix, relative to the document). It must stay inside the project
 * folder (the nearest cpcbuild.json above, else the document's own folder): absolute paths, `..` out and
 * symlinks that leave throw PathEscapeError, whose message is the document problem to show.
 */
export function resolveRel(doc: vscode.Uri, rel: string): vscode.Uri {
  if (doc.scheme !== 'file') return vscode.Uri.joinPath(dirOf(doc), ...rel.split(/[\\/]/));
  return vscode.Uri.file(insideRootFrom(viewRootOf(doc.fsPath), path.dirname(doc.fsPath), rel));
}

/** resolveRel for reads: undefined when the path leaves the project (the file then reads as missing). */
export function resolveRelSafe(doc: vscode.Uri, rel: string): vscode.Uri | undefined {
  try {
    return resolveRel(doc, rel);
  } catch {
    return undefined;
  }
}

export class SpriteEditorProvider extends StudioEditorProvider<SpriteState, SpriteOp, SpriteView> {
  readonly viewType: string;
  readonly bundle = 'sprite';
  readonly title: string;

  /** Test hooks: answer the file dialogs without showing them. */
  pngOverride?: vscode.Uri;
  paletteOverride?: vscode.Uri;
  savePngOverride?: vscode.Uri;

  private readonly aux = new WeakMap<Doc, Aux>();

  constructor(context: vscode.ExtensionContext, readonly docType: DocType) {
    super(context);
    this.viewType = docType === 'spr' ? SPRITE_VIEW_TYPE : TILE_VIEW_TYPE;
    this.title = docType === 'spr' ? 'CPCBuild Sprite Editor' : 'CPCBuild Tile Editor';
  }

  // ---------------------------------------------------------- the codec

  parse(text: string, uri: vscode.Uri): SpriteState {
    return parseSprite(text, this.docType, stemOf(uri));
  }
  serialise(state: SpriteState): string {
    return serialiseSprite(state);
  }
  saveProblem(): string | undefined {
    return undefined; // a document with export problems still saves; generating is what refuses
  }
  apply(state: SpriteState, op: SpriteOp) {
    return applySpriteOp(state, op);
  }

  // ------------------------------------------------------- per-doc state

  private auxOf(doc: Doc): Aux {
    let a = this.aux.get(doc);
    if (!a) {
      a = { palLoaded: false, seq: 0, watchers: new Map() };
      this.aux.set(doc, a);
      const orig = doc.dispose.bind(doc);
      const aux = a;
      doc.dispose = () => {
        for (const w of aux.watchers.values()) w.dispose();
        aux.watchers.clear();
        orig();
      };
    }
    return a;
  }

  private watch(doc: Doc, uri: vscode.Uri, onChange: () => void): void {
    const a = this.auxOf(doc);
    const key = uri.toString();
    if (a.watchers.has(key)) return;
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dirOf(uri), path.posix.basename(uri.path)));
    const sub = vscode.Disposable.from(w, w.onDidChange(onChange), w.onDidCreate(onChange), w.onDidDelete(onChange));
    a.watchers.set(key, sub);
  }

  private async readText(uri: vscode.Uri): Promise<string | undefined> {
    try {
      return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch {
      return undefined;
    }
  }

  /** Starts (re)loading the palette file when the document points at a different one than the cache holds. */
  private syncPalette(doc: Doc, a: Aux): void {
    const want = 'file' in doc.state.palette ? doc.state.palette.file : undefined;
    if (want === a.palPath) return;
    a.palPath = want;
    a.palText = undefined;
    a.palLoaded = want === undefined;
    if (want !== undefined) void this.loadPalette(doc, a, want);
  }

  private async loadPalette(doc: Doc, a: Aux, rel: string): Promise<void> {
    const uri = resolveRelSafe(doc.uri, rel);
    if (uri) this.watch(doc, uri, () => void this.loadPalette(doc, a, rel));
    const text = uri ? await this.readText(uri) : undefined;
    if (a.palPath !== rel) return; // the document moved on
    a.palText = text;
    a.palLoaded = true;
    this.broadcast(doc);
  }

  /** Resolved palette now (palette file contents from the cache). Undefined fields while a file is loading. */
  private palette(doc: Doc, a: Aux): ResolvedPalette & { loading?: boolean } {
    if (!('file' in doc.state.palette)) return resolvePalette(doc.state);
    if (!a.palLoaded) return { loading: true };
    return resolvePalette(doc.state, a.palText);
  }

  private headerStyle(doc: Doc): HeaderStyle {
    const h = vscode.workspace.getConfiguration('cpcbuild.assets', doc.uri).get<string>('header', 'img2cpc');
    return h === 'studio' || h === 'none' ? h : 'img2cpc';
  }

  private syncOutput(doc: Doc, a: Aux): void {
    const rel = doc.state.output;
    if (a.outPath === rel) return;
    a.outPath = rel;
    a.outText = undefined;
    void this.loadOutput(doc, a, rel);
  }

  private async loadOutput(doc: Doc, a: Aux, rel: string): Promise<void> {
    const uri = resolveRelSafe(doc.uri, rel);
    if (uri) this.watch(doc, uri, () => void this.loadOutput(doc, a, rel));
    const text = uri ? await this.readText(uri) : undefined;
    if (a.outPath !== rel) return;
    a.outText = text ?? null;
    this.broadcast(doc);
  }

  // ------------------------------------------------------------- the view

  view(s: SpriteState, doc: Doc): Omit<SpriteView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    const a = this.auxOf(doc);
    this.syncPalette(doc, a);
    this.syncOutput(doc, a);
    const pal = this.palette(doc, a);
    const analysis = analyse(s, pal);
    const source = path.posix.basename(doc.uri.path);
    let exportProblem: string | undefined;
    let outputState: SpriteView['outputState'] = 'unknown';
    let text: string | undefined;
    if (!pal.loading) {
      try {
        const ex = exportAsset(s, { source, header: this.headerStyle(doc), palette: pal });
        text = ex.text;
      } catch (e) {
        exportProblem = (e as Error).message;
      }
    }
    if (text !== undefined && a.outText !== undefined && !(s.kind === 'plus' && s.plusFormat === 'bin')) {
      outputState = a.outText === null ? 'missing' : a.outText === text ? 'current' : 'stale';
    }
    const rel = this.includePath(s);
    return {
      docType: s.type,
      kind: s.kind,
      mode: s.mode,
      name: s.name,
      w: s.w,
      h: s.h,
      masked: s.masked,
      items: s.items.map((g) => rowsOf(g, s.kind === 'plus')),
      pens: pal.pens,
      colours: pal.colours,
      paletteFile: 'file' in s.palette ? s.palette.file : undefined,
      paletteProblem: pal.problem,
      output: s.output,
      emitPalette: s.emitPalette,
      dedupe: s.dedupe,
      packed: s.packed,
      plusFormat: s.plusFormat,
      analysis,
      exportProblem,
      outputState,
      generated: a.generated,
      generateOnSave: vscode.workspace.getConfiguration('cpcbuild.assets', doc.uri).get<boolean>('generateOnSave', true),
      limit: 65535,
      snippets: assetSnippets(s, rel, text),
      command: equivalentCommand(s, source, pal.loading ? undefined : pal),
    };
  }

  private includePath(s: SpriteState): string {
    return s.output.replace(/\\/g, '/');
  }

  // ------------------------------------------------------ generate / save

  /** Writes the generated file (and the .pal beside a Plus .bin). Throws with the exporter's message. */
  async generateDoc(doc: Doc): Promise<GenerateResult> {
    if (!isTrusted()) throw new Error(restrictedText('Generate'));
    if (!projectRootOf(doc.uri.fsPath)) throw new Error(`${path.basename(doc.uri.fsPath)} is ${NOT_IN_PROJECT}`);
    const a = this.auxOf(doc);
    this.syncPalette(doc, a);
    // a palette file may still be loading: wait for it
    for (let i = 0; i < 50 && !a.palLoaded; i++) await new Promise((r) => setTimeout(r, 20));
    const s = doc.state;
    const pal = this.palette(doc, a);
    if (pal.loading) throw new Error('the palette file is still loading; try again');
    const ex = exportAsset(s, { source: path.posix.basename(doc.uri.path), header: this.headerStyle(doc), palette: pal });
    const out = resolveRel(doc.uri, s.output); // throws if the output leaves the project
    await vscode.workspace.fs.createDirectory(dirOf(out));
    const written: string[] = [];
    if (ex.bin) {
      await vscode.workspace.fs.writeFile(out, ex.bin);
      written.push(out.fsPath);
      if (ex.palBin) {
        const pal = vscode.Uri.file(out.fsPath.replace(/\.[^./\\]*$/, '') + '.pal');
        await vscode.workspace.fs.writeFile(pal, ex.palBin);
        written.push(pal.fsPath);
      }
    } else {
      await vscode.workspace.fs.writeFile(out, Buffer.from(ex.text, 'utf8'));
      written.push(out.fsPath);
      a.outPath = s.output;
      a.outText = ex.text;
    }
    return { ok: true, message: `Wrote ${s.output}${written.length > 1 ? ' and ' + path.basename(written[1]) : ''}`, written };
  }

  /** Generate with the result recorded for the view (never throws). */
  async generateAndReport(doc: Doc): Promise<GenerateResult> {
    const a = this.auxOf(doc);
    let r: GenerateResult;
    try {
      r = await this.generateDoc(doc);
    } catch (e) {
      r = { ok: false, message: (e as Error).message, written: [] };
    }
    a.generated = { seq: ++a.seq, ok: r.ok, message: r.message };
    getChannel().appendLine(`${this.title}: ${doc.uri.fsPath}: ${r.ok ? r.message : 'generate failed: ' + r.message}`);
    this.broadcast(doc);
    return r;
  }

  protected async afterSave(doc: Doc): Promise<void> {
    // generate-on-save writes files and may read a palette: only in a trusted workspace and a CPCBuild project
    if (!isTrusted() || !projectRootOf(doc.uri.fsPath)) return this.broadcast(doc);
    if (vscode.workspace.getConfiguration('cpcbuild.assets', doc.uri).get<boolean>('generateOnSave', true)) await this.generateAndReport(doc);
    else this.broadcast(doc);
  }

  // ------------------------------------------------------------ requests

  private guard(doc: Doc, baseVersion: number): void {
    if (baseVersion !== doc.version) {
      this.broadcast(doc);
      throw new Error('the document changed in another view; try again');
    }
  }

  protected async handleRequest(doc: Doc, name: string, args: unknown): Promise<unknown> {
    switch (name) {
      case 'generate':
        return this.generateAndReport(doc);
      case 'setPaletteFile':
        return this.setPaletteFile(doc, args as SpriteRequests['setPaletteFile']['args']);
      case 'inlinePalette':
        return this.inlinePalette(doc, args as SpriteRequests['inlinePalette']['args']);
      case 'openPalette': {
        const p = doc.state.palette;
        const pu = 'file' in p ? resolveRelSafe(doc.uri, p.file) : undefined;
        if (pu) await vscode.commands.executeCommand('vscode.openWith', pu, PALETTE_VIEW_TYPE);
        return { ok: true };
      }
      case 'importPng':
        return this.importPng(doc, args as SpriteRequests['importPng']['args']);
      case 'exportPng':
        return this.exportPng(doc);
      default:
        return super.handleRequest(doc, name, args);
    }
  }

  /** Other documents (in the workspace) that use the palette file `target`: 4.3, the second and later default to not emitting it. */
  private async otherUsers(doc: Doc, target: vscode.Uri): Promise<number> {
    let n = 0;
    const files = await vscode.workspace.findFiles('**/*.{cpcspr,cpctil}', '**/node_modules/**', 200);
    for (const f of files) {
      if (f.toString() === doc.uri.toString()) continue;
      const text = await this.readText(f);
      if (!text) continue;
      try {
        const file = (JSON.parse(text) as { palette?: { file?: unknown } }).palette?.file;
        if (typeof file === 'string' && resolveRelSafe(f, file)?.toString() === target.toString()) n++;
      } catch {
        // not ours to judge
      }
    }
    return n;
  }

  private async setPaletteFile(doc: Doc, a: SpriteRequests['setPaletteFile']['args']): Promise<SpriteRequests['setPaletteFile']['result']> {
    this.guard(doc, a.baseVersion);
    const s = doc.state;
    let rel = a.file;
    if (!rel) {
      const picked =
        this.paletteOverride ??
        (await vscode.window.showOpenDialog({
          canSelectMany: false,
          defaultUri: dirOf(doc.uri),
          filters: s.kind === 'plus' ? { Palette: ['cpcpal12'] } : { Palette: ['cpcpal'] },
          openLabel: 'Use palette',
          title: 'Share a palette file',
        }))?.[0];
      if (!picked) return { used: false };
      rel = path.relative(dirOf(doc.uri).fsPath, picked.fsPath).split(path.sep).join('/');
    }
    const palUri = resolveRel(doc.uri, rel); // a path outside the project throws with its reason
    const text = await this.readText(palUri);
    if (text === undefined) throw new Error(`${rel} could not be read`);
    const r = resolvePalette({ kind: s.kind, palette: { file: rel } }, text);
    if (r.problem) throw new Error(r.problem);
    if (s.kind === 'cpc' && r.pens && r.pens.length > MAXPENS[s.mode]) throw new Error(`palette has ${r.pens.length} pens, mode ${s.mode} has ${MAXPENS[s.mode]}`);
    const others = await this.otherUsers(doc, palUri);
    const emit = others > 0 ? false : undefined;
    this.commit(doc, { op: 'setPaletteFile', file: rel, emitPalette: emit });
    return {
      used: true,
      file: rel,
      message: others > 0 ? `${others} other document${others === 1 ? ' uses' : 's use'} ${path.posix.basename(rel)}: "Emit palette" is off here (the first one emits it).` : undefined,
    };
  }

  private async inlinePalette(doc: Doc, a: SpriteRequests['inlinePalette']['args']): Promise<{ ok: true }> {
    this.guard(doc, a.baseVersion);
    const aux = this.auxOf(doc);
    const r = this.palette(doc, aux);
    if (r.problem || r.loading) throw new Error(r.problem ?? 'the palette file is still loading');
    if (doc.state.kind === 'plus') this.commit(doc, { op: 'setColours', colours: r.colours ?? [] });
    else this.commit(doc, { op: 'setPens', pens: r.pens ?? [] });
    return { ok: true };
  }

  private async importPng(doc: Doc, a: SpriteRequests['importPng']['args']): Promise<SpriteRequests['importPng']['result']> {
    this.guard(doc, a.baseVersion);
    const picked =
      this.pngOverride ??
      (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['png'] }, openLabel: 'Take image', title: 'Take a PNG into this frame (quantised with the document palette)' }))?.[0];
    if (!picked) return { taken: false };
    const img = decodePng(await vscode.workspace.fs.readFile(picked));
    const s = doc.state;
    const rows = gridFromImage(s, img, this.palette(doc, this.auxOf(doc)));
    this.commit(doc, { op: 'setItem', item: a.item, rows, label: 'Take image' });
    const fits = img.width === s.w && img.height === s.h;
    return { taken: true, message: fits ? undefined : `${path.basename(picked.fsPath)} is ${img.width}x${img.height}; the ${s.type === 'til' ? 'tile' : 'frame'} is ${s.w}x${s.h}, so it was ${img.width > s.w || img.height > s.h ? 'cropped' : 'padded'}.` };
  }

  private async exportPng(doc: Doc): Promise<SpriteRequests['exportPng']['result']> {
    const target =
      this.savePngOverride ??
      (await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.joinPath(dirOf(doc.uri), `${doc.state.name}.png`), filters: { PNG: ['png'] }, title: 'Export the sheet as PNG' }));
    if (!target) return { saved: false };
    await vscode.workspace.fs.writeFile(target, encodePng(renderSheet(doc.state, this.palette(doc, this.auxOf(doc)))));
    return { saved: true, file: target.fsPath };
  }
}

// -------------------------------------------------------------- commands

export interface SpriteEditors {
  sprite: SpriteEditorProvider;
  tile: SpriteEditorProvider;
}

/** The document of a Studio sprite / tile editor for a file (open in a tab), if any. */
export function docFor(ed: SpriteEditors, uri: vscode.Uri): { provider: SpriteEditorProvider; doc: Doc } | undefined {
  for (const provider of [ed.sprite, ed.tile]) {
    const doc = provider.documents.get(uri.toString());
    if (doc) return { provider, doc };
  }
  return undefined;
}

const SPRITE_FILE = /\.(cpcspr|cpctil)$/i;

/** The sprite / tile file shown by the active tab, or the given one. */
export function activeAssetUri(uri?: vscode.Uri): vscode.Uri | undefined {
  if (uri && SPRITE_FILE.test(uri.path)) return uri;
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const u = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
  return u && SPRITE_FILE.test(u.path) ? u : undefined;
}

/** Generates the .bas of a sprite / tile file (open in an editor, or read from disk). Returns undefined for other files. */
export async function generateAssetFile(ed: SpriteEditors, uri?: vscode.Uri): Promise<GenerateResult | undefined> {
  const target = activeAssetUri(uri);
  if (!target) return undefined;
  let open = docFor(ed, target);
  if (!open) {
    // not open: parse from disk and generate through a throw-away document
    const provider = /\.cpcspr$/i.test(target.path) ? ed.sprite : ed.tile;
    const doc = await provider.openCustomDocument(target, { backupId: undefined, untitledDocumentData: undefined });
    try {
      return await provider.generateAndReport(doc);
    } finally {
      doc.dispose();
    }
  }
  return open.provider.generateAndReport(open.doc);
}

/** CPCBuild: Insert Asset Use -- writes the include and call lines for the open document into the code editor. */
export async function insertAssetUse(ed: SpriteEditors, uri?: vscode.Uri): Promise<string | undefined> {
  const target = activeAssetUri(uri);
  if (!target) {
    void vscode.window.showInformationMessage('CPCBuild: open a sprite or tile set (.cpcspr, .cpctil) first.');
    return undefined;
  }
  const open = docFor(ed, target);
  const provider = open?.provider ?? (/\.cpcspr$/i.test(target.path) ? ed.sprite : ed.tile);
  const text = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
  const state = open?.doc.state ?? provider.parse(text, target);
  const code = vscode.window.visibleTextEditors.find((e) => /\.(bas|zxb|zxbas)$/i.test(e.document.fileName)) ?? vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'file' && !SPRITE_FILE.test(e.document.fileName));
  const outAbs = (resolveRelSafe(target, state.output) ?? vscode.Uri.joinPath(dirOf(target), 'invalid-output-path')).fsPath;
  const rel = code ? path.relative(path.dirname(code.document.uri.fsPath), outAbs).split(path.sep).join('/') : state.output;
  const snips = assetSnippets(state, rel);
  const insert = snips.map((x) => x.text).join('');
  if (code) {
    await code.edit((b) => b.insert(code.selection.active, insert));
    return insert;
  }
  await vscode.env.clipboard.writeText(insert);
  void vscode.window.showInformationMessage('CPCBuild: no code editor is open, so the include and call lines were copied to the clipboard.');
  return insert;
}

export interface NewAssetArgs {
  uri?: vscode.Uri;
  mode?: Mode;
  masked?: boolean;
  w?: number;
  h?: number;
}

/** CPCBuild: New Sprite / New Tileset / New Plus Sprite. `args` lets tests and other commands skip the prompts. */
export async function newAssetCommand(what: 'sprite' | 'tileset' | 'plus', args: NewAssetArgs = {}): Promise<vscode.Uri | undefined> {
  const type: DocType = what === 'tileset' ? 'til' : 'spr';
  let mode = args.mode;
  if (what !== 'plus' && mode === undefined && !args.uri) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Mode 0', description: '160 x 200, 16 pens, 2 pixels per byte', mode: 0 as Mode },
        { label: 'Mode 1', description: '320 x 200, 4 pens, 4 pixels per byte', mode: 1 as Mode },
        { label: 'Mode 2', description: '640 x 200, 2 pens, 8 pixels per byte', mode: 2 as Mode },
      ],
      { title: what === 'tileset' ? 'CPCBuild: new tile set, screen mode' : 'CPCBuild: new sprite, screen mode' },
    );
    if (!pick) return undefined;
    mode = pick.mode;
  }
  const ext = type === 'til' ? 'cpctil' : 'cpcspr';
  let uri = args.uri;
  if (!uri) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const base = what === 'tileset' ? 'tiles' : what === 'plus' ? 'plussprite' : 'sprite';
    uri = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, `${base}.${ext}`) : undefined,
      filters: { [type === 'til' ? 'Tile set' : 'Sprite']: [ext] },
      title: what === 'tileset' ? 'New tile set' : what === 'plus' ? 'New Plus sprite' : 'New sprite',
    });
    if (!uri) return undefined;
  }
  const name = nameFromStem(stemOf(uri));
  const state = newSprite(type, { name, kind: what === 'plus' ? 'plus' : 'cpc', mode: mode ?? (type === 'til' ? 0 : 1), masked: args.masked, w: args.w, h: args.h });
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serialiseSprite(state), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, type === 'til' ? TILE_VIEW_TYPE : SPRITE_VIEW_TYPE);
  return uri;
}
