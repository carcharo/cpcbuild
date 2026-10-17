/**
 * memoryView.ts -- the memory view (spec 5.3, ux S9): a read-only hex + ASCII window onto the 64 KB
 * address space the Z80 sees, read through cpcbuild.emu.readMemory. Go to an address or a symbol (and
 * follow it), page through, bytes that changed since the last refresh are marked; it refreshes on pause
 * events and on a timer of at most 2 Hz while the program runs. Writes are deferred (the view is
 * read-only in this version).
 */
import * as vscode from 'vscode';
import { MemoryModel, pageBase, toBase64, WINDOW_BYTES, BYTES_PER_ROW } from '../core/memdiff';
import { hex4 } from '../core/map';
import { describeAddress, resolveTarget } from '../core/symbols';
import type { MemEmpty, MemHostMsg, MemSnapshot, MemStatus, MemWebMsg } from '../shared/memoryProtocol';
import { DebugController } from './debug';
import { isError } from './emuClient';
import { webviewHtml, webviewRoot } from './webviewHtml';

export const MEMORY_VIEW_TYPE = 'cpcbuild.memoryView';
/** Commands the webview may ask for (a fixed list: the webview never names an arbitrary command). */
const ALLOWED = new Set(['cpcbuild.buildAndRun', 'workbench.extensions.search']);

export interface ShowArgs {
  addr?: number;
  symbol?: string;
  text?: string;
}

