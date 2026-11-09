/**
 * squareOps.ts -- the pure helpers of the tracker's square tools: the selection rectangle, copying a block of
 * squares, the paste, clear and transpose operations, and the texts that describe a selection. No DOM.
 */
import type { SongEvent, SongPattern } from '../../core/songDoc';
import { songNoteName } from '../../core/songDoc';
import type { CellEvent, SongOp } from '../../core/songOps';
import { CHANNEL_LETTERS, type Cursor } from './logic';

/** An inclusive block of squares: channels ch0..ch1, rows row0..row1. */
export interface Rect {
  ch0: number;
  ch1: number;
  row0: number;
  row1: number;
}

/** The block between the anchor and the cursor, or just the cursor's square when nothing is anchored. */
export function selectionRect(anchor: Cursor | null, head: Cursor): Rect {
  const a = anchor ?? head;
  return { ch0: Math.min(a.channel, head.channel), ch1: Math.max(a.channel, head.channel), row0: Math.min(a.row, head.row), row1: Math.max(a.row, head.row) };
}

export const inRect = (r: Rect, row: number, channel: number): boolean => row >= r.row0 && row <= r.row1 && channel >= r.ch0 && channel <= r.ch1;
export const rectCells = (r: Rect): number => (r.ch1 - r.ch0 + 1) * (r.row1 - r.row0 + 1);
export const isSingle = (r: Rect): boolean => rectCells(r) === 1;

/** Keeps a rect inside a pattern that shrank. */
export function clampRect(r: Rect, rows: number): Rect {
  const last = Math.max(0, rows - 1);
  return { ch0: r.ch0, ch1: r.ch1, row0: Math.min(r.row0, last), row1: Math.min(r.row1, last) };
}

/** "rows 5-12, channels A-B" (rows count from 1, as the grid names them). */
export function rectLabel(r: Rect): string {
  const rows = r.row0 === r.row1 ? `row ${r.row0 + 1}` : `rows ${r.row0 + 1}-${r.row1 + 1}`;
  const ch = r.ch0 === r.ch1 ? `channel ${CHANNEL_LETTERS[r.ch0]}` : `channels ${CHANNEL_LETTERS[r.ch0]}-${CHANNEL_LETTERS[r.ch1]}`;
  return `${rows}, ${ch}`;
}

/** Copied squares: `events[c][r]` is the content of channel c (from the block's first channel), row r (from its first row); null = empty. */
export interface Clip {
  events: (CellEvent | null)[][];
}

const cellOf = (e: SongEvent): CellEvent => {
  const c: CellEvent = { note: e.note };
  if (e.inst !== undefined) c.inst = e.inst;
  if (e.vol !== undefined) c.vol = e.vol;
  return c;
};

/** The squares of a block, as a clip. */
export function copyRect(pattern: SongPattern, r: Rect): Clip {
  const events: (CellEvent | null)[][] = [];
  for (let c = r.ch0; c <= r.ch1; c++) {
    const byRow = new Map(pattern.channels[c].map((e) => [e.row, e]));
    const col: (CellEvent | null)[] = [];
    for (let row = r.row0; row <= r.row1; row++) {
      const e = byRow.get(row);
      col.push(e ? cellOf(e) : null);
    }
    events.push(col);
  }
  return { events };
}

/** How many notes (not offs) and squares a clip holds. */
export function clipCounts(clip: Clip): { filled: number; cells: number } {
  let filled = 0;
  let cells = 0;
  for (const col of clip.events) for (const e of col) {
    cells++;
    if (e) filled++;
  }
  return { filled, cells };
}

/** The part of a clip that lands inside a pattern when pasted with its top-left square at `at`: channels and rows that fit. */
export function pasteFit(clip: Clip, at: Cursor, rows: number): { channels: number; rows: number; clipped: boolean } {
  const wantCh = clip.events.length;
  const wantRows = Math.max(0, ...clip.events.map((c) => c.length));
  const channels = Math.max(0, Math.min(wantCh, 3 - at.channel));
  const fit = Math.max(0, Math.min(wantRows, rows - at.row));
  return { channels, rows: fit, clipped: channels < wantCh || fit < wantRows };
}

/** The paste op for a clip at the cursor (clipped at the pattern's end), or undefined when the clip is empty or nothing fits. */
export function pasteOp(clip: Clip, pattern: number, at: Cursor, rows: number): SongOp | undefined {
  const fit = pasteFit(clip, at, rows);
  if (!fit.channels || !fit.rows || clipCounts(clip).cells === 0) return undefined;
  return {
    op: 'setCells',
    pattern,
    channel: at.channel,
    row: at.row,
    events: clip.events.slice(0, fit.channels).map((col) => col.slice(0, fit.rows)),
    label: 'Paste squares',
  };
}

export function clearOp(pattern: number, r: Rect): SongOp {
  return { op: 'clearRange', pattern, ch0: r.ch0, ch1: r.ch1, row0: r.row0, row1: r.row1 };
}

export function transposeOp(pattern: number, r: Rect, semitones: number): SongOp {
  return { op: 'transpose', pattern, ch0: r.ch0, ch1: r.ch1, row0: r.row0, row1: r.row1, semitones };
}

/** The clip as text for the system clipboard: one line per row, the channels tab-separated, "C-4 1", "C-4 1 v9", "off" or "-". */
export function clipText(clip: Clip): string {
  const rows = Math.max(0, ...clip.events.map((c) => c.length));
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    lines.push(
      clip.events
        .map((col) => {
          const e = col[r];
          if (!e) return '-';
          if (e.note === 'off') return 'off';
          return `${songNoteName(e.note)} ${e.inst ?? ''}${e.vol !== undefined ? ` v${e.vol}` : ''}`;
        })
        .join('\t'),
    );
  }
  return lines.join('\n');
}
