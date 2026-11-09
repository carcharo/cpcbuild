import { describe, expect, it } from 'vitest';
import { MAX_OFFSET, clamp, fitOffsetRange, moveLoop, nudge, offsetLabel, paintFlags, paintLine, setLane, yToOffset, type LaneFrame } from './curve';
import * as sfxView from '../../sfx/curve';

const f = (pitch = 0, volume = 15): LaneFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume });

describe('the sfx editor reads the same lane maths', () => {
  it('re-exports the shared helpers (one implementation)', () => {
    expect(sfxView.paintLine).toBeTypeOf('function');
    expect(sfxView.nudge).toBe(nudge);
    expect(sfxView.paintFlags).toBe(paintFlags);
    expect(sfxView.setLane).toBe(setLane);
  });
});

describe('offset mode', () => {
  it('yToOffset: top is hi, bottom is lo, whole semitones, clamped to -48..48', () => {
    expect(yToOffset(0, 240, -12, 12)).toBe(12);
    expect(yToOffset(240, 240, -12, 12)).toBe(-12);
    expect(yToOffset(120, 240, -12, 12)).toBe(0);
    expect(yToOffset(130, 240, -12, 12)).toBe(-1); // 12 - 130/240*24 = -1.0
    expect(yToOffset(124, 240, -12, 12)).toBe(0); // -0.4 snaps to 0
    expect(yToOffset(-500, 240, -12, 12)).toBe(MAX_OFFSET);
    expect(yToOffset(9999, 240, -12, 12)).toBe(-MAX_OFFSET);
  });

  it('snaps a drawn line to whole semitones with the offset rounding', () => {
    const round = (v: number): number => clamp(Math.round(v), -MAX_OFFSET, MAX_OFFSET);
    const out = paintLine([f(), f(), f(), f(), f()], 'pitch', 0, 0, 4, 7, round);
    expect(out.map((x) => x.pitch)).toEqual([0, 2, 4, 5, 7]); // 1.75 -> 2, 3.5 -> 4 (rounds half up), 5.25 -> 5
    expect(out.every((x) => Number.isInteger(x.pitch))).toBe(true);
  });

  it('nudge: a semitone, Shift an octave, Alt ignored, clamped to +-48', () => {
    expect(nudge(f(0), 'pitch', 1, false, false, 'offset').pitch).toBe(1);
    expect(nudge(f(0), 'pitch', -1, false, false, 'offset').pitch).toBe(-1);
    expect(nudge(f(3), 'pitch', 1, true, false, 'offset').pitch).toBe(15);
    expect(nudge(f(3), 'pitch', 1, false, true, 'offset').pitch).toBe(4);
    expect(nudge(f(47), 'pitch', 1, true, false, 'offset').pitch).toBe(48);
    expect(nudge(f(-47), 'pitch', -1, true, false, 'offset').pitch).toBe(-48);
  });

  it('note mode still moves in notes (unchanged)', () => {
    expect(nudge(f(60), 'pitch', 1, false, false).pitch).toBe(61);
    expect(nudge(f(60), 'pitch', 1, true, false).pitch).toBe(72);
    expect(nudge(f(60), 'pitch', 1, false, true).pitch).toBeCloseTo(60.1, 5);
  });

  it('fitOffsetRange: at least -12..12, widened around the data, inside -48..48', () => {
    expect(fitOffsetRange([f(0), f(3)])).toEqual({ lo: -12, hi: 12 });
    expect(fitOffsetRange([f(0), f(20)])).toEqual({ lo: -12, hi: 22 });
    expect(fitOffsetRange([f(-30), f(0)])).toEqual({ lo: -32, hi: 12 });
    expect(fitOffsetRange([f(48), f(-48)])).toEqual({ lo: -48, hi: 48 });
    expect(fitOffsetRange([])).toEqual({ lo: -12, hi: 12 });
  });

  it('offsetLabel: +12, 0, -12', () => {
    expect([offsetLabel(12), offsetLabel(0), offsetLabel(-12), offsetLabel(0.4)]).toEqual(['+12', '0', '-12', '0']);
  });
});

describe('loop marker', () => {
  it('moveLoop: with no loop the first move puts it at the cursor; then it steps and stays inside the instrument', () => {
    expect(moveLoop(null, 1, 5, 16)).toBe(5);
    expect(moveLoop(undefined, -1, 5, 16)).toBe(5);
    expect(moveLoop(5, 1, 0, 16)).toBe(6);
    expect(moveLoop(5, -1, 0, 16)).toBe(4);
    expect(moveLoop(0, -1, 0, 16)).toBe(0);
    expect(moveLoop(15, 1, 0, 16)).toBe(15);
    expect(moveLoop(null, 1, 99, 16)).toBe(15);
  });
});
