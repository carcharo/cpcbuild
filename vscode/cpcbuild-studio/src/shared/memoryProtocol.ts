/**
 * memoryProtocol.ts -- host <-> webview messages of the memory view (spec 5.3, ux S9).
 * The host owns the session, the symbols and the diff model; the webview only draws rows
 * (src/core/memdiff.ts formats them) and sends what the user asked for.
 */

export interface MemSnapshot {
  /** Address of the first byte (always a multiple of 16). */
  base: number;
  /** base64 of the window's bytes. */
  bytes: string;
  /** Offsets (into the window) that differ from the previous refresh of the same window. */
  changed: number[];
  /** Row index -> symbol names that start inside that row. */
  rowNames: Record<number, string>;
  /** What the go-to box shows: the symbol being followed, else the address. */
  target: string;
  /** Set while the window follows a symbol (it moves with the symbol after a rebuild). */
  following?: string;
  pc?: number;
  sp?: number;
}

export type MemStatus = {
  /** A session exists. */
  live: boolean;
  paused: boolean;
  /** The one-line status ("Paused at MoveSprites+3", "Running", "Session ended"). */
  text: string;
  /** The values shown are from a session that has ended. */
  stale?: boolean;
};

export type MemEmpty = { title: string; text: string; action?: { label: string; command: string } };

export type MemHostMsg =
  | { type: 'snapshot'; snap: MemSnapshot; status: MemStatus }
  | { type: 'status'; status: MemStatus }
  | { type: 'empty'; empty: MemEmpty; status: MemStatus }
  | { type: 'notice'; severity: 'info' | 'warning' | 'error'; text: string };

export type MemControl = 'pause' | 'resume' | 'step' | 'stepOver' | 'stepOut';

export type MemWebMsg =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'goto'; text: string }
  | { type: 'page'; pages: number }
  | { type: 'refresh' }
  | { type: 'control'; cmd: MemControl }
  | { type: 'command'; command: string }
  | { type: 'copy'; text: string };

export const MEM_CONTROLS: readonly MemControl[] = ['pause', 'resume', 'step', 'stepOver', 'stepOut'];

/**
 * The webview is untrusted input: this returns the message only when its shape is exactly one of
 * MemWebMsg (control commands from the fixed list, integers for pages, strings of sane length), else undefined.
 */
export function parseMemWebMsg(raw: unknown): MemWebMsg | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
    case 'refresh':
      return { type: m.type };
    case 'error':
      return { type: 'error', message: String(m.message).slice(0, 2000) };
    case 'goto':
      return typeof m.text === 'string' && m.text.length <= 200 ? { type: 'goto', text: m.text } : undefined;
    case 'page':
      return typeof m.pages === 'number' && Number.isInteger(m.pages) && Math.abs(m.pages) <= 4096 ? { type: 'page', pages: m.pages } : undefined;
    case 'control':
      return typeof m.cmd === 'string' && (MEM_CONTROLS as readonly string[]).includes(m.cmd) ? { type: 'control', cmd: m.cmd as MemControl } : undefined;
    case 'command':
      return typeof m.command === 'string' && m.command.length <= 100 ? { type: 'command', command: m.command } : undefined;
    case 'copy':
      return typeof m.text === 'string' && m.text.length <= 200000 ? { type: 'copy', text: m.text } : undefined;
    default:
      return undefined;
  }
}
