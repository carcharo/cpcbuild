/**
 * symbols.ts -- the zxbc map as a symbol table for the symbols view and the debug controls (spec 5.3).
 * Pure TypeScript. Naming rules, derived from real maps (src/core/fixtures/*.map):
 *
 *   ._Name                      a BASIC name: a routine in the code area, a variable/array in the data area
 *   .__NAME (`.__MUSIC_RUN`)     assembly names from the library: counted as library routines
 *   ._Name__leave               the end-of-routine label of a SUB/FUNCTION (internal)
 *   ._arr.__DATA__[.__PTR__]    the pointer and the body of an array (data)
 *   .core.NAME                  runtime (library assembly, __START_PROGRAM, ZXBASIC_USER_DATA ...)
 *   .LABEL.__LABELn             compiler-made labels (internal)
 *   .pd_bar                     labels written in the user's own inline assembly (internal)
 *
 * The data area is [.core.ZXBASIC_USER_DATA, .core.ZXBASIC_USER_DATA_END). A `._Name` routine is a
 * "library" routine when the caller's predicate says the cpcbuild/stdlib headers declare it.
 */
import { hex4, MapEntry } from './map';
import { parseAddress } from './project';

export type SymbolKind = 'basic' | 'library' | 'data' | 'runtime';

export interface SymbolInfo {
  /** As in the map: `._MoveSprites`. */
  label: string;
  /** For display: `MoveSprites`; runtime labels lose `.core.`. */
  name: string;
  addr: number;
  kind: SymbolKind;
  /** Compiler/assembler plumbing (`.LABEL.*`, `*__leave`, inline-asm labels): hidden from the main groups and from symbol+offset. */
  internal: boolean;
  /** Distance to the next label of a higher address; undefined for the last label. */
  size?: number;
  /** Data labels of 1 or 2 bytes whose value the view can show. */
  scalar?: 1 | 2;
}

export interface SymbolTable {
  symbols: SymbolInfo[];
  /** First address past the last label's likely extent (last label + 0x100): nothing above is "inside" the program. */
  end: number;
  dataStart?: number;
  dataEnd?: number;
}

export interface BuildSymbolsOptions {
  /** True for a BASIC name (no `._`, lower-cased by the caller if it likes) declared by the library headers. */
  isLibrary?: (name: string) => boolean;
}

const DATA_START = '.core.ZXBASIC_USER_DATA';
const DATA_END = '.core.ZXBASIC_USER_DATA_END';

export function buildSymbols(entries: readonly MapEntry[], opts: BuildSymbolsOptions = {}): SymbolTable {
  const dataStart = entries.find((e) => e.label === DATA_START)?.addr;
  const dataEnd = entries.find((e) => e.label === DATA_END)?.addr;
  const inData = (a: number): boolean => dataStart !== undefined && dataEnd !== undefined && a >= dataStart && a < dataEnd;
  const symbols: SymbolInfo[] = entries.map((e) => {
    const base = { label: e.label, addr: e.addr };
    if (e.label.startsWith('.core.')) return { ...base, name: e.label.slice(6), kind: 'runtime' as const, internal: false };
    if (e.label.startsWith('.LABEL.')) return { ...base, name: e.label.slice(7), kind: 'runtime' as const, internal: true };
    if (e.label.startsWith('._')) {
      const name = e.label.slice(2);
      if (name.endsWith('__leave')) return { ...base, name, kind: 'runtime' as const, internal: true };
      if (inData(e.addr)) return { ...base, name, kind: 'data' as const, internal: false };
      // `.__MUSIC_RUN`, `.__aks_x_end`: names the library's assembly (or the music converter) defines, not BASIC SUB/FUNCTION names
      if (name.startsWith('_')) return { ...base, name, kind: 'library' as const, internal: false };
      return { ...base, name, kind: opts.isLibrary?.(name) ? ('library' as const) : ('basic' as const), internal: false };
    }
    return { ...base, name: e.label.replace(/^\./, ''), kind: 'runtime' as const, internal: true };
  });
  symbols.sort((a, b) => a.addr - b.addr); // stable: the map's order decides ties
  for (let i = 0; i < symbols.length; i++) {
    let j = i + 1;
    while (j < symbols.length && symbols[j].addr === symbols[i].addr) j++;
    if (j < symbols.length) symbols[i].size = symbols[j].addr - symbols[i].addr;
    const s = symbols[i];
    if (s.kind === 'data' && !s.internal && !s.name.includes('__DATA__') && (s.size === 1 || s.size === 2)) s.scalar = s.size;
  }
  const last = symbols.length ? symbols[symbols.length - 1].addr : 0;
  return { symbols, end: Math.min(0x10000, last + 0x100), dataStart, dataEnd };
}

export const GROUP_TITLES: Record<SymbolKind, string> = {
  basic: 'BASIC routines',
  library: 'Library routines',
  data: 'Data',
  runtime: 'Runtime',
};
export const GROUP_ORDER: readonly SymbolKind[] = ['basic', 'library', 'data', 'runtime'];

export interface SymbolGroup {
  kind: SymbolKind;
  title: string;
  items: SymbolInfo[];
}

export interface GroupOptions {
  /** Show the runtime group (default false: spec 5.3 hides it behind a toggle). */
  runtime?: boolean;
  /** Case-insensitive substring of the name, label or `&ADDR`. */
  filter?: string;
}

