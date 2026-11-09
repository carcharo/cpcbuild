import { describe, expect, it } from 'vitest';
import { CPC_CLOCK, notePeriod } from '../webview/shared/audio/ay';
import { newSong, type SongDoc, type SongInstrument } from './songDoc';
import { rowOfTick, songToFrames } from './songFrames';

const fr = (volume: number, o: Partial<{ pitch: number; tone: boolean; noise: boolean; noisePeriod: number }> = {}) =>
  ({ pitch: 0, tone: true, noise: false, noisePeriod: 0, volume, ...o });
const inst = (id: string, frames: SongInstrument['frames'], loop?: number): SongInstrument =>
  ({ id, name: id, colour: 'blue', description: '', frames, ...(loop === undefined ? {} : { loop }) });

function song(over: Partial<SongDoc> = {}): SongDoc {
  const d = newSong();
  d.speed = 3;
  d.patterns = [{ rows: 4, channels: [[], [], []] }];
  d.instruments = [
    inst('B', [fr(15), fr(10), fr(5)]), // decays, no loop: silent after frame 2
    inst('C', [fr(12), fr(8), fr(4)], 1), // loops frames 1-2
    inst('D', [fr(15, { pitch: 0 }), fr(15, { pitch: 7 })], 0), // arpeggio, loops from 0
    inst('E', [fr(10, { tone: false, noise: true, noisePeriod: 17 })], 0),
  ];
  return Object.assign(d, over);
}

