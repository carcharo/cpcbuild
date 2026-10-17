/**
 * customEditor.ts -- the base of Studio's custom editors (palette now; sprite, tile and importer
 * next). The document model lives here in the host. A webview never holds authority: it sends
 * edit operations, the host applies them with the codec's pure `apply`, fires
 * onDidChangeCustomDocument with undo/redo closures (so VS Code owns Undo, Redo, dirty, Save,
 * Revert, backups and hot exit) and posts the new view to every webview of the document.
 *
 * A concrete editor subclasses StudioEditorProvider and supplies the codec (parse, serialise,
 * apply, view) and, if it has them, extra requests.
 */
import * as vscode from 'vscode';
import type { EditorSettings, HostToWeb, ViewBase } from '../shared/protocol';
import { getChannel } from './channel';
import { webviewHtml, webviewRoot } from './webviewHtml';

export interface Edit<S> {
  label: string;
  before: S;
  after: S;
}

export class StudioDocument<S> implements vscode.CustomDocument {
  state: S;
  /** Bumped by every change of the state, including undo, redo and revert. */
  version = 0;
  /** Set when the file did not parse at all; the webview then shows the fatal error state. */
  fatal?: string;
  /** Our own count of the stack VS Code keeps, only to grey the Undo / Redo buttons. */
  undoDepth = 0;
  redoDepth = 0;
  readonly panels = new Set<vscode.WebviewPanel>();
  /** Test hooks: how many times a webview said ready, and the errors it reported. */
  readyCount = 0;
  readonly webviewErrors: string[] = [];
  /** Edits in the order they were made and not undone (the same stack VS Code holds; used by the test API). */
  readonly applied: { edit: Edit<S>; undo: () => void; redo: () => void }[] = [];
  readonly undone: { edit: Edit<S>; undo: () => void; redo: () => void }[] = [];

  constructor(
    readonly uri: vscode.Uri,
    state: S,
    private readonly onDispose: () => void,
  ) {
    this.state = state;
  }

  dispose(): void {
    this.onDispose();
  }
}

export type ApplyOutcome<S> = { state: S; label: string } | { error: string };

export abstract class StudioEditorProvider<S, Op, V extends ViewBase> implements vscode.CustomEditorProvider<StudioDocument<S>> {
  abstract readonly viewType: string;
  /** dist/webview/<bundle>.js */
  abstract readonly bundle: string;
  abstract readonly title: string;

  abstract parse(text: string, uri: vscode.Uri): S;
  abstract serialise(state: S): string;
  /** A problem that stops saving (the tool's message), or undefined. Backups ignore it. */
  abstract saveProblem(state: S): string | undefined;
  abstract apply(state: S, op: Op): ApplyOutcome<S>;
  abstract view(state: S, doc: StudioDocument<S>): Omit<V, keyof ViewBase>;
  /** Editor-specific requests; throw to answer with an error. */
  protected async handleRequest(_doc: StudioDocument<S>, name: string, _args: unknown): Promise<unknown> {
    throw new Error(`unknown request '${name}'`);
  }

  private readonly changeEmitter = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<StudioDocument<S>>>();
  readonly onDidChangeCustomDocument = this.changeEmitter.event;
  readonly documents = new Map<string, StudioDocument<S>>();

  constructor(protected readonly context: vscode.ExtensionContext) {}