export class MemoryView implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly model = new MemoryModel();
  /** The text the window follows: a symbol name (re-resolved on every refresh), else undefined. */
  private follow?: string;
  private targetText = '';
  private ready = false;
  /** Webview start-ups and uncaught webview errors (extension-host tests check the page came up clean). */
  readonly stats = { ready: 0, errors: [] as string[] };
  private last?: MemSnapshot;
  private refreshing = false;
  private again = false;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext, private readonly ctl: DebugController) {
    this.subs.push(
      ctl.onRefresh(() => void this.refresh()),
      ctl.symbols.onDidChange(() => void this.refresh()),
      ctl.watching(() => !!this.panel?.visible),
    );
  }

  /** The last snapshot posted (extension-host tests read this instead of the webview). */
  get snapshot(): MemSnapshot | undefined {
    return this.last;
  }

  get isOpen(): boolean {
    return !!this.panel;
  }

  /** `cpcbuild.memory.show`: opens/reveals the panel and moves the window when told where. */
  async show(arg?: ShowArgs | string): Promise<MemSnapshot | undefined> {
    const a = typeof arg === 'string' ? { text: arg } : (arg ?? {});
    if (!this.ctl.symbols.loaded) await this.ctl.symbols.reload();
    this.open();
    const table = this.ctl.symbols.table;
    const exact = a.text === undefined && a.addr !== undefined;
    const text = a.text ?? a.symbol ?? (a.addr !== undefined ? hex4(a.addr) : undefined);
    if (text !== undefined) {
      const r = exact ? { addr: a.addr as number, symbol: a.symbol ? table?.symbols.find((x) => x.name === a.symbol && x.addr === a.addr) : undefined } : resolveTarget(table, text);
      if ('error' in r) this.post({ type: 'notice', severity: 'warning', text: r.error });
      else {
        this.model.moveTo(r.addr);
        const offset = 'offset' in r ? r.offset : undefined;
        this.follow = r.symbol && !offset ? r.symbol.name : undefined;
        this.targetText = r.symbol ? (exact ? r.symbol.name : text) : hex4(r.addr);
      }
    }
    await this.refresh();
    return this.last;
  }

  private open(): void {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }
    const root = webviewRoot(vscode, this.ctx.extensionUri);
    const panel = vscode.window.createWebviewPanel(MEMORY_VIEW_TYPE, 'CPC Memory', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, localResourceRoots: [root] });
    this.panel = panel;
    this.ready = false;
    panel.webview.html = webviewHtml(vscode, panel.webview, this.ctx.extensionUri, 'memory', 'CPC Memory');
    panel.webview.onDidReceiveMessage((m: MemWebMsg) => void this.onMessage(m), undefined, this.subs);
    panel.onDidChangeViewState((e) => e.webviewPanel.visible && void this.refresh(), undefined, this.subs);
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.ready = false;
    }, undefined, this.subs);
  }

  private post(m: MemHostMsg): void {
    if (this.panel && this.ready) void this.panel.webview.postMessage(m);
  }

  private async onMessage(m: MemWebMsg): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.stats.ready++;
        await this.refresh();
        break;
      case 'error':
        this.stats.errors.push(m.message);
        console.error(`[cpcbuild memory view] ${m.message}`);
        break;
      case 'goto':
        await this.show({ text: m.text });
        break;
      case 'page':
        this.model.moveTo(pageBase(this.model.base, m.pages));
        this.follow = undefined;
        this.targetText = hex4(this.model.base);
        await this.refresh();
        break;
      case 'refresh':
        await this.ctl.poll('timer');
        await this.refresh();
        break;
      case 'control':
        await vscode.commands.executeCommand(`cpcbuild.debug.${m.cmd}`);
        break;
      case 'command':
        if (ALLOWED.has(m.command)) await vscode.commands.executeCommand(m.command, m.command === 'workbench.extensions.search' ? '@id:cpcbuild.cpcbuild-emu' : undefined);
        break;
      case 'copy':
        await vscode.env.clipboard.writeText(m.text);
        break;
    }
  }

  private status(): MemStatus {
    const st = this.ctl.state;
    if (!st) return { live: false, paused: false, text: this.last ? 'Session ended: the values below are the last ones read.' : 'No emulator session.', stale: !!this.last };
    return { live: true, paused: st.paused, text: st.paused ? `Paused at ${describeAddress(this.ctl.symbols.table, st.pc)} (${hex4(st.pc)})` : 'Running' };
  }

  private empty(): MemEmpty {
    return { title: 'No emulator session', text: 'Build and run the project in the CPCBuild Emulator, then this view shows the memory the Z80 sees.', action: { label: 'Build and Run', command: 'cpcbuild.buildAndRun' } };
  }

  /** Reads the window and posts it. Overlapping calls collapse into one more run. */
  async refresh(): Promise<void> {
    if (!this.panel) return;
    if (this.refreshing) {
      this.again = true;
      return;
    }
    this.refreshing = true;
    try {
      do {
        this.again = false;
        await this.refreshOnce();
      } while (this.again);
    } finally {
      this.refreshing = false;
    }
  }

  private async refreshOnce(): Promise<void> {
    const avail = await this.ctl.client.available();
    if (!avail.ok) {
      this.post({ type: 'empty', empty: { title: 'The CPCBuild Emulator extension is missing', text: `${avail.why ?? 'Not installed'}. The live memory view reads memory from it.`, action: { label: 'Install CPCBuild Emulator', command: 'workbench.extensions.search' } }, status: this.status() });
      return;
    }
    if (!this.ctl.live) await this.ctl.poll('timer');
    if (!this.ctl.live) {
      if (this.last) this.post({ type: 'status', status: this.status() });
      else this.post({ type: 'empty', empty: this.empty(), status: this.status() });
      return;
    }
    const table = this.ctl.symbols.table;
    if (this.follow && table) {
      const r = resolveTarget(table, this.follow);
      if (!('error' in r)) this.model.moveTo(r.addr);
    }
    const bytes = await this.ctl.client.readMemory(this.model.base, this.model.size);
    if (isError(bytes)) {
      this.post({ type: 'notice', severity: 'warning', text: `Reading memory failed: ${bytes.error}. Trying again on the next refresh.` });
      return;
    }
    const upd = this.model.update(bytes);
    const rowNames: Record<number, string> = {};
    if (table) {
      for (const s of table.symbols) {
        if (s.internal || s.addr < upd.base || s.addr >= upd.base + WINDOW_BYTES) continue;
        const row = Math.floor((s.addr - upd.base) / BYTES_PER_ROW);
        rowNames[row] = rowNames[row] ? `${rowNames[row]}, ${s.name}` : s.name;
      }
    }
    const snap: MemSnapshot = {
      base: upd.base,
      bytes: toBase64(bytes),
      changed: upd.changed,
      rowNames,
      target: this.targetText || hex4(upd.base),
      following: this.follow,
      pc: this.ctl.state?.pc,
      sp: this.ctl.state?.sp,
    };
    this.last = snap;
    this.post({ type: 'snapshot', snap, status: this.status() });
  }

  dispose(): void {
    this.panel?.dispose();
    this.subs.forEach((d) => d.dispose());
  }
}
