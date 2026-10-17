/**
 * debug.ts -- the debug controls over the cpcbuild.emu.* contract (spec 5.3, ux S9/S12): pause, resume,
 * step, step over, step out, execution breakpoints by symbol or address (kept per project in workspace
 * state and re-applied when the emulator opens), the "CPC paused at <symbol+off>" status bar item, and
 * the Registers and Breakpoints views. Studio never touches the WASM: everything goes through EmuClient.
 */
import * as vscode from 'vscode';
import type { EmuEvent, EmuState } from '../emuApi';
import { BreakpointRec, breakpointText, reasonText, registerRows, RegisterRow, reresolve, statusText, toggleBreakpoint } from '../core/debugModel';
import { hex4 } from '../core/map';
import { findByName, resolveTarget, SymbolInfo, SymbolTable } from '../core/symbols';
import { EmuClient, isError, StepCommand } from './emuClient';
import { SymbolSource } from './symbolSource';

export type RefreshReason = 'open' | 'pause' | 'resume' | 'timer' | 'closed';

const STORE_KEY = 'cpcbuild.breakpoints';
/** The timer never runs faster than this (the task's 2 Hz cap), whatever `cpcbuild.emu.pollRateHz` says. */
const MAX_HZ = 2;

/** The symbol a tree node or `{ sym | symbol | label }` argument stands for. */
export function symbolOfArg(arg: unknown, table: SymbolTable | undefined): SymbolInfo | undefined {
  const a = arg as { sym?: SymbolInfo; symbol?: string; label?: string } | undefined;
  if (a?.sym) return a.sym;
  const name = a?.symbol ?? a?.label;
  if (name && table) return table.symbols.find((s) => s.label === name) ?? findByName(table, name);
  return undefined;
}

export interface ToggleResult {
  added?: boolean;
  addr?: number;
  /** True when the emulator was told (a session exists). */
  applied: boolean;
  error?: string;
}

export class DebugController implements vscode.Disposable {
  readonly client = new EmuClient();
  readonly symbols = new SymbolSource();
  state?: EmuState;
  live = false;
  private readonly refreshEmitter = new vscode.EventEmitter<RefreshReason>();
  readonly onRefresh = this.refreshEmitter.event;
  private readonly stateEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.stateEmitter.event;
  private readonly bpEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeBreakpoints = this.bpEmitter.event;
  private readonly watchers: (() => boolean)[] = [];
  private readonly applied = new Map<string, Set<number>>();
  private readonly status: vscode.StatusBarItem;
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    this.status.command = 'cpcbuild.memory.show';
    this.subs.push(
      this.status, this.refreshEmitter, this.stateEmitter, this.bpEmitter, this.symbols,
      this.symbols.onDidChange(() => this.followRebuild()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpcbuild.emu.pollRateHz') && this.restartTimer()),
    );
    void this.symbols.reload();
    this.restartTimer();
  }

  /** A view says "poll for me while this is true" (visible). */
  watching(visible: () => boolean): vscode.Disposable {
    this.watchers.push(visible);
    return new vscode.Disposable(() => void this.watchers.splice(this.watchers.indexOf(visible), 1));
  }

  // ------------------------------------------------------------------ timer and events

