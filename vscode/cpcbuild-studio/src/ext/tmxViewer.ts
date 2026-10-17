/**
 * tmxViewer.ts -- the Tiled .tmx viewer (spec 5.1): a read-only custom editor (priority "option":
 * "Open With... CPCBuild Map Viewer"), the convert command (tmx2bas) and "Open in Tiled".
 * Tiled stays the editor; this only shows the map, lets you pick tiles and writes the .bas.
 *
 * The map model and the rendering are in src/core/tmx.ts and tmxView.ts; the host reads the tileset
 * images (it alone has file access) and sends the webview tile atlases it can draw with.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { decodeImage } from '../core/imageio';
import { newRecipe, previewOf } from '../core/cpcimp';
import { FW_TABLE, parseRgb12List } from '../core/palette';
import { parseSprite, resolvePalette } from '../core/spriteDoc';
import { defaultMapName, parseTmx, parseTsx, TmxError, TmxMap, TmxTileset } from '../core/tmx';
import { Atlas, atlasFromImage, atlasFromPens, effectiveFirstgid, tileMapCall } from '../core/tmxView';
import type { EditorSettings, HostToWeb } from '../shared/protocol';
import type { AtlasResult, ConvertOptions, ConvertResult, TmxViewerView, ViewNotice, ViewTileset, WireAtlas } from '../shared/tmxProtocol';
import { cachedDecode, decoderFor, rootIo } from './assetsGen';
import { channelSink, getChannel } from './channel';
import { readSettings, resolveLibrary } from './config';
import { projectRootOf } from './importer';
import { launchDetached } from './runTool';
import { generateTmx } from './tmxGen';
import { webviewHtml, webviewRoot } from './webviewHtml';

export const TMX_VIEW_TYPE = 'cpcbuild.tmxViewer';

const posix = (p: string): string => p.split(path.sep).join('/');

// ------------------------------------------------------------------- Tiled

const TILED_CANDIDATES = ['/Applications/Tiled.app', '/usr/bin/tiled', '/usr/local/bin/tiled', '/opt/homebrew/bin/tiled'];

/** The Tiled application: the setting, else the usual places. */
export function findTiled(setting: string): string | undefined {
  if (setting.trim()) return fs.existsSync(setting.trim()) ? setting.trim() : undefined;
  return TILED_CANDIDATES.find((p) => fs.existsSync(p));
}

/** How to start `app` on `file` (an .app bundle goes through `open -a` on macOS). */
export function tiledCommand(app: string, file: string): { command: string[]; args: string[] } {
  if (process.platform === 'darwin' && app.endsWith('.app')) return { command: ['open'], args: ['-a', app, file] };
  return { command: [app], args: [file] };
}

export async function openInTiled(file: string, override?: string): Promise<{ ok: boolean; error?: string; command?: string[] }> {
  const app = override ?? findTiled(readSettings(path.dirname(file)).tiledPath);
  if (!app) return { ok: false, error: 'Tiled was not found. Install it (mapeditor.org) or set "cpcbuild.tiled.path".' };
  const c = tiledCommand(app, file);
  const r = await launchDetached(c.command, c.args, { sink: channelSink });
  return r.ok ? { ok: true, command: [...c.command, ...c.args] } : { ok: false, error: `could not start Tiled: ${r.error}` };
}

// ---------------------------------------------------------------- document

export class TmxDocument implements vscode.CustomDocument {
  version = 0;
  text = '';
  fatal?: string;
  view?: Omit<TmxViewerView, 'version' | 'canUndo' | 'canRedo' | 'fileName'>;
  map?: TmxMap;
  /** Tileset geometry (after merging external .tsx files), parallel to map.tilesets. */
  tilesets: TmxTileset[] = [];
  readonly panels = new Set<vscode.WebviewPanel>();
  readyCount = 0;
  readonly webviewErrors: string[] = [];
  /** Test hook: the requests the webviews made, in order. */
  readonly requestLog: string[] = [];
  readonly atlasCache = new Map<string, AtlasResult>();
  watcher?: vscode.FileSystemWatcher;

