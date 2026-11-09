/**
 * curve.ts -- the pure maths of the sound-effects curve editor: pixel <-> value mapping, painting
 * values into frames (single points, dragged runs and straight lines) and keyboard nudges.
 * No DOM here, so vitest covers it.
 */
import { MAX_PITCH, MIN_PITCH, SfxFrame, roundPitch } from '../../core/sfxDoc';

/** The things a lane edits. */
export type Lane = 'pitch' | 'volume' | 'period' | 'tone' | 'noise';
/** A lane value: a number for pitch / volume / period, a boolean for tone / noise. */
export type LaneValue = number | boolean;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** The frame under an x offset (pixels from the left of the plot), clamped to the effect. */
export function xToFrame(x: number, cellW: number, count: number): number {
  return clamp(Math.floor(x / cellW), 0, Math.max(0, count - 1));
}

/** Note number at a y offset in a lane of height `h` showing notes lo..hi (y = 0 is the top, hi). */
export function yToPitch(y: number, h: number, lo: number, hi: number): number {
  return clamp(hi - (y / h) * (hi - lo), MIN_PITCH, MAX_PITCH);
}
export function pitchToY(p: number, h: number, lo: number, hi: number): number {
  return ((hi - p) / (hi - lo)) * h;
}

/** A whole-number level 0..max at a y offset (bottom = 0, top = max). */
export function yToLevel(y: number, h: number, max: number): number {
  return clamp(Math.round(((h - y) / h) * max), 0, max);
}
export function levelToY(v: number, h: number, max: number): number {
  return h - (v / max) * h;
}

/** Pitch snapped to a whole semitone, or kept at 0.01 when `fine` (Alt held). */
export function snapPitch(p: number, fine: boolean): number {
  return clamp(fine ? roundPitch(p) : Math.round(p), MIN_PITCH, MAX_PITCH);
}

/**
 * The pitch range shown by default: the effect's own pitches with 3 semitones of margin, at least
 * `minSpan` semitones tall (centred on the data), moved inside 24-107.
 */
export function fitPitchRange(frames: readonly SfxFrame[], minSpan = 24): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of frames) {
    lo = Math.min(lo, f.pitch);
    hi = Math.max(hi, f.pitch);
  }
  if (!frames.length) return { lo: 48, hi: 72 };
  lo = Math.floor(lo) - 3;
  hi = Math.ceil(hi) + 3;
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = Math.floor(mid - minSpan / 2);
    hi = lo + minSpan;
  }
  if (lo < MIN_PITCH) {
    hi += MIN_PITCH - lo;
    lo = MIN_PITCH;
  }
  if (hi > MAX_PITCH) {
    lo -= hi - MAX_PITCH;
    hi = MAX_PITCH;
  }
  return { lo: Math.max(MIN_PITCH, lo), hi };
}

/** `f` with one lane set. Drawing noise period turns noise on, as drawing a noise level means noise. */
export function setLane(f: SfxFrame, lane: Lane, v: LaneValue): SfxFrame {
  switch (lane) {
    case 'pitch': return { ...f, pitch: v as number };
    case 'volume': return { ...f, volume: v as number };
    case 'period': return { ...f, noisePeriod: v as number, noise: true };
    case 'tone': return { ...f, tone: v as boolean };
    case 'noise': return { ...f, noise: v as boolean };
  }
}

export function getLane(f: SfxFrame, lane: Lane): LaneValue {
  switch (lane) {
    case 'pitch': return f.pitch;
    case 'volume': return f.volume;
    case 'period': return f.noisePeriod;
    case 'tone': return f.tone;
    case 'noise': return f.noise;
  }
}

