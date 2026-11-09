import { describe, expect, it } from 'vitest';
import { SfxFrame } from '../../core/sfxDoc';
import { changedRange, drawsLine, fitPitchRange, shelfShape, levelToY, lineValues, nudge, paintFlags, paintLine, pitchToY, snapPitch, xToFrame, yToLevel, yToPitch } from './curve';

const f = (pitch = 60, volume = 15): SfxFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume });
const frames = (n: number): SfxFrame[] => Array.from({ length: n }, () => f());

describe('curve mapping', () => {
  it('xToFrame floors and clamps', () => {
    expect(xToFrame(0, 8, 10)).toBe(0);
    expect(xToFrame(15.9, 8, 10)).toBe(1);
    expect(xToFrame(999, 8, 10)).toBe(9);
    expect(xToFrame(-5, 8, 10)).toBe(0);
  });

  it('pitch and y map both ways; top is hi, bottom is lo', () => {
    expect(yToPitch(0, 240, 48, 72)).toBe(72);
    expect(yToPitch(240, 240, 48, 72)).toBe(48);
    expect(yToPitch(120, 240, 48, 72)).toBe(60);
    expect(pitchToY(60, 240, 48, 72)).toBe(120);
    expect(yToPitch(-50, 240, 100, 120)).toBe(107); // clamped to B-7
  });

  it('levels: bottom 0, top max, rounded', () => {
    expect(yToLevel(100, 100, 15)).toBe(0);
    expect(yToLevel(0, 100, 15)).toBe(15);
    expect(yToLevel(50, 100, 15)).toBe(8);
    expect(yToLevel(-20, 100, 15)).toBe(15);
    expect(levelToY(15, 100, 15)).toBe(0);
    expect(levelToY(0, 100, 31)).toBe(100);
  });

  it('snapPitch: semitones, or 0.01 with Alt', () => {
    expect(snapPitch(60.4, false)).toBe(60);
    expect(snapPitch(60.6, false)).toBe(61);
    expect(snapPitch(60.456, true)).toBe(60.46);
    expect(snapPitch(500, true)).toBe(107);
  });

  it('fitPitchRange: margin, minimum span, inside 24-107', () => {
    expect(fitPitchRange([f(60), f(72)])).toEqual({ lo: 54, hi: 78 });
    expect(fitPitchRange([f(60)])).toEqual({ lo: 48, hi: 72 });
    expect(fitPitchRange([f(24)])).toEqual({ lo: 24, hi: 48 });
    expect(fitPitchRange([f(107)])).toEqual({ lo: 83, hi: 107 });
    expect(fitPitchRange([f(30), f(100)])).toEqual({ lo: 27, hi: 103 });
  });
});

describe('painting', () => {
  it('lineValues interpolates in either direction and includes both ends', () => {
    expect(lineValues(0, 0, 4, 8)).toEqual([0, 1, 2, 3, 4].map((i) => ({ index: i, value: i * 2 })));
    expect(lineValues(4, 8, 0, 0)).toEqual(lineValues(0, 0, 4, 8));
    expect(lineValues(3, 5, 3, 9)).toEqual([{ index: 3, value: 9 }]);
  });

  it('paintLine sets one lane, rounds, leaves the rest and the input alone', () => {
    const src = frames(6);
    const out = paintLine(src, 'volume', 1, 0, 4, 12, Math.round);
    expect(out.map((x) => x.volume)).toEqual([15, 0, 4, 8, 12, 15]);
    expect(out[2].pitch).toBe(60);
    expect(src.every((x) => x.volume === 15)).toBe(true);
  });

  it('paintLine clips to the effect', () => {
    const out = paintLine(frames(3), 'pitch', -2, 50, 5, 70, Math.round);
    expect(out.map((x) => x.pitch)).toEqual([Math.round(50 + (20 * 2) / 7), Math.round(50 + (20 * 3) / 7), Math.round(50 + (20 * 4) / 7)]);
  });

  it('drawing a noise period turns noise on', () => {
    const out = paintLine(frames(3), 'period', 0, 7, 2, 7, Math.round);
    expect(out.every((x) => x.noise && x.noisePeriod === 7)).toBe(true);
  });

  it('paintFlags sets a run, in either direction', () => {
    const out = paintFlags(frames(5), 'tone', 3, 1, false);
    expect(out.map((x) => x.tone)).toEqual([true, false, false, false, true]);
  });

  it('changedRange finds the first and last difference', () => {
    const a = frames(6);
    expect(changedRange(a, a)).toBeNull();
    const b = paintLine(a, 'volume', 2, 1, 4, 1, Math.round);
    expect(changedRange(a, b)).toEqual({ start: 2, end: 4 });
  });
});

describe('keyboard nudges', () => {
  it('pitch: next semitone, octave with Shift, a tenth with Alt, clamped', () => {
    expect(nudge(f(60), 'pitch', 1, false, false).pitch).toBe(61);
    expect(nudge(f(60), 'pitch', -1, false, false).pitch).toBe(59);
    expect(nudge(f(60.4), 'pitch', 1, false, false).pitch).toBe(61);
    expect(nudge(f(60.4), 'pitch', -1, false, false).pitch).toBe(60);
    expect(nudge(f(60), 'pitch', 1, true, false).pitch).toBe(72);
    expect(nudge(f(60), 'pitch', -1, false, true).pitch).toBe(59.9);
    expect(nudge(f(106), 'pitch', 1, true, false).pitch).toBe(107);
    expect(nudge(f(24), 'pitch', -1, false, false).pitch).toBe(24);
  });

  it('volume and period: 1, Shift 4, clamped; period turns noise on', () => {
    expect(nudge(f(60, 15), 'volume', 1, false, false).volume).toBe(15);
    expect(nudge(f(60, 15), 'volume', -1, true, false).volume).toBe(11);
    expect(nudge(f(60, 2), 'volume', -1, true, false).volume).toBe(0);
    const p = nudge(f(), 'period', 1, true, false);
    expect(p).toMatchObject({ noisePeriod: 4, noise: true });
    expect(nudge({ ...f(), noisePeriod: 30 }, 'period', 1, true, false).noisePeriod).toBe(31);
  });
});

describe('shelfShape', () => {
  it('normalises the pitch to 0..1 with the highest note at 1', () => {
    expect(shelfShape([f(60), f(72), f(66)])).toEqual([0, 1, 0.5]);
  });
  it('is a mid line when flat, and empty for no frames', () => {
    expect(shelfShape(frames(5))).toEqual([0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(shelfShape([])).toEqual([]);
  });
  it('samples at most 28 points, keeping the first and last frame', () => {
    const many = Array.from({ length: 100 }, (_, i) => f(40 + i * 0.5));
    const s = shelfShape(many);
    expect(s).toHaveLength(28);
    expect(s[0]).toBe(0);
    expect(s[27]).toBe(1);
    expect(shelfShape(many, 10)).toHaveLength(10);
    expect(shelfShape([f(50)])).toEqual([0.5]);
  });
});

describe('drawsLine', () => {
  it('Line mode draws lines, Shift flips the mode while held', () => {
    expect(drawsLine('draw', false)).toBe(false);
    expect(drawsLine('draw', true)).toBe(true);
    expect(drawsLine('line', false)).toBe(true);
    expect(drawsLine('line', true)).toBe(false);
  });
});
