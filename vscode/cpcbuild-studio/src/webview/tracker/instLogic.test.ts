import { describe, expect, it } from 'vitest';
import { newSong, type SongDoc, type SongFrame, type SongInstrument } from '../../core/songDoc';
import { deleteFramePatch, durationLabel, insertFramePatch, instrumentNameProblem, instrumentUsage, loopSummary, loopText, nextCustomId, parseLoopText, replaceFrames, resizePatch, usageLabel } from './instLogic';

const fr = (volume: number, pitch = 0): SongFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume });
const inst = (n: number, loop?: number): SongInstrument => ({ id: 'B', name: 'Test', colour: 'peach', description: '', frames: Array.from({ length: n }, (_, i) => fr(i)), ...(loop === undefined ? {} : { loop }) });

describe('lengths and times', () => {
  it('ticks are 20 ms', () => {
    expect(durationLabel(16)).toBe('16 ticks = 320 ms at 50 Hz');
    expect(durationLabel(1)).toBe('1 tick = 20 ms at 50 Hz');
  });
  it('says what happens at the end', () => {
    expect(loopSummary(inst(8))).toBe('Plays once, then stops');
    expect(loopSummary(inst(8, 3))).toBe('Loops from tick 4 to tick 8');
    expect(loopSummary(inst(8, 7))).toBe('Holds tick 8');
  });
});

describe('ids and usage', () => {
  it('nextCustomId takes the first free of B-V', () => {
    expect(nextCustomId([])).toBe('B');
    expect(nextCustomId([{ id: 'B' }, { id: 'D' }])).toBe('C');
    expect(nextCustomId('BCDEFGHIJKLMNOPQRSTUV'.split('').map((id) => ({ id })))).toBeUndefined();
  });
  it('counts notes and patterns', () => {
    const d: SongDoc = newSong();
    d.instruments = [inst(4)];
    d.patterns = [
      { rows: 8, channels: [[{ row: 0, note: 60, inst: 'B' }, { row: 4, note: 'off' }], [{ row: 1, note: 62, inst: 'B' }], []] },
      { rows: 8, channels: [[{ row: 0, note: 60, inst: '1' }], [], []] },
      { rows: 8, channels: [[], [], [{ row: 2, note: 50, inst: 'B' }]] },
    ];
    expect(instrumentUsage(d, 'B')).toEqual({ notes: 3, patterns: 2 });
    expect(instrumentUsage(d, '1')).toEqual({ notes: 1, patterns: 1 });
    expect(instrumentUsage(d, 'C')).toEqual({ notes: 0, patterns: 0 });
    expect(usageLabel({ notes: 3, patterns: 2 })).toBe('used 3 times in 2 patterns');
    expect(usageLabel({ notes: 1, patterns: 1 })).toBe('used 1 time in 1 pattern');
    expect(usageLabel({ notes: 0, patterns: 0 })).toBe('not used yet');
  });
});

describe('frame edits keep the loop valid', () => {
  it('replaceFrames writes the changed run into a copy', () => {
    const a = inst(4).frames;
    const out = replaceFrames(a, 1, [fr(9), fr(8)]);
    expect(out.map((x) => x.volume)).toEqual([0, 9, 8, 3]);
    expect(a.map((x) => x.volume)).toEqual([0, 1, 2, 3]);
    expect(replaceFrames(a, 3, [fr(7), fr(7)]).length).toBe(4); // never longer
  });
  it('insert copies the frame after it; a later loop start moves', () => {
    const p = insertFramePatch(inst(4, 2), 1)!;
    expect(p.frames!.map((x) => x.volume)).toEqual([0, 1, 1, 2, 3]);
    expect(p.loop).toBe(3);
    expect(insertFramePatch(inst(4, 1), 1)!.loop).toBeUndefined(); // the loop frame itself did not move
    expect(insertFramePatch(inst(128), 0)).toBeUndefined();
  });
  it('delete removes it; the loop follows or goes', () => {
    const p = deleteFramePatch(inst(4, 2), 0)!;
    expect(p.frames!.map((x) => x.volume)).toEqual([1, 2, 3]);
    expect(p.loop).toBe(1);
    expect(deleteFramePatch(inst(4, 3), 3)!.loop).toBeNull();
    expect(deleteFramePatch(inst(1), 0)).toBeUndefined();
  });
  it('resize repeats the last frame or cuts, and drops a loop that no longer fits', () => {
    expect(resizePatch(inst(3), 5)!.frames!.map((x) => x.volume)).toEqual([0, 1, 2, 2, 2]);
    const cut = resizePatch(inst(6, 4), 4)!;
    expect(cut.frames!.length).toBe(4);
    expect(cut.loop).toBeNull();
    expect(resizePatch(inst(6, 2), 4)!.loop).toBeUndefined();
    expect(resizePatch(inst(3), 3)).toBeUndefined();
    expect(resizePatch(inst(3), 129)).toBeUndefined();
    expect(resizePatch(inst(3), 0)).toBeUndefined();
  });
});

describe('the loop field', () => {
  it('reads none, empty and tick numbers counted from 1', () => {
    expect(parseLoopText('none', 16)).toEqual({ loop: null });
    expect(parseLoopText('  ', 16)).toEqual({ loop: null });
    expect(parseLoopText('9', 16)).toEqual({ loop: 8 });
    expect(parseLoopText('16', 16)).toEqual({ loop: 15 });
    expect(parseLoopText('0', 16)).toEqual({ error: 'Enter a tick from 1 to 16, or none' });
    expect(parseLoopText('17', 16)).toEqual({ error: 'Enter a tick from 1 to 16, or none' });
    expect(parseLoopText('x', 16)).toEqual({ error: 'Enter a tick number, or none' });
    expect(parseLoopText('2.5', 16)).toEqual({ error: 'Enter a tick number, or none' });
  });
  it('shows the loop start from 1', () => {
    expect(loopText(undefined)).toBe('none');
    expect(loopText(8)).toBe('9');
  });
  it('names: not empty, not too long', () => {
    expect(instrumentNameProblem('')).toBeDefined();
    expect(instrumentNameProblem('  ')).toBeDefined();
    expect(instrumentNameProblem('x'.repeat(25))).toBeDefined();
    expect(instrumentNameProblem('Pluck')).toBeUndefined();
  });
});
