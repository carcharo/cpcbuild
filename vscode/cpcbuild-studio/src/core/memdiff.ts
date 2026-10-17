/**
 * memdiff.ts -- the model behind the memory view (spec 5.3): a window onto the 64 KB address space,
 * the bytes that changed since the last refresh, and the hex + ASCII rows. Pure TypeScript; the host
 * keeps the model, the webview formats rows with the same functions.
 */

export const MEM_SIZE = 0x10000;
export const BYTES_PER_ROW = 16;
export const WINDOW_ROWS = 32;
export const WINDOW_BYTES = BYTES_PER_ROW * WINDOW_ROWS;

/** Start of a window that shows `addr` in its first row, kept inside the address space (the last window ends at &FFFF). */
export function windowBase(addr: number, size = WINDOW_BYTES, perRow = BYTES_PER_ROW): number {
  const a = Math.max(0, Math.min(MEM_SIZE - 1, Math.trunc(addr)));
  const base = a - (a % perRow);
  return Math.max(0, Math.min(base, MEM_SIZE - size));
}

/** Moves a window by whole pages (negative = up), clamped to the address space. */
export function pageBase(base: number, pages: number, size = WINDOW_BYTES): number {
  return windowBase(base + pages * size, size);
}

/** Offsets (into `next`) whose byte differs from `prev`; none when the window moved or changed length (no baseline). */
export function diffBytes(prev: Uint8Array | undefined, prevBase: number, next: Uint8Array, nextBase: number): number[] {
  if (!prev || prevBase !== nextBase || prev.length !== next.length) return [];
  const out: number[] = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) out.push(i);
  return out;
}

export interface MemoryUpdate {
  base: number;
  bytes: Uint8Array;
  /** Offsets changed since the previous update of the same window. */
  changed: number[];
}

/** Keeps the previous bytes of the current window so the next update can say what changed. */
export class MemoryModel {
  base = 0;
  private last?: Uint8Array;
  private lastBase = -1;

  constructor(readonly size: number = WINDOW_BYTES) {}

  /** Moves the window; the baseline is dropped (nothing is "changed" on the first read of a new place). */
  moveTo(addr: number): number {
    const b = windowBase(addr, this.size);
    if (b !== this.base) {
      this.last = undefined;
      this.lastBase = -1;
    }
    this.base = b;
    return b;
  }

  /** Feeds the bytes just read at `this.base`. */
  update(bytes: Uint8Array): MemoryUpdate {
    const changed = diffBytes(this.last, this.lastBase, bytes, this.base);
    this.last = Uint8Array.from(bytes);
    this.lastBase = this.base;
    return { base: this.base, bytes, changed };
  }

  /** Forget the baseline (session closed or restarted). */
  reset(): void {
    this.last = undefined;
    this.lastBase = -1;
  }
}

const hex2 = (n: number): string => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');

export interface Row {
  /** `&4F20`; rows past &FFFF never exist (the window is clamped). */
  addr: string;
  start: number;
  hex: string[];
  /** Printable ASCII, `.` for the rest. */
  ascii: string;
  /** Offsets within `hex` of changed bytes. */
  changed: number[];
}

export const asciiOf = (b: number): string => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.');

/** The rows of a window; `changed` are offsets into `bytes`. */
export function formatRows(base: number, bytes: ArrayLike<number>, changed: readonly number[] = [], perRow = BYTES_PER_ROW): Row[] {
  const set = new Set(changed);
  const rows: Row[] = [];
  for (let o = 0; o < bytes.length; o += perRow) {
    const n = Math.min(perRow, bytes.length - o);
    const hx: string[] = [];
    let ascii = '';
    const ch: number[] = [];
    for (let i = 0; i < n; i++) {
      hx.push(hex2(bytes[o + i]));
      ascii += asciiOf(bytes[o + i]);
      if (set.has(o + i)) ch.push(i);
    }
    const start = base + o;
    rows.push({ addr: '&' + start.toString(16).toUpperCase().padStart(4, '0'), start, hex: hx, ascii, changed: ch });
  }
  return rows;
}

export function toBase64(b: Uint8Array): string {
  return Buffer.from(b).toString('base64');
}

/** Works in the browser (webview) and in Node. */
export function fromBase64(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(s, 'base64'));
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
