/**
 * curve.ts -- the sound-effects editor's view of the shared lane maths (src/webview/shared/lanes/curve.ts),
 * plus the two helpers only the effect editor needs: the default pitch range and the shelf mini graph.
 */
import { MAX_PITCH, MIN_PITCH, SfxFrame } from '../../core/sfxDoc';

export * from '../shared/lanes/curve';

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
