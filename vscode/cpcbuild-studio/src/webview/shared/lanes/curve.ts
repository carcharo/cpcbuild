/**
 * curve.ts -- the pure maths of the lane editor shared by the sound-effects editor and the tracker's
 * instrument editor: pixel <-> value mapping, painting values into frames (single points, dragged runs
 * and straight lines), keyboard nudges, and the loop marker. The pitch lane has two modes: absolute notes
 * (24-107, fractional, the effects) and semitone offsets (-48..48, whole, the instruments).
 * No DOM here, so vitest covers it.
 */
import { MAX_PITCH, MIN_PITCH, roundPitch } from '../../../core/sfxDoc';

/** What the lanes edit: an effect frame or an instrument frame (the same five fields). */
export interface LaneFrame {
  /** A note number (effects) or a semitone offset (instruments). */
  pitch: number;
  tone: boolean;
  noise: boolean;
  /** 0-31 */
  noisePeriod: number;
  /** 0-15 */
  volume: number;
}

/** The pitch lane shows absolute notes or semitone offsets from the played note. */
export type PitchMode = 'note' | 'offset';
export const MAX_OFFSET = 48;

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

/** `f` with one lane set. Drawing noise period turns noise on, as drawing a noise level means noise. */
export function setLane<F extends LaneFrame>(f: F, lane: Lane, v: LaneValue): F {
  switch (lane) {
    case 'pitch': return { ...f, pitch: v as number };
    case 'volume': return { ...f, volume: v as number };
    case 'period': return { ...f, noisePeriod: v as number, noise: true };
    case 'tone': return { ...f, tone: v as boolean };
    case 'noise': return { ...f, noise: v as boolean };
  }
}

export function getLane(f: LaneFrame, lane: Lane): LaneValue {
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
export function paintLine<F extends LaneFrame>(frames: readonly F[], lane: Lane, i0: number, v0: number, i1: number, v1: number, round: (v: number) => number): F[] {
  const out = frames.slice();
  for (const { index, value } of lineValues(i0, v0, i1, v1)) if (index >= 0 && index < out.length) out[index] = setLane(out[index], lane, round(value));
  return out;
}

/** Paints one boolean over a run of frames (the tone / noise strips). */
export function paintFlags<F extends LaneFrame>(frames: readonly F[], lane: 'tone' | 'noise', i0: number, i1: number, on: boolean): F[] {
  const out = frames.slice();
  for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) if (i >= 0 && i < out.length) out[i] = setLane(out[i], lane, on);
  return out;
}

/** The first and last frame that differ, or null when the lists are equal. */
export function changedRange(a: readonly LaneFrame[], b: readonly LaneFrame[]): { start: number; end: number } | null {
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
export function nudge<F extends LaneFrame>(f: F, lane: 'pitch' | 'volume' | 'period', dir: 1 | -1, shift: boolean, alt: boolean, mode: PitchMode = 'note'): F {
  if (lane === 'pitch' && mode === 'offset') {
    // whole semitones only (Alt is ignored); Shift an octave
    return { ...f, pitch: clamp(Math.round(f.pitch) + dir * (shift ? 12 : 1), -MAX_OFFSET, MAX_OFFSET) + 0 };
  }
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

/** Semitone offset at a y offset in a lane of height `h` showing offsets lo..hi, whole semitones, clamped to -48..48. */
export function yToOffset(y: number, h: number, lo: number, hi: number): number {
  return clamp(Math.round(hi - (y / h) * (hi - lo)), -MAX_OFFSET, MAX_OFFSET) + 0; // + 0: never -0
}

/** The offset range shown by default: at least -12..+12, widened to hold the data with a margin of 2, inside -48..48. */
export function fitOffsetRange(frames: readonly LaneFrame[], minSpan = 24): { lo: number; hi: number } {
  let lo = -minSpan / 2;
  let hi = minSpan / 2;
  for (const f of frames) {
    lo = Math.min(lo, Math.floor(f.pitch) - 2);
    hi = Math.max(hi, Math.ceil(f.pitch) + 2);
  }
  return { lo: Math.max(-MAX_OFFSET, lo), hi: Math.min(MAX_OFFSET, hi) };
}

/** "+12", "0", "-3": a semitone offset as the lane axis and the screen reader say it. */
export function offsetLabel(v: number): string {
  const n = Math.round(v);
  return n > 0 ? `+${n}` : String(n);
}

/** The loop start after Left / Right moved it, or the cursor frame when there was none; always inside the instrument. */
export function moveLoop(loop: number | null | undefined, delta: number, cursor: number, count: number): number {
  const from = loop === null || loop === undefined ? cursor : loop + delta;
  return clamp(from, 0, Math.max(0, count - 1));
}

/** The drawing modes of the lane bar. */
export type DrawMode = 'draw' | 'line';

/** Whether a pointer-down draws a straight line from the last point: Line mode, flipped while Shift is held. */
export function drawsLine(mode: DrawMode, shift: boolean): boolean {
  return (mode === 'line') !== shift;
}

