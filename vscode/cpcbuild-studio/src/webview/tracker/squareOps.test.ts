import { describe, expect, it } from 'vitest';
import type { SongDoc, SongPattern } from '../../core/songDoc';
import { newSong } from '../../core/songDoc';
import { applySongOp } from '../../core/songOps';
import { cellName } from './logic';
import { clampRect, clearOp, clipCounts, clipText, copyRect, inRect, isSingle, pasteFit, pasteOp, rectCells, rectLabel, selectionRect, transposeOp } from './squareOps';

const pat: SongPattern = {
  rows: 8,
  channels: [
    [{ row: 0, note: 60, inst: '1' }, { row: 2, note: 64, inst: '1', vol: 9 }, { row: 4, note: 'off' }],
    [{ row: 1, note: 48, inst: '6' }],
    [{ row: 7, note: 36, inst: '7' }],
  ],
};
const song = (): SongDoc => ({ ...newSong(), patterns: [pat, { rows: 4, channels: [[], [], []] }], order: [0, 1] });

describe('selection', () => {
  it('is the block between the anchor and the cursor, in either direction; no anchor = the cursor square', () => {
    expect(selectionRect({ row: 5, channel: 2 }, { row: 2, channel: 1 })).toEqual({ ch0: 1, ch1: 2, row0: 2, row1: 5 });
    expect(selectionRect(null, { row: 3, channel: 1 })).toEqual({ ch0: 1, ch1: 1, row0: 3, row1: 3 });
    expect(isSingle(selectionRect(null, { row: 3, channel: 1 }))).toBe(true);
    expect(rectCells(selectionRect({ row: 0, channel: 0 }, { row: 3, channel: 1 }))).toBe(8);
  });
  it('inRect is inclusive', () => {
    const r = selectionRect({ row: 2, channel: 0 }, { row: 4, channel: 1 });
    expect(inRect(r, 2, 0)).toBe(true);
    expect(inRect(r, 4, 1)).toBe(true);
    expect(inRect(r, 5, 1)).toBe(false);
    expect(inRect(r, 3, 2)).toBe(false);
  });
  it('clampRect follows a pattern that got shorter; labels count rows from 1', () => {
    expect(clampRect({ ch0: 0, ch1: 1, row0: 2, row1: 20 }, 8)).toEqual({ ch0: 0, ch1: 1, row0: 2, row1: 7 });
    expect(rectLabel({ ch0: 0, ch1: 1, row0: 4, row1: 11 })).toBe('rows 5-12, channels A-B');
    expect(rectLabel({ ch0: 2, ch1: 2, row0: 0, row1: 0 })).toBe('row 1, channel C');
  });
  it('a selected square says so in its accessible name', () => {
    expect(cellName(1, 1, undefined, { instruments: [] }, true)).toBe('Row 2, channel B: empty, selected');
    expect(cellName(1, 1, undefined, { instruments: [] })).toBe('Row 2, channel B: empty');
  });
});