  /** Registers the provider; multiple editors per document are supported (each shows the others' edits live). */
  register(): vscode.Disposable {
    return vscode.Disposable.from(
      this.changeEmitter,
      vscode.window.registerCustomEditorProvider(this.viewType, this, {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false },
      }),
    );
  }

  // ------------------------------------------------------------ documents

  async openCustomDocument(uri: vscode.Uri, openContext: vscode.CustomDocumentOpenContext): Promise<StudioDocument<S>> {
    const from = openContext.backupId ? vscode.Uri.parse(openContext.backupId) : uri;
    let text = '';
    try {
      text = Buffer.from(await vscode.workspace.fs.readFile(from)).toString('utf8');
    } catch {
      // a new file that does not exist yet reads as empty
    }
    const key = uri.toString();
    let state: S | undefined;
    let fatal: string | undefined;
    try {
      state = this.parse(text, uri);
    } catch (e) {
      fatal = (e as Error).message;
    }
    const doc = new StudioDocument<S>(uri, state as S, () => this.documents.delete(key));
    doc.fatal = fatal;
    this.documents.set(key, doc);
    return doc;
  }

  private async write(uri: vscode.Uri, text: string): Promise<void> {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(text, 'utf8'));
  }

  async saveCustomDocument(doc: StudioDocument<S>): Promise<void> {
    if (doc.fatal) throw new Error(doc.fatal);
    const problem = this.saveProblem(doc.state);
    if (problem) throw new Error(`Cannot save: ${problem}`);
    await this.write(doc.uri, this.serialise(doc.state));
    await this.afterSave(doc);
  }

  /** Hook: runs after a successful save (generate-on-save lives here later). */
  protected async afterSave(_doc: StudioDocument<S>): Promise<void> {}

  async saveCustomDocumentAs(doc: StudioDocument<S>, destination: vscode.Uri): Promise<void> {
    const problem = this.saveProblem(doc.state);
    if (problem) throw new Error(`Cannot save: ${problem}`);
    await this.write(destination, this.serialise(doc.state));
  }

  async revertCustomDocument(doc: StudioDocument<S>): Promise<void> {
    const text = Buffer.from(await vscode.workspace.fs.readFile(doc.uri)).toString('utf8');
    doc.state = this.parse(text, doc.uri);
    doc.fatal = undefined;
    doc.version++;
    doc.undoDepth = doc.redoDepth = 0;
    doc.applied.length = 0;
    doc.undone.length = 0;
    this.broadcast(doc);
  }

  async backupCustomDocument(doc: StudioDocument<S>, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
    await this.write(context.destination, this.serialise(doc.state));
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // already gone
        }
      },
    };
  }

  // ---------------------------------------------------------------- edits

  /** Applies an operation as one undoable edit. Returns the new version. Throws with the tool's message on a bad op. */
  commit(doc: StudioDocument<S>, op: Op): number {
    const r = this.apply(doc.state, op);
    if ('error' in r) {
      if (r.error === 'unchanged') return doc.version;
      throw new Error(r.error);
    }
    const edit: Edit<S> = { label: r.label, before: doc.state, after: r.state };
    doc.state = edit.after;
    doc.version++;
    doc.undoDepth++;
    doc.redoDepth = 0;
    doc.undone.length = 0;
    const undo = (): void => {
      doc.state = edit.before;
      doc.version++;
      doc.undoDepth = Math.max(0, doc.undoDepth - 1);
      doc.redoDepth++;
      const i = doc.applied.findIndex((x) => x.edit === edit);
      if (i >= 0) doc.undone.push(...doc.applied.splice(i, 1));
      this.broadcast(doc);
    };
    const redo = (): void => {
      doc.state = edit.after;
      doc.version++;
      doc.undoDepth++;
      doc.redoDepth = Math.max(0, doc.redoDepth - 1);
      const i = doc.undone.findIndex((x) => x.edit === edit);
      if (i >= 0) doc.applied.push(...doc.undone.splice(i, 1));
      this.broadcast(doc);
    };
    doc.applied.push({ edit, undo, redo });
    this.changeEmitter.fire({ document: doc, label: edit.label, undo, redo });
    this.broadcast(doc);
    return doc.version;
  }

  // ------------------------------------------------------------- test API

  /** What VS Code does on Ctrl+Z, for the extension-host tests (they cannot press keys). */
  undoLast(doc: StudioDocument<S>): boolean {
    const last = doc.applied[doc.applied.length - 1];
    if (!last) return false;
    last.undo();
    return true;
  }
  redoLast(doc: StudioDocument<S>): boolean {
    const last = doc.undone[doc.undone.length - 1];
    if (!last) return false;
    last.redo();
    return true;
  }

  // ------------------------------------------------------------- webviews

  protected settings(): EditorSettings {
    const c = vscode.workspace.getConfiguration('cpcbuild.editor');
    return {
      defaultZoom: c.get<number>('defaultZoom', 12),
      showByteGrid: c.get<boolean>('showByteGrid', true),
      pixelAspect: c.get<string>('pixelAspect', 'square') === 'crt' ? 'crt' : 'square',
    };
  }

  protected currentView(doc: StudioDocument<S>): V {
    return {
      ...this.view(doc.state, doc),
      version: doc.version,
      canUndo: doc.undoDepth > 0,
      canRedo: doc.redoDepth > 0,
      fileName: doc.uri.path.split('/').pop() ?? '',
    } as V;
  }

  protected post(panel: vscode.WebviewPanel, msg: HostToWeb<V>): void {
    void panel.webview.postMessage(msg);
  }

  broadcast(doc: StudioDocument<S>): void {
    if (doc.fatal) return;
    const view = this.currentView(doc);
    for (const p of doc.panels) this.post(p, { type: 'view', view });
  }

  resolveCustomEditor(doc: StudioDocument<S>, panel: vscode.WebviewPanel): void {
    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [webviewRoot(vscode, this.context.extensionUri)] };
    webview.html = webviewHtml(vscode, webview, this.context.extensionUri, this.bundle, this.title);
    doc.panels.add(panel);
    panel.onDidDispose(() => doc.panels.delete(panel));
    webview.onDidReceiveMessage((m: unknown) => void this.onMessage(doc, panel, m as { type: string; id?: number; name?: string; args?: unknown; message?: string }));
  }

  private async onMessage(doc: StudioDocument<S>, panel: vscode.WebviewPanel, m: { type: string; id?: number; name?: string; args?: unknown; message?: string }): Promise<void> {
    if (m.type === 'ready') {
      doc.readyCount++;
      this.post(panel, { type: 'init', settings: this.settings(), fileName: doc.uri.path.split('/').pop() ?? '' });
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

  private async request(doc: StudioDocument<S>, name: string, args: unknown): Promise<unknown> {
    switch (name) {
      case 'edit': {
        const a = args as { baseVersion: number; op: Op };
        if (a.baseVersion !== doc.version) {
          this.broadcast(doc); // rebase: the webview gets the current state
          throw new Error('the document changed in another view; your edit was not applied');
        }
        return { version: this.commit(doc, a.op) };
      }
      case 'copy':
        await vscode.env.clipboard.writeText((args as { text: string }).text);
        return { ok: true };
      case 'history':
        await vscode.commands.executeCommand((args as { action: string }).action === 'redo' ? 'redo' : 'undo');
        return { ok: true };
      case 'openAsText':
        await vscode.commands.executeCommand('vscode.openWith', doc.uri, 'default');
        return { ok: true };
      default:
        return this.handleRequest(doc, name, args);
    }
  }
}