  constructor(
    readonly uri: vscode.Uri,
    private readonly onDispose: () => void,
  ) {}

  dispose(): void {
    this.watcher?.dispose();
    this.onDispose();
  }
}

const b64 = (u: Uint8Array): string => Buffer.from(u.buffer, u.byteOffset, u.byteLength).toString('base64');
const wire = (a: Atlas): WireAtlas => ({ firstgid: a.firstgid, tw: a.tw, th: a.th, count: a.count, columns: a.columns, width: a.width, height: a.height, rgba: b64(a.rgba) });

/** Reads the external tilesets and resolves the image paths. */
function resolveTilesets(map: TmxMap, tmxFile: string): { tilesets: TmxTileset[]; view: ViewTileset[]; notices: ViewNotice[] } {
  const notices: ViewNotice[] = [];
  const dir = path.dirname(tmxFile);
  const tilesets: TmxTileset[] = [];
  const view: ViewTileset[] = [];
  for (const t0 of map.tilesets) {
    let t = t0;
    let imgBase = dir;
    if (t0.source) {
      const tsx = path.resolve(dir, t0.source);
      imgBase = path.dirname(tsx);
      try {
        t = { ...t0, ...Object.fromEntries(Object.entries(parseTsx(fs.readFileSync(tsx, 'utf8'))).filter(([, v]) => v !== undefined)) };
      } catch (e) {
        notices.push({ severity: 'info', text: `Tileset ${t0.source} could not be read (${e instanceof Error ? e.message : String(e)}): showing numbers.` });
      }
    }
    tilesets.push(t);
    const imagePath = t.image ? path.resolve(imgBase, t.image.source) : undefined;
    let imageStatus: ViewTileset['imageStatus'] = 'none';
    if (imagePath) imageStatus = fs.existsSync(imagePath) ? 'ok' : 'missing';
    if (imageStatus === 'missing') notices.push({ severity: 'info', text: `Tileset image not found: ${t.image?.source}. Showing numbers.` });
    view.push({
      firstgid: t.firstgid,
      name: t.name ?? path.basename(t.source ?? '') ?? '',
      source: t.source,
      tilewidth: t.tilewidth ?? map.tilewidth,
      tileheight: t.tileheight ?? map.tileheight,
      columns: t.columns,
      tilecount: t.tilecount,
      imagePath,
      imageStatus,
    });
  }
  return { tilesets, view, notices };
}

/** A .cpctil next to the map or the tileset image whose name matches the tileset image, tileset or map. */
function findCpctil(tmxFile: string, tilesets: readonly ViewTileset[]): string | undefined {
  const dirs = new Set<string>([path.dirname(tmxFile)]);
  const stems = new Set<string>([path.basename(tmxFile, path.extname(tmxFile))]);
  for (const t of tilesets) {
    if (t.imagePath) {
      dirs.add(path.dirname(t.imagePath));
      stems.add(path.basename(t.imagePath, path.extname(t.imagePath)));
    }
    if (t.name) stems.add(t.name);
  }
  for (const s of [...stems].reverse()) for (const d of dirs) {
    const f = path.join(d, `${s}.cpctil`);
    if (fs.existsSync(f)) return f;
  }
  return undefined;
}

