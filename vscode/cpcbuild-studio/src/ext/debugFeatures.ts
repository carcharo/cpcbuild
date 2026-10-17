/**
 * debugFeatures.ts -- wires the live views and the debug controls (symbols, registers, breakpoints,
 * memory view, status bar) into activation. Everything reaches the emulator through the
 * cpcbuild.emu.* commands (EmuClient); nothing of cpcbuild-emu is imported.
 */
import * as vscode from 'vscode';
import type { EmuEvent } from '../emuApi';
import type { BreakpointRec, RegisterRow } from '../core/debugModel';
import type { SymbolTable } from '../core/symbols';
import { BreakpointsView, DebugController, registerDebugCommands, RegistersView } from './debug';
import { MemoryView, ShowArgs } from './memoryView';
import { onSessionOpened } from './run';
import { registerSymbolCommands, SymbolsView } from './symbolsView';
import type { MemSnapshot } from '../shared/memoryProtocol';
import type { ScalarValue } from '../core/symbols';

/** What the extension-host tests (and only they) use; not a public API. */
export interface DebugApi {
  onEvent(ev: EmuEvent): void;
  /** The status bar item's text ("$(debug-pause) CPC paused at Name+3"); empty when hidden. */
  statusLine(): string;
  live(): boolean;
  paused(): boolean;
  /** The registers view's rows (empty unless paused). */
  registers(): RegisterRow[];
  breakpoints(): BreakpointRec[];
  symbols(): SymbolTable | undefined;
  reloadSymbols(): Promise<void>;
  /** The one map file the symbol source watches (the active target's), if any. */
  watchedMap(): string | undefined;
  /** The memory view model: moves the window (address or symbol), reads, returns the snapshot. */
  memoryShow(arg: ShowArgs | string): Promise<MemSnapshot | undefined>;
  memorySnapshot(): MemSnapshot | undefined;
  /** How many times the memory webview started, and its uncaught errors. */
  memoryStats(): { ready: number; errors: string[] };
  /** Current values of the byte/word data labels, read now (by map label). */
  symbolValues(): Promise<Map<string, ScalarValue>>;
  symbolGroups(): { kind: string; title: string; names: string[] }[];
  poll(): Promise<void>;
}

export function registerDebugFeatures(context: vscode.ExtensionContext, reg: (id: string, fn: (...a: any[]) => unknown) => void): DebugApi {
  void vscode.commands.executeCommand('setContext', 'cpcbuild.active', true);
  const ctl = new DebugController(context);
  const symbolsView = new SymbolsView(ctl);
  const registers = new RegistersView(ctl);
  const breakpoints = new BreakpointsView(ctl);
  const memory = new MemoryView(context, ctl);
  context.subscriptions.push(ctl, symbolsView, registers, breakpoints, memory);

  registerSymbolCommands(reg, ctl, symbolsView);
  registerDebugCommands(reg, ctl);
  reg('cpcbuild.memory.show', (arg?: ShowArgs | string) => memory.show(arg));
  onSessionOpened((session) => ctl.onOpened(session));
  context.subscriptions.push({ dispose: () => onSessionOpened(undefined) });

  return {
    onEvent: (ev) => ctl.onEvent(ev),
    statusLine: () => ctl.statusLine(),
    live: () => ctl.live,
    paused: () => !!ctl.state?.paused,
    registers: () => ctl.registers(),
    breakpoints: () => ctl.breakpoints(),
    symbols: () => ctl.symbols.table,
    reloadSymbols: () => ctl.symbols.reload(),
    watchedMap: () => ctl.symbols.watchedMap,
    memoryShow: (arg) => memory.show(arg),
    memorySnapshot: () => memory.snapshot,
    memoryStats: () => memory.stats,
    symbolValues: () => symbolsView.readValuesNow(),
    symbolGroups: () => symbolsView.groups().map((g) => ({ kind: g.kind, title: g.title, names: g.items.map((s) => s.name) })),
    poll: async () => void (await ctl.poll('timer')),
  };
}