  private restartTimer(): void {
    if (this.timer) clearInterval(this.timer);
    const hz = Math.max(0.2, Math.min(MAX_HZ, vscode.workspace.getConfiguration('cpcbuild').get<number>('emu.pollRateHz', MAX_HZ) || MAX_HZ));
    this.timer = setInterval(() => void this.tick(), Math.round(1000 / hz));
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.ticking || !this.watchers.some((w) => w())) return;
    this.ticking = true;
    try {
      await this.poll('timer');
    } finally {
      this.ticking = false;
    }
  }

  /** Asks the emulator for its state and fires the right refresh. */
  async poll(reason: RefreshReason = 'timer'): Promise<EmuState | undefined> {
    const a = await this.client.available();
    if (!a.ok) {
      if (this.live) this.closed();
      return undefined;
    }
    const st = await this.client.state();
    if (isError(st)) {
      if (this.live) this.closed();
      return undefined;
    }
    const wasLive = this.live;
    const wasPaused = this.state?.paused;
    this.setState(st);
    if (!wasLive) {
      void this.applyBreakpoints();
      this.refreshEmitter.fire('open');
    } else if (st.paused) {
      if (!wasPaused) this.refreshEmitter.fire('pause');
    } else this.refreshEmitter.fire(reason);
    return st;
  }

  private setState(st: EmuState | undefined): void {
    this.state = st;
    this.live = !!st;
    const table = this.symbols.table;
    if (st) {
      const paused = st.paused;
      this.status.text = `$(${paused ? 'debug-pause' : 'play'}) ${statusText(st, table)}`;
      this.status.tooltip = paused ? `The CPC ${reasonText(st.reason)} at ${hex4(st.pc)}. Click for the memory view.` : 'The CPC program is running. Click for the memory view.';
      this.status.show();
    } else this.status.hide();
    void vscode.commands.executeCommand('setContext', 'cpcbuild.debug.live', this.live);
    void vscode.commands.executeCommand('setContext', 'cpcbuild.debug.paused', !!st?.paused);
    this.stateEmitter.fire();
  }

  /** The text of the status bar item ("$(debug-pause) CPC paused at Name+3"); empty when hidden. */
  statusLine(): string {
    return this.live ? this.status.text : '';
  }

  private closed(): void {
    if (this.client.session) this.applied.delete(this.client.session);
    this.client.session = undefined;
    this.setState(undefined);
    this.refreshEmitter.fire('closed');
  }

  /** `cpcbuild.emuEvent` from cpcbuild-emu: paused, resumed, closed. */
  onEvent(ev: EmuEvent): void {
    if (ev.event === 'closed') {
      if (!this.client.session || this.client.session === ev.session) this.closed();
      return;
    }
    const fresh = this.client.session !== ev.session || !this.live;
    this.client.session = ev.session;
    if (ev.state) this.setState(ev.state);
    if (fresh || !this.applied.has(ev.session)) void this.applyBreakpoints();
    this.refreshEmitter.fire(ev.event === 'paused' ? 'pause' : 'resume');
  }

  /** The Run command opened (or reused) a session: remember it and put the saved breakpoints into it. */
  async onOpened(session: string): Promise<void> {
    this.client.session = session;
    await this.applyBreakpoints(true);
    await this.poll('open');
  }

  // ------------------------------------------------------------------ breakpoints

  private rootKey(): string {
    return this.symbols.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  }

  breakpoints(): BreakpointRec[] {
    return (this.ctx.workspaceState.get<Record<string, BreakpointRec[]>>(STORE_KEY) ?? {})[this.rootKey()] ?? [];
  }

  private async saveBreakpoints(list: BreakpointRec[]): Promise<void> {
    const all = { ...(this.ctx.workspaceState.get<Record<string, BreakpointRec[]>>(STORE_KEY) ?? {}) };
    if (list.length) all[this.rootKey()] = list;
    else delete all[this.rootKey()];
    await this.ctx.workspaceState.update(STORE_KEY, all);
    this.bpEmitter.fire();
  }

  /** After a rebuild: breakpoints set on symbols move with the symbols. */
  private followRebuild(): void {
    const cur = this.breakpoints();
    const next = reresolve(cur, this.symbols.table, (t, n) => findByName(t, n)?.addr);
    if (JSON.stringify(cur) !== JSON.stringify(next)) void this.saveBreakpoints(next);
  }

  /** Sets the persisted breakpoints in the emulator, clears those it no longer has; `force` re-sets all (a new program was loaded). */
  async applyBreakpoints(force = false): Promise<void> {
    if (!(await this.client.available()).ok) return;
    const key = this.client.session ?? '';
    const want = new Set(this.breakpoints().map((b) => b.addr));
    const have = this.applied.get(key) ?? new Set<number>();
    for (const addr of want) {
      if (!force && have.has(addr)) continue;
      const r = await this.client.setBreakpoint(addr, true);
      if (isError(r)) {
        if (/no such session|no emulator session/.test(r.error)) return;
        void vscode.window.showWarningMessage(`CPCBuild: the emulator refused the breakpoint at ${hex4(addr)}: ${r.error}`);
      } else have.add(addr);
    }
    for (const addr of [...have]) {
      if (want.has(addr)) continue;
      await this.client.setBreakpoint(addr, false);
      have.delete(addr);
    }
    this.applied.set(key, have);
  }

  /** `cpcbuild.debug.toggleBreakpoint`: argument = a tree node, `{ addr, symbol? }`, `{ symbol }`/`{ text }`, or nothing (asks). */
  async toggle(arg?: unknown): Promise<ToggleResult> {
    if (!this.symbols.loaded) await this.symbols.reload();
    const table = this.symbols.table;
    const a = (arg === null ? undefined : arg) as { addr?: number; symbol?: string; text?: string; sym?: SymbolInfo } | string | undefined;
    let rec: BreakpointRec | undefined;
    const sym = typeof a === 'object' ? symbolOfArg(a, table) : undefined;
    if (typeof a === 'object' && a?.sym) rec = { addr: a.sym.addr, symbol: a.sym.name };
    else if (typeof a === 'object' && typeof a.addr === 'number') {
      rec = sym && sym.addr <= a.addr ? { addr: a.addr, symbol: sym.name, ...(a.addr > sym.addr ? { offset: a.addr - sym.addr } : {}) } : { addr: a.addr & 0xffff };
    } else {
      let text = typeof a === 'string' ? a : (a?.symbol ?? a?.text);
      if (typeof text !== 'string') text = undefined;
      if (text === undefined) {
        const cur = this.state?.paused ? hex4(this.state.pc) : '';
        text = await vscode.window.showInputBox({
          title: 'CPCBuild: toggle a breakpoint',
          prompt: 'A symbol (MoveSprites, MoveSprites+3) or an address (&4F2A, 0x4F2A). A breakpoint already there is removed.',
          value: cur,
        });
        if (text === undefined) return { applied: false };
      }
      const r = resolveTarget(table, text);
      if ('error' in r) {
        void vscode.window.showWarningMessage(`CPCBuild: ${r.error}`);
        return { applied: false, error: r.error };
      }
      rec = { addr: r.addr, ...(r.symbol ? { symbol: r.symbol.name, ...(r.addr > r.symbol.addr ? { offset: r.addr - r.symbol.addr } : {}) } : {}) };
    }
    const { list, added } = toggleBreakpoint(this.breakpoints(), rec);
    await this.saveBreakpoints(list);
    const r = await this.client.setBreakpoint(rec.addr, added);
    const key = this.client.session ?? '';
    if (isError(r)) {
      const noSession = /no such session|no emulator session|not installed|unknown command|not found/.test(r.error) || !this.live;
      if (noSession) {
        vscode.window.setStatusBarMessage(`CPCBuild: breakpoint ${added ? 'saved' : 'removed'} at ${breakpointText(rec)}; it is set when the emulator starts.`, 4000);
        return { added, addr: rec.addr, applied: false };
      }
      void vscode.window.showWarningMessage(`CPCBuild: the emulator refused the breakpoint at ${hex4(rec.addr)}: ${r.error}`);
      return { added, addr: rec.addr, applied: false, error: r.error };
    }
    const set = this.applied.get(key) ?? new Set<number>();
    if (added) set.add(rec.addr);
    else set.delete(rec.addr);
    this.applied.set(key, set);
    return { added, addr: rec.addr, applied: true };
  }

  // ------------------------------------------------------------------ run control

  async control(cmd: StepCommand): Promise<{ state: EmuState } | { error: string }> {
    const r = await this.client.control(cmd);
    if (isError(r)) {
      if (/no such session|no emulator session|not installed/.test(r.error) || !(await this.client.available()).ok) {
        void vscode.window.showInformationMessage('CPCBuild: no emulator session is open. Use "CPCBuild: Build and Run" first.');
      } else void vscode.window.showWarningMessage(`CPCBuild: ${cmd} failed: ${r.error}`);
      return r;
    }
    this.setState(r.state);
    this.refreshEmitter.fire(r.state.paused ? 'pause' : 'resume');
    return r;
  }

  registers(): RegisterRow[] {
    return this.state?.paused ? registerRows(this.state, this.symbols.table) : [];
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.subs.forEach((d) => d.dispose());
  }
}