export function buildView(doc: TmxDocument, text: string): void {
  doc.fatal = undefined;
  doc.view = undefined;
  doc.map = undefined;
  doc.atlasCache.clear();
  const file = doc.uri.fsPath;
  let map: TmxMap;
  try {
    map = parseTmx(text);
  } catch (e) {
    doc.fatal = `tmx2bas: ${path.basename(file)}: ${e instanceof Error ? e.message : String(e)}`;
    return;
  }
  const layerProblems = map.layers.filter((l) => l.error);
  if (!map.layers.length || layerProblems.length === map.layers.length) {
    doc.fatal = `tmx2bas: ${path.basename(file)}: ${map.layers.length ? layerProblems[0].error : 'no tile layers in the map'}`;
    return;
  }
  const root = projectRootOf(file);
  const { tilesets, view, notices } = resolveTilesets(map, file);
  if (map.infinite) notices.push({ severity: 'warning', text: 'Infinite maps are not supported by tmx2bas.py.' });
  for (const l of layerProblems) notices.push({ severity: 'warning', text: `Layer '${l.name}': ${l.error}` });
  doc.map = map;
  doc.tilesets = tilesets;
  const cpctil = findCpctil(file, view);
  let tiles = 0;
  if (cpctil) {
    try {
      tiles = parseSprite(fs.readFileSync(cpctil, 'utf8'), 'til').items.length;
    } catch {
      /* an unreadable .cpctil is just not offered */
    }
  }
  const rel = posix(path.relative(root, file));
  doc.view = {
    path: rel.startsWith('..') ? path.basename(file) : rel,
    map: { width: map.width, height: map.height, tilewidth: map.tilewidth, tileheight: map.tileheight, infinite: map.infinite },
    layers: map.layers,
    tilesets: view,
    objectGroups: map.objectGroups,
    notices,
    tiled: findTiled(readSettings(root).tiledPath),
    cpctil: cpctil && tiles ? { file: posix(path.relative(root, cpctil)), tiles } : undefined,
    convert: { name: defaultMapName(file), output: posix(path.relative(root, file.replace(/\.tmx$/i, '.bas'))) },
  };
}

// ---------------------------------------------------------------- provider

export class TmxViewerProvider implements vscode.CustomReadonlyEditorProvider<TmxDocument> {
  readonly viewType = TMX_VIEW_TYPE;
  readonly bundle = 'tmx';
  readonly title = 'CPCBuild Map Viewer';
  readonly documents = new Map<string, TmxDocument>();
  /** Test hook: the Tiled executable to use instead of the setting / the usual places. */
  tiledOverride?: string;

  constructor(private readonly context: vscode.ExtensionContext) {}