export function matchesFilter(s: SymbolInfo, filter: string): boolean {
  const f = filter.trim().toLowerCase();
  if (!f) return true;
  return s.name.toLowerCase().includes(f) || s.label.toLowerCase().includes(f) || hex4(s.addr).toLowerCase().includes(f.replace(/^0x/, '&').replace(/^\$/, '&'));
}

/** The groups the symbols view shows. Empty groups are left out. */
export function groupSymbols(t: SymbolTable, o: GroupOptions = {}): SymbolGroup[] {
  const out: SymbolGroup[] = [];
  for (const kind of GROUP_ORDER) {
    if (kind === 'runtime' && !o.runtime) continue;
    const items = t.symbols.filter((s) => s.kind === kind && (kind === 'runtime' || !s.internal) && matchesFilter(s, o.filter ?? ''));
    if (items.length) out.push({ kind, title: GROUP_TITLES[kind], items });
  }
  return out;
}

export function findByName(t: SymbolTable, text: string): SymbolInfo | undefined {
  const n = text.trim().toLowerCase().replace(/^\./, '');
  if (!n) return undefined;
  const cand = [n, n.replace(/^_/, ''), n.replace(/^core\./, '')];
  const hit = (pred: (s: SymbolInfo) => boolean): SymbolInfo | undefined => t.symbols.find((s) => !s.internal && pred(s)) ?? t.symbols.find(pred);
  return hit((s) => s.label.toLowerCase() === '.' + n) ?? hit((s) => cand.includes(s.name.toLowerCase()));
}

export interface SymbolAt {
  symbol: SymbolInfo;
  offset: number;
}

/** The nearest named (non-internal) label at or below `addr`, or undefined when `addr` is outside the program. */
export function symbolAt(t: SymbolTable, addr: number): SymbolAt | undefined {
  if (addr >= t.end) return undefined;
  let lo = 0;
  let hi = t.symbols.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (t.symbols[mid].addr <= addr) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = best; i >= 0; i--) {
    const s = t.symbols[i];
    if (!s.internal) return { symbol: s, offset: addr - s.addr };
  }
  return undefined;
}

/** `MoveSprites+3`, `MoveSprites`, or `&4F2A` when no symbol covers it. */
export function describeAddress(t: SymbolTable | undefined, addr: number): string {
  const at = t && symbolAt(t, addr);
  if (!at) return hex4(addr);
  return at.offset ? `${at.symbol.name}+${at.offset}` : at.symbol.name;
}

export interface ResolvedTarget {
  addr: number;
  symbol?: SymbolInfo;
  /** `+n` after a symbol name. */
  offset?: number;
}

/** A user's go-to text: `&4F2A`, `0x4f2a`, `$4F2A`, decimal, `Name`, `Name+8`. */
export function resolveTarget(t: SymbolTable | undefined, text: string): ResolvedTarget | { error: string } {
  const s = text.trim();
  if (!s) return { error: 'type an address (&4F2A, 0x4F2A) or a symbol name' };
  const a = parseAddress(s);
  if (a !== undefined) return { addr: a };
  if (/^[&$]/.test(s) || /^0x/i.test(s)) return { error: `${s} is not an address from &0000 to &FFFF` };
  const m = /^(.+?)\s*\+\s*(&[0-9a-f]+|0x[0-9a-f]+|\d+)$/i.exec(s);
  const name = m ? m[1] : s;
  const off = m ? (parseAddress(m[2]) ?? 0) : 0;
  const sym = t && findByName(t, name);
  if (!sym) return { error: t ? `no symbol "${name}" in the map (build the project first, or type an address)` : `no map loaded: type an address, or build the project to use symbol names` };
  return { addr: (sym.addr + off) & 0xffff, symbol: sym, ...(m ? { offset: off } : {}) };
}

// ------------------------------------------------------------ values of data labels

export interface ScalarValue {
  value: number;
  text: string;
}

/** A byte or a little-endian word as `3 (&03)` / `1240 (&04D8)`. */
export function decodeScalar(bytes: ArrayLike<number>, size: 1 | 2): ScalarValue {
  const value = size === 1 ? bytes[0] & 0xff : (bytes[0] & 0xff) | ((bytes[1] & 0xff) << 8);
  const h = value.toString(16).toUpperCase().padStart(size * 2, '0');
  return { value, text: `${value} (&${h})` };
}

export interface ReadRange {
  start: number;
  length: number;
  items: SymbolInfo[];
}

/** Few memory reads for many scalars: nearby scalars share one read (gaps up to `gap` bytes, ranges up to `max`). */
export function planScalarReads(t: SymbolTable, gap = 256, max = 2048): ReadRange[] {
  const scalars = t.symbols.filter((s) => s.scalar);
  const out: ReadRange[] = [];
  for (const s of scalars) {
    const last = out[out.length - 1];
    const end = s.addr + (s.scalar as number);
    if (last && s.addr - (last.start + last.length) <= gap && end - last.start <= max) {
      last.length = Math.max(last.length, end - last.start);
      last.items.push(s);
    } else out.push({ start: s.addr, length: s.scalar as number, items: [s] });
  }
  return out;
}

/** Splits a range's bytes back to its symbols. Unreadable (short) data leaves the symbol out. */
export function valuesFromRange(r: ReadRange, bytes: ArrayLike<number>): Map<string, ScalarValue> {
  const m = new Map<string, ScalarValue>();
  for (const s of r.items) {
    const o = s.addr - r.start;
    const n = s.scalar as number;
    if (o + n <= bytes.length) m.set(s.label, decodeScalar([bytes[o], bytes[o + 1]], n as 1 | 2));
  }
  return m;
}
