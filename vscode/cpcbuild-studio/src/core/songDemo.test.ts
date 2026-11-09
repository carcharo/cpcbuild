import { describe, expect, it } from 'vitest';
import { parseSong, serialiseSong, validateSong } from './songDoc';
import { demoSong } from './songDemo';
import { songProblems } from './vt2';

describe('demoSong', () => {
  it('is a valid song that the writer accepts and that round-trips', () => {
    const d = demoSong();
    expect(validateSong(d)).toEqual([]);
    expect(songProblems(d)).toEqual([]);
    expect(parseSong(serialiseSong(d)).doc).toEqual(d);
  });
  it('has Hi-hat on A every beat, Piano on B, Bass on C, order [0] looping at 0', () => {
    const d = demoSong();
    expect(d.order).toEqual([0]);
    expect(d.loop).toBe(0);
    expect(d.patterns[0].channels[0].map((e) => e.row)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(new Set(d.patterns[0].channels[0].map((e) => e.inst))).toEqual(new Set(['9']));
    expect(new Set(d.patterns[0].channels[1].map((e) => e.inst))).toEqual(new Set(['1']));
    expect(new Set(d.patterns[0].channels[2].map((e) => e.inst))).toEqual(new Set(['6']));
  });
});