  register(): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(this.viewType, this, { supportsMultipleEditorsPerDocument: true, webviewOptions: { retainContextWhenHidden: false } });
  }

  async openCustomDocument(uri: vscode.Uri): Promise<TmxDocument> {
    const key = uri.toString();
    const doc = new TmxDocument(uri, () => this.documents.delete(key));
    let text = '';
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
    } catch (e) {
      doc.fatal = `${path.basename(uri.fsPath)}: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (!doc.fatal) buildView(doc, text);
    doc.text = text;
    this.documents.set(key, doc);
    if (uri.scheme === 'file') {
      doc.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(uri.fsPath)), path.basename(uri.fsPath)));
      const reload = (): void => void this.reload(doc);
      doc.watcher.onDidChange(reload);
      doc.watcher.onDidCreate(reload);
    }
    return doc;
  }

  /** The file changed on disk (Tiled saved): rebuild and push, without disturbing the webview's own state. */
  async reload(doc: TmxDocument): Promise<void> {
    try {
      doc.text = Buffer.from(await vscode.workspace.fs.readFile(doc.uri)).toString('utf8');
    } catch {
      return;
    }
    buildView(doc, doc.text);
    doc.version++;
    this.broadcast(doc);
  }

  private settings(): EditorSettings {
    const c = vscode.workspace.getConfiguration('cpcbuild.editor');
    return { defaultZoom: c.get<number>('defaultZoom', 12), showByteGrid: c.get<boolean>('showByteGrid', true), pixelAspect: c.get<string>('pixelAspect', 'square') === 'crt' ? 'crt' : 'square' };
  }

  private currentView(doc: TmxDocument): TmxViewerView {
    return { ...(doc.view as NonNullable<TmxDocument['view']>), tiled: this.tiledOverride ?? doc.view?.tiled, version: doc.version, canUndo: false, canRedo: false, fileName: path.basename(doc.uri.fsPath) };
  }

  private post(panel: vscode.WebviewPanel, msg: HostToWeb<TmxViewerView>): void {
    void panel.webview.postMessage(msg);
  }

  broadcast(doc: TmxDocument): void {
    for (const p of doc.panels) {
      if (doc.fatal) this.post(p, { type: 'fatal', message: doc.fatal });
      else this.post(p, { type: 'view', view: this.currentView(doc) });
    }
  }

  resolveCustomEditor(doc: TmxDocument, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [webviewRoot(vscode, this.context.extensionUri)] };
    webview.html = webviewHtml(vscode, webview, this.context.extensionUri, this.bundle, this.title);
    doc.panels.add(panel);
    panel.onDidDispose(() => doc.panels.delete(panel));
    webview.onDidReceiveMessage((m: unknown) => void this.onMessage(doc, panel, m as { type: string; id?: number; name?: string; args?: unknown; message?: string }));
  }

  private async onMessage(doc: TmxDocument, panel: vscode.WebviewPanel, m: { type: string; id?: number; name?: string; args?: unknown; message?: string }): Promise<void> {
    if (m.type === 'ready') {
      doc.readyCount++;
      this.post(panel, { type: 'init', settings: this.settings(), fileName: path.basename(doc.uri.fsPath) });
      if (doc.fatal) this.post(panel, { type: 'fatal', message: doc.fatal });
      else this.post(panel, { type: 'view', view: this.currentView(doc) });
      return;
    }
    if (m.type === 'error') {
      doc.webviewErrors.push(String(m.message));
      getChannel().appendLine(`${this.title}: webview error: ${m.message}`);
      return;
    }
    if (m.type !== 'request' || typeof m.id !== 'number') return;
    const id = m.id;
    try {
      const result = await this.request(doc, m.name ?? '', m.args);
      this.post(panel, { type: 'response', id, ok: true, result });
    } catch (e) {
      this.post(panel, { type: 'response', id, ok: false, error: (e as Error).message });
    }
  }

  /** Handles a request; public so the extension-host tests can drive it as the webview would. */
  async request(doc: TmxDocument, name: string, args: unknown): Promise<unknown> {
    doc.requestLog.push(name);
    switch (name) {
      case 'copy':
        await vscode.env.clipboard.writeText((args as { text: string }).text);
        return { ok: true };
      case 'history':
        return { ok: true };
      case 'openAsText':
        await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
        return { ok: true };
      case 'atlases': {
        const a = args as { source: 'image' | 'cpc' | 'cpctil'; mode: 0 | 1 | 2; firstgid?: number };
        return this.atlases(doc, a.source, a.mode, a.firstgid);
      }
      case 'convert':
        return this.convert(doc, args as ConvertOptions);
      case 'insertTileMap':
        return this.insertTileMap((args as { name: string }).name);
      case 'openInTiled':
        return openInTiled(doc.uri.fsPath, this.tiledOverride);
      default:
        throw new Error(`unknown request '${name}'`);
    }
  }

  // ----------------------------------------------------------- requests

  atlases(doc: TmxDocument, source: 'image' | 'cpc' | 'cpctil', mode: 0 | 1 | 2, firstgidOverride?: number): AtlasResult {
    const key = `${source}:${mode}:${firstgidOverride ?? ''}`;
    const hit = doc.atlasCache.get(key);
    if (hit) return hit;
    const out: AtlasResult = { atlases: [], notices: [] };
    const map = doc.map;
    const view = doc.view;
    if (!map || !view) return out;
    const root = projectRootOf(doc.uri.fsPath);
    if (source === 'cpctil') {
      const rel = view.cpctil?.file;
      if (!rel) {
        const fallback = this.atlases(doc, 'image', mode, firstgidOverride);
        const res: AtlasResult = { atlases: fallback.atlases, notices: [{ severity: 'info', text: 'No matching .cpctil was found; showing the Tiled images.' }, ...fallback.notices] };
        doc.atlasCache.set(key, res);
        return res;
      }
      try {
        const abs = path.resolve(root, rel);
        const st = parseSprite(fs.readFileSync(abs, 'utf8'), 'til');
        let fileText: string | undefined;
        if ('file' in st.palette) {
          try {
            fileText = fs.readFileSync(path.resolve(root, st.palette.file), 'utf8');
          } catch {
            /* resolvePalette reports it */
          }
        }
        const pal = resolvePalette(st, fileText);
        if (pal.problem) out.notices.push({ severity: 'warning', text: pal.problem });
        const rgbOf = (pen: number): [number, number, number] | undefined => {
          if (pal.pens) return pal.pens[pen] === undefined ? undefined : ([...FW_TABLE[pal.pens[pen]]] as [number, number, number]);
          const c = pal.colours?.[pen - 1];
          if (!c) return undefined;
          const [r, g, b] = parseRgb12List(c)[0];
          return [r * 17, g * 17, b * 17];
        };
        out.atlases.push(wire(atlasFromPens(st.items, rgbOf, effectiveFirstgid(map, { firstgid: firstgidOverride }))));
        out.notices.push({ severity: 'info', text: `Tiles from ${rel}: tile number n is item n of the tile set.` });
      } catch (e) {
        out.notices.push({ severity: 'warning', text: `${rel}: ${e instanceof Error ? e.message : String(e)}` });
      }
      doc.atlasCache.set(key, out);
      return out;
    }
    view.tilesets.forEach((t, i) => {
      if (t.imageStatus !== 'ok' || !t.imagePath) return;
      const geo = doc.tilesets[i];
      try {
        const bytes = fs.readFileSync(t.imagePath);
        let img = cachedDecode(t.imagePath, new Uint8Array(bytes));
        if (source === 'cpc') {
          const pv = previewOf(newRecipe(t.imagePath, { mode, kind: 'tiles', emitPalette: false }), rootIo(root), { decode: decoderFor(root) });
          const data = new Uint8Array(pv.width * pv.height * 4);
          pv.indices.forEach((pen, k) => {
            const row = pv.rows[pen];
            if (!row) return;
            data.set([row.rgb[0], row.rgb[1], row.rgb[2], 255], k * 4);
          });
          img = { width: pv.width, height: pv.height, data };
        }
        out.atlases.push(
          wire(atlasFromImage(img, { tw: t.tilewidth, th: t.tileheight, margin: geo.margin, spacing: geo.spacing, columns: geo.columns, count: geo.tilecount, firstgid: t.firstgid })),
        );
      } catch (e) {
        out.notices.push({ severity: 'warning', text: `${source === 'cpc' ? 'CPC preview of ' : ''}${path.basename(t.imagePath)}: ${e instanceof Error ? e.message : String(e)}` });
      }
    });
    doc.atlasCache.set(key, out);
    return out;
  }

  async convert(doc: TmxDocument, o: ConvertOptions): Promise<ConvertResult> {
    return convertFile(doc.uri.fsPath, o);
  }

  private async insertTileMap(name: string): Promise<{ inserted: boolean; text: string }> {
    const text = tileMapCall(name);
    const ed = vscode.window.visibleTextEditors.find((e) => /\.bas$/i.test(e.document.fileName));
    if (ed) {
      const ok = await ed.edit((b) => b.insert(ed.selection.active, text));
      if (ok) return { inserted: true, text };
    }
    await vscode.env.clipboard.writeText(text);
    return { inserted: false, text };
  }
}

// ---------------------------------------------------------------- commands

/** Converts a .tmx with the engine the settings choose. Never throws. */
export async function convertFile(file: string, o: ConvertOptions & { output?: string }): Promise<ConvertResult> {
  const root = projectRootOf(file);
  const s = readSettings(root);
  const rel = posix(path.relative(root, file));
  const r = await generateTmx(root, rel, o, { engine: s.assetsEngine, pythonPath: s.pythonPath, library: resolveLibrary(root, s) }, { sink: channelSink });
  if (!r.ok) getChannel().appendLine(r.error ?? 'tmx2bas failed');
  else getChannel().appendLine(`${rel} -> ${r.output} (${s.assetsEngine} engine)`);
  return { ok: r.ok, output: r.output, error: r.error, engine: s.assetsEngine };
}

export interface TmxCommandArgs extends ConvertOptions {
  uri?: vscode.Uri | string;
  /** Project-relative output path. */
  output?: string;
  /** Never ask (tests, scripts): take the first layer unless `layer` is given. */
  quiet?: boolean;
}

function activeTmxUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  if (input?.uri && /\.tmx$/i.test(input.uri.path)) return input.uri;
  const ed = vscode.window.activeTextEditor?.document.uri;
  return ed && /\.tmx$/i.test(ed.path) ? ed : undefined;
}

function toUri(v: vscode.Uri | string | undefined): vscode.Uri | undefined {
  return typeof v === 'string' ? vscode.Uri.file(v) : v;
}

/** The URI a command acts on: an argument (Explorer passes a Uri), the active .tmx, else a pick. */
async function pickTmx(arg: vscode.Uri | TmxCommandArgs | undefined, quiet: boolean): Promise<vscode.Uri | undefined> {
  const given = arg instanceof vscode.Uri ? arg : toUri(arg?.uri);
  if (given) return given;
  const active = activeTmxUri();
  if (active || quiet) return active;
  const found = await vscode.workspace.findFiles('**/*.tmx', '**/node_modules/**', 50);
  if (!found.length) {
    void vscode.window.showInformationMessage('CPCBuild: no .tmx file in this workspace.');
    return undefined;
  }
  if (found.length === 1) return found[0];
  const pick = await vscode.window.showQuickPick(found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })), { title: 'CPCBuild: Tiled map to convert' });
  return pick?.uri;
}

/** CPCBuild: Convert Tiled Map to BASIC. */
export async function tmxGenerateCommand(arg?: vscode.Uri | TmxCommandArgs): Promise<ConvertResult | undefined> {
  const a: TmxCommandArgs = arg instanceof vscode.Uri || !arg ? {} : arg;
  const quiet = a.quiet === true;
  const uri = await pickTmx(arg, quiet);
  if (!uri) return undefined;
  const opts: ConvertOptions & { output?: string } = { layer: a.layer, name: a.name, firstgid: a.firstgid, empty: a.empty, output: a.output };
  if (opts.layer === undefined && !quiet) {
    try {
      const map = parseTmx(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
      if (map.layers.length > 1) {
        const pick = await vscode.window.showQuickPick(map.layers.map((l) => ({ label: l.name })), { title: 'CPCBuild: tile layer to convert' });
        if (!pick) return undefined;
        opts.layer = pick.label;
      }
    } catch (e) {
      if (!(e instanceof TmxError)) throw e; // a bad map is reported by the conversion itself
    }
  }
  const r = await convertFile(uri.fsPath, opts);
  if (r.ok) {
    const root = projectRootOf(uri.fsPath);
    const out = vscode.Uri.file(path.resolve(root, r.output));
    if (!quiet) void vscode.window.showInformationMessage(`CPCBuild: wrote ${r.output}`, 'Open').then((c) => c && vscode.window.showTextDocument(out));
  } else {
    void vscode.window.showErrorMessage(`CPCBuild: ${r.error}`);
  }
  return r;
}

/** CPCBuild: Open in Tiled. `tiledPath` is for tests. */
export async function openInTiledCommand(arg?: vscode.Uri | (TmxCommandArgs & { tiledPath?: string })): Promise<{ ok: boolean; error?: string; command?: string[] } | undefined> {
  const quiet = !(arg instanceof vscode.Uri) && arg?.quiet === true;
  const uri = await pickTmx(arg, quiet);
  if (!uri) return undefined;
  const r = await openInTiled(uri.fsPath, !(arg instanceof vscode.Uri) ? arg?.tiledPath : undefined);
  if (!r.ok && !quiet) void vscode.window.showErrorMessage(`CPCBuild: ${r.error}`);
  return r;
}

/** The generator for "CPCBuild: Generate Asset File": a .tmx (open in any editor) converts; other files are not ours. */
export async function generateTmxAsset(uri: vscode.Uri | undefined): Promise<unknown | undefined> {
  const u = uri ?? activeTmxUri();
  if (!u || !/\.tmx$/i.test(u.path)) return undefined;
  return tmxGenerateCommand({ uri: u, quiet: true });
}