describe('copy and paste', () => {
  it('copies a block with its holes, volumes and offs', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 1, row0: 0, row1: 4 });
    expect(c.events).toHaveLength(2);
    expect(c.events[0]).toEqual([{ note: 60, inst: '1' }, null, { note: 64, inst: '1', vol: 9 }, null, { note: 'off' }]);
    expect(c.events[1]).toEqual([null, { note: 48, inst: '6' }, null, null, null]);
    expect(clipCounts(c)).toEqual({ filled: 4, cells: 10 });
  });
  it('a paste inside the pattern lands in full', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 0, row0: 0, row1: 2 });
    expect(pasteFit(c, { row: 4, channel: 1 }, 8)).toEqual({ channels: 1, rows: 3, clipped: false });
    const op = pasteOp(c, 0, { row: 4, channel: 1 }, 8)!;
    const r = applySongOp(song(), op);
    if ('error' in r) throw new Error(r.error);
    expect(r.state.patterns[0].channels[1].map((e) => [e.row, e.note])).toEqual([[1, 48], [4, 60], [6, 64]]);
    expect(r.label).toBe('Paste squares');
  });
  it('a paste is clipped at the end of the pattern and at channel C', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 1, row0: 0, row1: 4 });
    expect(pasteFit(c, { row: 6, channel: 2 }, 8)).toEqual({ channels: 1, rows: 2, clipped: true });
    const op = pasteOp(c, 0, { row: 6, channel: 2 }, 8)!;
    expect(op).toMatchObject({ op: 'setCells', channel: 2, row: 6 });
    if (op.op !== 'setCells') throw new Error('not setCells');
    expect(op.events).toHaveLength(1);
    expect(op.events[0]).toHaveLength(2);
    const r = applySongOp(song(), op);
    if ('error' in r) throw new Error(r.error);
    // channel C keeps its row-7 note replaced by the pasted second row (empty), the first pasted row (60) lands on row 6
    expect(r.state.patterns[0].channels[2]).toEqual([{ row: 6, note: 60, inst: '1' }]);
    expect(r.state.patterns[0].channels[1]).toEqual(pat.channels[1]); // nothing spilled into other channels
  });
  it('a paste into the last row only shows one row; nothing fits past the end', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 0, row0: 0, row1: 3 });
    expect(pasteFit(c, { row: 7, channel: 0 }, 8).rows).toBe(1);
    expect(pasteFit(c, { row: 8, channel: 0 }, 8).rows).toBe(0);
    expect(pasteOp(c, 0, { row: 8, channel: 0 }, 8)).toBeUndefined();
    expect(pasteOp({ events: [] }, 0, { row: 0, channel: 0 }, 8)).toBeUndefined();
  });
  it('pasting into another pattern works through the op', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 0, row0: 0, row1: 3 });
    const r = applySongOp(song(), pasteOp(c, 1, { row: 2, channel: 0 }, 4)!);
    if ('error' in r) throw new Error(r.error);
    expect(r.state.patterns[1].channels[0].map((e) => e.row)).toEqual([2]); // rows 2 and 3 fit: the note on pasted row 0 (60), row 2 clipped
  });
  it('the system clipboard text: a line per row, channels tab-separated', () => {
    const c = copyRect(pat, { ch0: 0, ch1: 1, row0: 0, row1: 4 });
    expect(clipText(c).split('\n')).toEqual(['C-4 1\t-', '-\tC-3 6', 'E-4 1 v9\t-', '-\t-', 'off\t-']);
  });
});

describe('clear and transpose through the ops', () => {
  it('clearOp clears the block', () => {
    const r = applySongOp(song(), clearOp(0, { ch0: 0, ch1: 1, row0: 0, row1: 2 }));
    if ('error' in r) throw new Error(r.error);
    expect(r.state.patterns[0].channels[0].map((e) => e.row)).toEqual([4]);
    expect(r.state.patterns[0].channels[1]).toEqual([]);
    expect(r.state.patterns[0].channels[2]).toEqual(pat.channels[2]);
  });
  it('transposeOp moves notes, leaves offs, clamps at the ends', () => {
    const r = applySongOp(song(), transposeOp(0, { ch0: 0, ch1: 0, row0: 0, row1: 4 }, 12));
    if ('error' in r) throw new Error(r.error);
    expect(r.state.patterns[0].channels[0]).toEqual([{ row: 0, note: 72, inst: '1' }, { row: 2, note: 76, inst: '1', vol: 9 }, { row: 4, note: 'off' }]);
    const low = applySongOp(song(), transposeOp(0, { ch0: 2, ch1: 2, row0: 7, row1: 7 }, -24));
    if ('error' in low) throw new Error(low.error);
    expect(low.state.patterns[0].channels[2][0].note).toBe(24); // clamped at C-1
  });
  it('nothing to change is reported as unchanged (the editor stays quiet about it)', () => {
    const r = applySongOp(song(), transposeOp(1, { ch0: 0, ch1: 2, row0: 0, row1: 3 }, 1));
    expect(r).toEqual({ error: 'unchanged' });
    expect(applySongOp(song(), clearOp(1, { ch0: 0, ch1: 2, row0: 0, row1: 3 }))).toEqual({ error: 'unchanged' });
  });
});