describe('songToFrames', () => {
  it('has speed ticks per row and rowAt for each', () => {
    const d = song();
    const f = songToFrames(d);
    expect(f.ticks.length).toBe(4 * 3);
    expect(f.rowAt.length).toBe(12);
    expect(rowOfTick(f, 0)).toEqual({ step: 0, pattern: 0, row: 0 });
    expect(rowOfTick(f, 2)).toEqual({ step: 0, pattern: 0, row: 0 });
    expect(rowOfTick(f, 3)).toEqual({ step: 0, pattern: 0, row: 1 });
    expect(rowOfTick(f, 11)?.row).toBe(3);
    expect(rowOfTick(f, 12)).toBeUndefined();
  });

  it('a note restarts its instrument at frame 0 with the right period', () => {
    const d = song();
    d.patterns[0].channels[0] = [{ row: 0, note: 60, inst: 'B' }, { row: 1, note: 69, inst: 'B' }];
    const f = songToFrames(d);
    expect(f.ticks[0].a).toEqual({ period: notePeriod(60, CPC_CLOCK), tone: true, noise: false, volume: 15 });
    expect(f.ticks[1].a.volume).toBe(10);
    expect(f.ticks[2].a.volume).toBe(5);
    expect(f.ticks[3].a).toEqual({ period: 142, tone: true, noise: false, volume: 15 }); // restarted on row 1
    expect(f.ticks[0].b.volume).toBe(0); // idle channel is silent
  });

  it('an instrument without a loop is silent after its last frame; with a loop it repeats from there', () => {
    const d = song();
    d.patterns[0].channels = [[{ row: 0, note: 60, inst: 'B' }], [{ row: 0, note: 60, inst: 'C' }], []];
    const f = songToFrames(d);
    expect(f.ticks.slice(0, 6).map((t) => t.a.volume)).toEqual([15, 10, 5, 0, 0, 0]);
    expect(f.ticks[3].a.tone).toBe(false);
    expect(f.ticks.slice(0, 7).map((t) => t.b.volume)).toEqual([12, 8, 4, 8, 4, 8, 4]);
  });

  it('applies the frame pitch offset (an arpeggio)', () => {
    const d = song();
    d.patterns[0].channels[2] = [{ row: 0, note: 60, inst: 'D' }];
    const f = songToFrames(d);
    expect(f.ticks.slice(0, 4).map((t) => t.c.period)).toEqual([239, notePeriod(67, CPC_CLOCK), 239, notePeriod(67, CPC_CLOCK)]);
  });

  it('note-off silences the channel until the next note', () => {
    const d = song();
    d.patterns[0].channels[0] = [{ row: 0, note: 60, inst: 'D' }, { row: 1, note: 'off' }, { row: 3, note: 60, inst: 'D' }];
    const f = songToFrames(d);
    expect(f.ticks[2].a.volume).toBe(15);
    expect(f.ticks.slice(3, 9).every((t) => t.a.volume === 0 && !t.a.tone && !t.a.noise)).toBe(true);
    expect(f.ticks[9].a.volume).toBe(15);
  });

  it('cell volume attenuates by subtraction and applies per note; absent means 15', () => {
    const d = song();
    d.patterns[0].channels[0] = [{ row: 0, note: 60, inst: 'B', vol: 12 }, { row: 1, note: 60, inst: 'B', vol: 5 }, { row: 2, note: 60, inst: 'B' }];
    const f = songToFrames(d);
    expect(f.ticks[0].a.volume).toBe(12); // 15 - 3
    expect(f.ticks[1].a.volume).toBe(7); // 10 - 3
    expect(f.ticks[2].a.volume).toBe(2); // 5 - 3
    expect(f.ticks[3].a.volume).toBe(5); // 15 - 10
    expect(f.ticks[4].a.volume).toBe(0); // 10 - 10
    expect(f.ticks[6].a.volume).toBe(15); // no vol = 15
  });

  it('the last channel (C, then B, then A) with noise on sets the shared noise period; it is held otherwise', () => {
    const d = song();
    d.instruments.push(inst('F', [fr(10, { tone: false, noise: true, noisePeriod: 5 })], 0));
    d.patterns[0].channels = [[{ row: 0, note: 60, inst: 'F' }], [{ row: 0, note: 60, inst: 'E' }], [{ row: 1, note: 60, inst: 'B' }, { row: 2, note: 60, inst: 'F' }]];
    const f = songToFrames(d);
    expect(f.ticks[0].noisePeriod).toBe(17); // B beats A
    expect(f.ticks[3].noisePeriod).toBe(17); // C has no noise: B still sets it
    expect(f.ticks[6].noisePeriod).toBe(5); // C now has noise
    expect(f.ticks[0].a.noise && f.ticks[0].b.noise).toBe(true);
  });

  it('the order loop tick is the first tick of the loop step; the song plays the order once', () => {
    const d = song({ order: [0, 0, 0], loop: 1 });
    const f = songToFrames(d);
    expect(f.ticks.length).toBe(36);
    expect(f.loopTick).toBe(12);
    expect(rowOfTick(f, 12)).toEqual({ step: 1, pattern: 0, row: 0 });
    expect(songToFrames(song()).loopTick).toBe(0);
  });

  it('starts at a step and row; a loop point before the start is appended so the jump has a target', () => {
    const d = song({ order: [0, 0, 0], loop: 0 });
    const f = songToFrames(d, { startStep: 2, startRow: 2 });
    expect(f.ticks.length).toBe(2 * 3 + 36);
    expect(rowOfTick(f, 0)).toEqual({ step: 2, pattern: 0, row: 2 });
    expect(f.loopTick).toBe(6);
    expect(rowOfTick(f, 6)).toEqual({ step: 0, pattern: 0, row: 0 });
    const g = songToFrames(d, { startStep: 1 });
    expect(g.loopTick).toBe(24);
  });

  it('maxTicks cuts the song off; a loop step never reached gives -1', () => {
    const d = song({ order: [0, 0, 0], loop: 2 });
    const f = songToFrames(d, { maxTicks: 20 });
    expect(f.ticks.length).toBe(20);
    expect(f.loopTick).toBe(-1);
  });

  it('a ringing note carries across patterns', () => {
    const d = song({ order: [0, 0] });
    d.instruments.push(inst('G', [fr(9)], 0));
    d.patterns[0].channels[0] = [{ row: 3, note: 60, inst: 'G' }];
    const f = songToFrames(d);
    expect(f.ticks[12].a.volume).toBe(9); // row 0 of the second pass, no new note
  });
});