// ---------------------------------------------------------------------- registers view

class RegisterNode {
  constructor(readonly row: RegisterRow) {}
}

export class RegistersView implements vscode.TreeDataProvider<RegisterNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<RegisterNode>;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly ctl: DebugController) {
    this.view = vscode.window.createTreeView('cpcbuild.registers', { treeDataProvider: this });
    this.subs.push(this.emitter, this.view, ctl.onDidChangeState(() => this.update()), ctl.watching(() => this.view.visible));
    this.update();
  }

  private update(): void {
    const s = this.ctl.state;
    this.view.message = !s ? 'No emulator session. Build and run the project in the CPCBuild Emulator.' : s.paused ? `Paused: ${reasonText(s.reason)}.` : 'Running. Pause (or hit a breakpoint) to see the registers.';
    this.emitter.fire();
  }

  getChildren(): RegisterNode[] {
    return this.ctl.registers().map((r) => new RegisterNode(r));
  }

  getTreeItem(n: RegisterNode): vscode.TreeItem {
    const it = new vscode.TreeItem(n.row.name, vscode.TreeItemCollapsibleState.None);
    it.description = n.row.note ? `${n.row.value}  ${n.row.note}` : n.row.value;
    it.tooltip = `${n.row.name} = ${n.row.value}${n.row.note ? ` (${n.row.note})` : ''}`;
    it.id = `reg:${n.row.name}`;
    return it;
  }

  dispose(): void {
    this.subs.forEach((d) => d.dispose());
  }
}

