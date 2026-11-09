/**
 * debugModel.ts -- the pure parts of the debug controls: the persisted breakpoint list, the register
 * rows, the status-bar text. No vscode import (vitest).
 */
import type { EmuState } from '../emuApi';
import { hex4 } from './map';
import { describeAddress, symbolAt, SymbolTable } from './symbols';

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

// ---------------------------------------------------------------------------------- CPU panel (R6)

/** The F register as booleans (S Z H P/V N C; the undocumented Y and X bits are left out of the panel). */
export interface FlagBits {
  s: boolean;
  z: boolean;
  h: boolean;
  pv: boolean;
  n: boolean;
  c: boolean;
}

export function flagBits(f: number): FlagBits {
  return { s: !!(f & 0x80), z: !!(f & 0x40), h: !!(f & 0x10), pv: !!(f & 0x04), n: !!(f & 0x02), c: !!(f & 0x01) };
}

export interface CpuReg {
  name: string;
  /** The raw number (16-bit, or 8-bit for I and R, or 0-2 for IM, 0/1 for IFF1). */
  value: number;
  /** `&4F2A`, `&2A`, `2`, `on`. */
  text: string;
  /** `describeAddress` text, only when the value falls inside a mapped symbol's range. */
  note?: string;
  /** Differs from the snapshot before the last step (only ever set after a step command). */
  changed: boolean;
  /** The row offers "Show &XXXX in memory" (PC SP BC DE HL IX IY). */
  goto: boolean;
}

export interface CpuFlag {
  /** `S`, `Z`, `H`, `P/V`, `N`, `C`. */
  name: string;
  /** Spoken name: `Zero`. */
  title: string;
  set: boolean;
  changed: boolean;
}

export interface CpuModel {
  main: CpuReg[];
  flags: CpuFlag[];
  /** I, R, IM, IFF1. */
  cpu: CpuReg[];
  /** AF' BC' DE' HL'. */
  alt: CpuReg[];
  /** How many alternate registers changed (the fold's summary says "2 changed"). */
  altChanged: number;
  /** Whether the "changed" marks mean anything: the snapshot follows a step command. */
  stepped: boolean;
}

/** A 16-bit value's note: the symbol (with offset) only when a mapped symbol's range holds it. */
export function rangeNote(table: SymbolTable | undefined, value: number): string | undefined {
  const at = table && symbolAt(table, value & 0xffff);
  if (!at) return undefined;
  return at.offset ? `${at.symbol.name}+${at.offset}` : at.symbol.name;
}

const FLAG_NAMES: readonly (readonly [keyof FlagBits, string, string])[] = [
  ['s', 'S', 'Sign'], ['z', 'Z', 'Zero'], ['h', 'H', 'Half carry'], ['pv', 'P/V', 'Parity or overflow'], ['n', 'N', 'Subtract'], ['c', 'C', 'Carry'],
];

/**
 * The CPU panel's rows. `prev` is the state before the last step; `stepped` says the snapshot follows a step command
 * (step, step over, step out), the only time a "changed" mark is shown (not after a plain pause or resume).
 */
export function cpuModel(state: EmuState, prev: EmuState | undefined, table: SymbolTable | undefined, stepped: boolean): CpuModel {
  const cmp = stepped && !!prev;
  const diff = (k: keyof EmuState): boolean => cmp && prev![k] !== state[k];
  const reg16 = (name: string, k: keyof EmuState, goto: boolean, note: boolean): CpuReg => {
    const value = (state[k] as number) & 0xffff;
    const n = note ? rangeNote(table, value) : undefined;
    return { name, value, text: w(value), ...(n ? { note: n } : {}), changed: diff(k), goto };
  };
  const main: CpuReg[] = [
    reg16('PC', 'pc', true, true),
    reg16('SP', 'sp', true, true),
    reg16('AF', 'af', false, false),
    reg16('BC', 'bc', true, true),
    reg16('DE', 'de', true, true),
    reg16('HL', 'hl', true, true),
    reg16('IX', 'ix', true, true),
    reg16('IY', 'iy', true, true),
  ];
  const fNow = flagBits(state.af & 0xff);
  const fPrev = cmp ? flagBits(prev!.af & 0xff) : fNow;
  const flags: CpuFlag[] = FLAG_NAMES.map(([k, name, title]) => ({ name, title, set: fNow[k], changed: cmp && fNow[k] !== fPrev[k] }));
  const small = (name: string, k: keyof EmuState, text: string): CpuReg => ({ name, value: state[k] as number, text, changed: diff(k), goto: false });
  const cpu: CpuReg[] = [
    small('I', 'i', b(state.i)),
    small('R', 'r', b(state.r)),
    small('IM', 'im', String(state.im)),
    small('IFF1', 'iff1', state.iff1 ? 'on' : 'off'),
  ];
  const alt: CpuReg[] = [reg16("AF'", 'af2', false, false), reg16("BC'", 'bc2', false, false), reg16("DE'", 'de2', false, false), reg16("HL'", 'hl2', false, false)];
  return { main, flags, cpu, alt, altChanged: alt.filter((r) => r.changed).length, stepped: cmp };
}

export const STACK_WORDS = 8;

/** Where to read the top of the stack: 16 bytes at SP, clamped so `addr + length <= 0x10000`; `skip` bytes of the read come before SP. */
export function stackRange(sp: number): { addr: number; length: number; skip: number } {
  const a = sp & 0xffff;
  const addr = Math.min(a, 0x10000 - STACK_WORDS * 2);
  return { addr, length: STACK_WORDS * 2, skip: a - addr };
}

export interface StackRow {
  addr: number;
  /** The little-endian word at `addr`. */
  word: number;
  /** `return address? Name+3`, only when the word points into a mapped symbol's range. */
  note?: string;
}

/** The top words of the stack from the bytes read at SP (little-endian); no word runs past &FFFF, so near the top of memory there are fewer. */
export function stackRows(sp: number, bytes: ArrayLike<number>, table: SymbolTable | undefined): StackRow[] {
  const base = sp & 0xffff;
  const rows: StackRow[] = [];
  for (let i = 0; i < STACK_WORDS; i++) {
    const o = i * 2;
    if (o + 1 >= bytes.length || base + o + 1 > 0xffff) break;
    const word = (bytes[o] & 0xff) | ((bytes[o + 1] & 0xff) << 8);
    const n = rangeNote(table, word);
    rows.push({ addr: base + o, word, ...(n ? { note: `return address? ${n}` } : {}) });
  }
  return rows;
}

/** One recent go-to target: the text that goes back into the go-to box, and the address it resolved to. */
export interface RecentRec {
  addr: number;
  text: string;
}

export const RECENT_MAX = 5;

/** The new target goes first; an earlier entry for the same address is dropped; the list keeps the last five distinct. */
export function pushRecent(list: readonly RecentRec[], rec: RecentRec, max = RECENT_MAX): RecentRec[] {
  return [rec, ...list.filter((r) => r.addr !== rec.addr)].slice(0, max);
}

/** Same registers (the frame counter and the pause reason do not count). */
export function sameRegs(a: EmuState, b: EmuState): boolean {
  const keys: (keyof EmuState)[] = ['pc', 'sp', 'af', 'bc', 'de', 'hl', 'ix', 'iy', 'af2', 'bc2', 'de2', 'hl2', 'i', 'r', 'im', 'iff1'];
  return keys.every((k) => a[k] === b[k]);
}
