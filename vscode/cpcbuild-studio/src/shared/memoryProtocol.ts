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