// -------------------------------------------------------------------- breakpoints view

class BpNode {
  constructor(readonly bp: BreakpointRec) {}
}

export class BreakpointsView implements vscode.TreeDataProvider<BpNode>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<BpNode>;
  private readonly subs: vscode.Disposable[] = [];

  constructor(private readonly ctl: DebugController) {
    this.view = vscode.window.createTreeView('cpcbuild.breakpoints', { treeDataProvider: this });
    this.subs.push(this.emitter, this.view, ctl.onDidChangeBreakpoints(() => this.emitter.fire()), ctl.symbols.onDidChange(() => this.emitter.fire()));
  }

  getChildren(): BpNode[] {
    return this.ctl.breakpoints().map((b) => new BpNode(b));
  }

  getTreeItem(n: BpNode): vscode.TreeItem {
    const it = new vscode.TreeItem(breakpointText(n.bp), vscode.TreeItemCollapsibleState.None);
    it.description = n.bp.symbol ? hex4(n.bp.addr) : undefined;
    it.iconPath = new vscode.ThemeIcon('debug-breakpoint');
    it.contextValue = 'breakpoint';
    it.id = `bp:${n.bp.addr}`;
    it.command = { command: 'cpcbuild.memory.show', title: 'Show in memory view', arguments: [{ addr: n.bp.addr }] };
    return it;
  }

  dispose(): void {
    this.subs.forEach((d) => d.dispose());
  }
}

/** The commands; `reg` is activate.ts's registrar. */
export function registerDebugCommands(reg: (id: string, fn: (...a: any[]) => unknown) => void, ctl: DebugController): void {
  reg('cpcbuild.debug.pause', () => ctl.control('pause'));
  reg('cpcbuild.debug.resume', () => ctl.control('resume'));
  reg('cpcbuild.debug.step', () => ctl.control('step'));
  reg('cpcbuild.debug.stepOver', () => ctl.control('stepOver'));
  reg('cpcbuild.debug.stepOut', () => ctl.control('stepOut'));
  reg('cpcbuild.debug.toggleBreakpoint', (arg?: unknown) => ctl.toggle(arg));
  reg('cpcbuild.debug.removeBreakpoint', (arg?: { bp?: BreakpointRec }) => (arg?.bp ? ctl.toggle({ addr: arg.bp.addr }) : undefined));
  reg('cpcbuild.debug.showRegisters', async () => {
    await ctl.poll('timer');
    await vscode.commands.executeCommand('cpcbuild.registers.focus');
    return { paused: !!ctl.state?.paused, rows: ctl.registers() };
  });
}
