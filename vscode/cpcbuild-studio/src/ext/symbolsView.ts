/**
 * symbolsView.ts -- the symbols tree (spec 5.3, ux S11): the last build's map for the active target,
 * grouped by kind, with a filter, a runtime toggle, and (while the emulator has a session) the
 * current value of byte and word variables.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { hex4 } from '../core/map';
import { planScalarReads, ScalarValue, SymbolGroup, SymbolInfo, groupSymbols, valuesFromRange } from '../core/symbols';
import { DebugController, symbolOfArg } from './debug';
import { isError } from './emuClient';

class GroupNode {
  constructor(readonly group: SymbolGroup) {}
}
class SymbolNode {
  constructor(readonly sym: SymbolInfo) {}
}
type Node = GroupNode | SymbolNode;

const ICONS: Record<string, string> = { basic: 'symbol-method', library: 'symbol-function', data: 'symbol-variable', runtime: 'symbol-misc' };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** First SUB/FUNCTION/DIM of that name in the project's sources. */
export async function findDefinition(root: string, name: string): Promise<vscode.Location | undefined> {
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(root, '**/*.bas'), '**/{build,node_modules,.git,out,dist}/**', 300);
  const n = escapeRe(name);
  const decl = new RegExp(`^\\s*(?:(?:SUB|FUNCTION)\\s+${n}\\b|(?:DIM|CONST)\\s+[^'\\n]*\\b${n}\\b)`, 'i');
  for (const u of uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath))) {
    let doc: vscode.TextDocument;
    try {
      doc = await vscode.workspace.openTextDocument(u);
    } catch {
      continue;
    }
    for (let i = 0; i < doc.lineCount; i++) {
      const t = doc.lineAt(i).text;
      if (decl.test(t)) {
        const col = t.search(new RegExp(`\\b${n}\\b`, 'i'));
        return new vscode.Location(u, new vscode.Range(i, Math.max(col, 0), i, Math.max(col, 0) + name.length));
      }
    }
  }
  return undefined;
}

