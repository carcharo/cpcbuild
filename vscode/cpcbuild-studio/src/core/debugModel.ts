/**
 * debugModel.ts -- the pure parts of the debug controls: the persisted breakpoint list, the register
 * rows, the status-bar text. No vscode import (vitest).
 */
import type { EmuState } from '../emuApi';
import { hex4 } from './map';
import { describeAddress, SymbolTable } from './symbols';

/** A breakpoint as persisted (per project, in workspace state). `symbol` + `offset` let it follow a rebuilt map. */
export interface BreakpointRec {
  addr: number;
  symbol?: string;
  offset?: number;
}

export function sameBreakpoint(a: BreakpointRec, b: BreakpointRec): boolean {
  return a.addr === b.addr;
}

/** Adds the breakpoint, or removes it when one is already at that address. */
export function toggleBreakpoint(list: readonly BreakpointRec[], rec: BreakpointRec): { list: BreakpointRec[]; added: boolean } {
  const i = list.findIndex((b) => sameBreakpoint(b, rec));
  if (i >= 0) return { list: list.filter((_, j) => j !== i), added: false };
  return { list: [...list, rec].sort((a, b) => a.addr - b.addr), added: true };
}

/** After a rebuild: a breakpoint that was set on a symbol moves with it; others (and symbols that vanished) keep their address. */
export function reresolve(list: readonly BreakpointRec[], table: SymbolTable | undefined, find: (t: SymbolTable, name: string) => number | undefined): BreakpointRec[] {
  if (!table) return [...list];
  const out: BreakpointRec[] = [];
  for (const b of list) {
    const base = b.symbol ? find(table, b.symbol) : undefined;
    const addr = base === undefined ? b.addr : (base + (b.offset ?? 0)) & 0xffff;
    if (!out.some((o) => o.addr === addr)) out.push({ ...b, addr });
  }
  return out.sort((a, b) => a.addr - b.addr);
}

/** `Name`, `Name+3` or `&4F2A` for a list entry. */
export function breakpointText(b: BreakpointRec): string {
  if (b.symbol) return b.offset ? `${b.symbol}+${b.offset}` : b.symbol;
  return hex4(b.addr);
}

/** Status-bar text for the session state. */
export function statusText(state: EmuState | undefined, table: SymbolTable | undefined): string {
  if (!state) return '';
  if (state.paused) return `CPC paused at ${describeAddress(table, state.pc)}`;
  return 'CPC running';
}

/** F register as letters: S Z Y H X P N C, `-` for a clear flag (Y and X are the undocumented bits 5 and 3). */
export function flagsText(f: number): string {
  const names = 'SZYHXPNC';
  let out = '';
  for (let i = 0; i < 8; i++) out += f & (0x80 >> i) ? names[i] : '-';
  return out;
}

export interface RegisterRow {
  name: string;
  value: string;
  note?: string;
}

const w = (n: number): string => '&' + (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
const b = (n: number): string => '&' + (n & 0xff).toString(16).toUpperCase().padStart(2, '0');

/** The registers panel: main set, index/pointer registers, the shadow set, and the interrupt state. */
export function registerRows(s: EmuState, table?: SymbolTable): RegisterRow[] {
  return [
    { name: 'PC', value: w(s.pc), note: describeAddress(table, s.pc) },
    { name: 'SP', value: w(s.sp) },
    { name: 'AF', value: w(s.af), note: flagsText(s.af & 0xff) },
    { name: 'BC', value: w(s.bc) },
    { name: 'DE', value: w(s.de) },
    { name: 'HL', value: w(s.hl) },
    { name: 'IX', value: w(s.ix) },
    { name: 'IY', value: w(s.iy) },
    { name: "AF'", value: w(s.af2), note: flagsText(s.af2 & 0xff) },
    { name: "BC'", value: w(s.bc2) },
    { name: "DE'", value: w(s.de2) },
    { name: "HL'", value: w(s.hl2) },
    { name: 'I', value: b(s.i) },
    { name: 'R', value: b(s.r) },
    { name: 'IM', value: String(s.im) },
    { name: 'IFF1', value: s.iff1 ? 'on' : 'off' },
  ];
}

export function reasonText(reason: EmuState['reason']): string {
  switch (reason) {
    case 'breakpoint': return 'stopped at a breakpoint';
    case 'step': return 'stepped';
    case 'user': return 'paused by you';
    case 'halted': return 'the CPU is halted';
    default: return 'paused';
  }
}