/** The (frame, value) pairs of a straight line from (i0, v0) to (i1, v1), one per frame, both ends included, ascending by frame. */
export function lineValues(i0: number, v0: number, i1: number, v1: number): { index: number; value: number }[] {
  const a = i0 <= i1 ? { i: i0, v: v0 } : { i: i1, v: v1 };
  const b = i0 <= i1 ? { i: i1, v: v1 } : { i: i0, v: v0 };
  const out: { index: number; value: number }[] = [];
  for (let i = a.i; i <= b.i; i++) out.push({ index: i, value: b.i === a.i ? b.v : a.v + ((b.v - a.v) * (i - a.i)) / (b.i - a.i) });
  return out;
}

/**
 * Paints the values of a straight line from (i0, v0) to (i1, v1) into a copy of `frames`.
 * `round` turns a raw value into the lane's value (snap to a semitone, round a level).
 */
export function paintLine(frames: readonly SfxFrame[], lane: Lane, i0: number, v0: number, i1: number, v1: number, round: (v: number) => number): SfxFrame[] {
  const out = frames.slice();
  for (const { index, value } of lineValues(i0, v0, i1, v1)) if (index >= 0 && index < out.length) out[index] = setLane(out[index], lane, round(value));
  return out;
}

/** Paints one boolean over a run of frames (the tone / noise strips). */
export function paintFlags(frames: readonly SfxFrame[], lane: 'tone' | 'noise', i0: number, i1: number, on: boolean): SfxFrame[] {
  const out = frames.slice();
  for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) if (i >= 0 && i < out.length) out[i] = setLane(out[i], lane, on);
  return out;
}

/** The first and last frame that differ, or null when the lists are equal. */
export function changedRange(a: readonly SfxFrame[], b: readonly SfxFrame[]): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x.pitch !== y.pitch || x.tone !== y.tone || x.noise !== y.noise || x.noisePeriod !== y.noisePeriod || x.volume !== y.volume) {
      if (start < 0) start = i;
      end = i;
    }
  }
  return start < 0 ? null : { start, end };
}

/**
 * One key press on a value: Up / Down (dir +1 / -1). Pitch moves to the next semitone, Shift an
 * octave, Alt 0.1 of a semitone. Volume and noise period move 1, Shift 4.
 */
export function nudge(f: SfxFrame, lane: 'pitch' | 'volume' | 'period', dir: 1 | -1, shift: boolean, alt: boolean): SfxFrame {
  if (lane === 'pitch') {
    let p: number;
    if (alt) p = roundPitch(f.pitch + dir * 0.1);
    else if (shift) p = Math.round(f.pitch) + dir * 12;
    else p = dir > 0 ? Math.floor(f.pitch + 1e-9) + 1 : Math.ceil(f.pitch - 1e-9) - 1;
    return { ...f, pitch: clamp(p, MIN_PITCH, MAX_PITCH) };
  }
  const step = shift ? 4 : 1;
  if (lane === 'volume') return { ...f, volume: clamp(f.volume + dir * step, 0, 15) };
  return { ...f, noisePeriod: clamp(f.noisePeriod + dir * step, 0, 31), noise: true };
}

/** The drawing modes of the lane bar. */
export type DrawMode = 'draw' | 'line';

/** Whether a pointer-down draws a straight line from the last point: Line mode, flipped while Shift is held. */
export function drawsLine(mode: DrawMode, shift: boolean): boolean {
  return (mode === 'line') !== shift;
}

/**
 * The pitch curve of an effect as 0..1 values (1 = highest pitch) for a shelf card's mini graph, at
 * most `max` points: frames are sampled evenly, first and last included. A flat curve is a mid line.
 */
export function shelfShape(frames: readonly SfxFrame[], max = 28): number[] {
  if (!frames.length) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const f of frames) {
    lo = Math.min(lo, f.pitch);
    hi = Math.max(hi, f.pitch);
  }
  const n = Math.min(frames.length, Math.max(1, max));
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = n === 1 ? 0 : Math.round((k * (frames.length - 1)) / (n - 1));
    out.push(hi - lo < 1e-9 ? 0.5 : (frames[i].pitch - lo) / (hi - lo));
  }
  return out;
}