export class SymbolsView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  readonly view: vscode.TreeView<Node>;
  private readonly subs: vscode.Disposable[] = [];
  runtime = false;
  filter = '';
  private values = new Map<string, ScalarValue>();
  private reading = false;

  constructor(private readonly ctl: DebugController) {
    this.view = vscode.window.createTreeView('cpcbuild.symbols', { treeDataProvider: this, showCollapseAll: true });
    this.subs.push(
      this.emitter,
      this.view,
      ctl.symbols.onDidChange(() => {
        this.values.clear();
        this.refreshChrome();
        this.emitter.fire(undefined);
        void this.refreshValues();
      }),
      ctl.onRefresh(() => void this.refreshValues()),
      this.view.onDidChangeVisibility((e) => e.visible && void this.refreshValues()),
      ctl.watching(() => this.view.visible),
    );
    this.refreshChrome();
  }

  /** Values currently shown, by map label (tests, the memory view). */
  currentValues(): ReadonlyMap<string, ScalarValue> {
    return this.values;
  }

  private refreshChrome(): void {
    const l = this.ctl.symbols.loaded;
    void vscode.commands.executeCommand('setContext', 'cpcbuild.symbols.noMap', !l);
    const bits: string[] = [];
    if (l) bits.push(l.targetId);
    if (l?.stale) bits.push('out of date');
    if (this.filter) bits.push(`filter: ${this.filter}`);
    if (this.runtime) bits.push('runtime shown');
    this.view.description = bits.join(', ') || undefined;
    this.view.message = l && this.filter && !groupSymbols(l.table, { runtime: this.runtime, filter: this.filter }).length ? `No symbols match "${this.filter}".` : undefined;
  }

  setFilter(text: string): void {
    this.filter = text.trim();
    this.refreshChrome();
    this.emitter.fire(undefined);
  }

  toggleRuntime(): boolean {
    this.runtime = !this.runtime;
    void vscode.commands.executeCommand('setContext', 'cpcbuild.symbols.runtime', this.runtime);
    this.refreshChrome();
    this.emitter.fire(undefined);
    return this.runtime;
  }

  /** Groups for the current options (the tree's root; tests read it). */
  groups(): SymbolGroup[] {
    const t = this.ctl.symbols.table;
    return t ? groupSymbols(t, { runtime: this.runtime, filter: this.filter }) : [];
  }

  getChildren(el?: Node): Node[] {
    if (!el) return this.groups().map((g) => new GroupNode(g));
    if (el instanceof GroupNode) return el.group.items.map((s) => new SymbolNode(s));
    return [];
  }

  getTreeItem(el: Node): vscode.TreeItem {
    if (el instanceof GroupNode) {
      const it = new vscode.TreeItem(`${el.group.title} (${el.group.items.length})`, el.group.kind === 'runtime' || el.group.items.length > 60 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded);
      it.id = `group:${el.group.kind}`;
      it.contextValue = 'group';
      return it;
    }
    const s = el.sym;
    const it = new vscode.TreeItem(s.name, vscode.TreeItemCollapsibleState.None);
    it.id = `sym:${s.label}@${s.addr}`;
    const v = this.values.get(s.label);
    it.description = v ? `${hex4(s.addr)}  = ${v.text}` : hex4(s.addr);
    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`\`${s.label}\` at \`${hex4(s.addr)}\`  \n`);
    md.appendText(s.size === undefined ? 'size: to the end of the program' : `size: ${s.size} byte${s.size === 1 ? '' : 's'} (to the next label)`);
    if (v) md.appendText(`\nvalue: ${v.text}`);
    it.tooltip = md;
    it.iconPath = new vscode.ThemeIcon(ICONS[s.kind] ?? 'symbol-misc');
    it.contextValue = `symbol.${s.kind}${s.kind === 'basic' || s.kind === 'data' ? '.def' : ''}`;
    it.command = { command: 'cpcbuild.memory.show', title: 'Show in memory view', arguments: [{ addr: s.addr, symbol: s.name }] };
    return it;
  }

  /** Reads the data labels' values while an emulator session exists (cheap: a few reads). */
  async refreshValues(): Promise<void> {
    const t = this.ctl.symbols.table;
    if (this.reading || !t || !this.view.visible) return;
    this.reading = true;
    try {
      const next = new Map<string, ScalarValue>();
      if (this.ctl.live) {
        for (const r of planScalarReads(t)) {
          const bytes = await this.ctl.client.readMemory(r.start, r.length);
          if (isError(bytes)) break;
          for (const [k, v] of valuesFromRange(r, bytes)) next.set(k, v);
        }
      }
      const same = next.size === this.values.size && [...next].every(([k, v]) => this.values.get(k)?.text === v.text);
      this.values = next;
      if (!same) this.emitter.fire(undefined);
    } finally {
      this.reading = false;
    }
  }

  /** The values regardless of visibility (extension-host tests). */
  async readValuesNow(): Promise<Map<string, ScalarValue>> {
    const t = this.ctl.symbols.table;
    const out = new Map<string, ScalarValue>();
    if (!t) return out;
    for (const r of planScalarReads(t)) {
      const bytes = await this.ctl.client.readMemory(r.start, r.length);
      if (isError(bytes)) break;
      for (const [k, v] of valuesFromRange(r, bytes)) out.set(k, v);
    }
    return out;
  }

  dispose(): void {
    this.subs.forEach((d) => d.dispose());
  }
}

export function registerSymbolCommands(reg: (id: string, fn: (...a: any[]) => unknown) => void, ctl: DebugController, view: SymbolsView): void {
  reg('cpcbuild.symbols.refresh', async () => {
    await ctl.symbols.reload();
    await view.refreshValues();
    const l = ctl.symbols.loaded;
    return l ? { count: l.table.symbols.length, map: l.mapFile } : { count: 0, message: ctl.symbols.missing };
  });
  reg('cpcbuild.symbols.filter', async (args?: { filter?: string }) => {
    const text = args?.filter ?? (await vscode.window.showInputBox({ title: 'CPC Game Studio: filter symbols', prompt: 'Part of a name or address (&4F2A). Empty shows everything.', value: view.filter }));
    if (text === undefined) return undefined;
    view.setFilter(text);
    return view.filter;
  });
  reg('cpcbuild.symbols.toggleRuntime', () => view.toggleRuntime());
  reg('cpcbuild.symbols.copyAddress', async (arg?: unknown) => {
    const s = symbolOfArg(arg, ctl.symbols.table);
    if (!s) return undefined;
    const text = hex4(s.addr);
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`CPC Game Studio: copied ${text} (${s.name})`, 3000);
    return text;
  });
  reg('cpcbuild.symbols.goToDefinition', async (arg?: unknown) => {
    const s = symbolOfArg(arg, ctl.symbols.table);
    const root = ctl.symbols.root;
    if (!s || !root) return undefined;
    const loc = await findDefinition(root, s.name);
    if (!loc) {
      void vscode.window.showInformationMessage(`CPC Game Studio: no SUB, FUNCTION or DIM named ${s.name} in the sources of ${path.basename(root)}.`);
      return undefined;
    }
    await vscode.window.showTextDocument(loc.uri, { selection: loc.range });
    return { file: loc.uri.fsPath, line: loc.range.start.line + 1 };
  });
}
