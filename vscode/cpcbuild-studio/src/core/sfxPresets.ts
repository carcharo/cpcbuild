/**
 * sfxPresets.ts -- generators for the sound-effects editor: parameters in, frames out.
 *
 * Pure TypeScript. Each kind is a small pure function of (start, slide, length, noise, rough);
 * the same parameters always give the same frames (the pitch jitter of `rough` comes from a
 * fixed seed). `noise` is 0 (tone only) to 1 (noise only); in between, the first part of the
 * effect (that fraction of the frames) has noise mixed over the tone as an attack, and the
 * rest is tone only.
 */
import { MAX_PITCH, MIN_PITCH, PRESET_KINDS, PresetKind, PresetParams, SfxEffect, SfxDoc, SfxFrame, roundPitch, SFX_FORMAT, SFX_VERSION } from './sfxDoc';

export const MIN_LENGTH = 2;
export const MAX_LENGTH = 100;

export const PRESET_LABELS: Record<PresetKind, string> = {
  blip: 'Blip',
  jump: 'Jump',
  coin: 'Coin',
  laser: 'Laser',
  hit: 'Hit',
  explosion: 'Explosion',
  door: 'Door',
  alarm: 'Alarm',
};

export const DEFAULT_PARAMS: Record<PresetKind, PresetParams> = {
  blip: { start: 72, slide: 0, length: 6, noise: 0, rough: 0 },
  jump: { start: 60, slide: 12, length: 12, noise: 0, rough: 0 },
  coin: { start: 83, slide: 5, length: 14, noise: 0, rough: 0 },
  laser: { start: 88, slide: -36, length: 14, noise: 0, rough: 0 },
  hit: { start: 48, slide: -12, length: 8, noise: 1, rough: 0 },
  explosion: { start: 36, slide: -12, length: 40, noise: 1, rough: 0.3 },
  door: { start: 36, slide: -5, length: 16, noise: 0.3, rough: 0 },
  alarm: { start: 79, slide: -5, length: 24, noise: 0, rough: 0 },
};

/** Seeded generator (mulberry32): uniform in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const SEED = 0x5f3759df;

/** Per-frame shape of a kind, for t in [0, 1] along the effect (i = frame, n = frames). */
interface Shape {
  /** Semitones above `start`. */
  pitch(t: number, slide: number, i: number): number;
  /** Volume 0-1. */
  volume(t: number): number;
  /** Noise period 0-31 (used when the frame has noise on). */
  noisePeriod(t: number): number;
}

const decay = (power: number) => (t: number): number => Math.pow(1 - t, power);

const SHAPES: Record<PresetKind, Shape> = {
  // a short plain tick that fades away
  blip: { pitch: (t, s) => s * t, volume: decay(1.5), noisePeriod: () => 8 },
  // rising, quick at first and easing off, held loud and fading in the last third
  jump: { pitch: (t, s) => s * t * (2 - t), volume: (t) => Math.min(1, 1.5 * (1 - t)), noisePeriod: () => 6 },
  // two notes: the second one slide semitones higher, from a quarter of the way in, and it rings longer
  coin: { pitch: (t, s) => (t < 0.25 ? 0 : s), volume: (t) => (t < 0.25 ? 0.9 * (1 - t) : 0.95 * Math.pow(1 - (t - 0.25) / 0.75, 1.3)), noisePeriod: () => 4 },
  // a fast fall that slows toward the bottom
  laser: { pitch: (t, s) => s * (1 - Math.pow(1 - t, 2)), volume: (t) => 1 - 0.85 * t, noisePeriod: () => 3 },
  // a dull thump: noise from a rough hiss down to a duller one, quick decay
  hit: { pitch: (t, s) => s * t, volume: decay(2), noisePeriod: (t) => Math.round(8 + 12 * t) },
  // a loud start, then a long rumble that gets duller (noise period up) and fades
  explosion: { pitch: (t, s) => s * t, volume: (t) => (t < 0.05 ? 1 : Math.pow(1 - t, 1.3)), noisePeriod: (t) => Math.round(4 + 27 * Math.pow(t, 0.7)) },
  // a low two-step thud: the second step slide semitones lower, each step decays from its start
  door: {
    pitch: (t, s) => (t < 0.4 ? 0 : s),
    volume: (t) => (t < 0.4 ? 0.95 * (1 - (t / 0.4) * 0.5) : 0.6 * (1 - (t - 0.4) / 0.6)),
    noisePeriod: () => 14,
  },
  // two notes alternating every six frames, steady, with a short fade at the end
  alarm: { pitch: (_t, s, i) => (Math.floor(i / 6) % 2 === 0 ? 0 : s), volume: (t) => (t > 0.9 ? 0.5 : 0.85), noisePeriod: () => 10 },
};

/** `p` with every field forced into its range (length whole, 2-100). */
export function clampParams(p: PresetParams): PresetParams {
  return {
    start: clamp(p.start, MIN_PITCH, MAX_PITCH),
    slide: clamp(p.slide, -(MAX_PITCH - MIN_PITCH), MAX_PITCH - MIN_PITCH),
    length: clamp(Math.round(p.length), MIN_LENGTH, MAX_LENGTH),
    noise: clamp(p.noise, 0, 1),
    rough: clamp(p.rough, 0, 1),
  };
}

/** The frames of a preset kind for the given parameters. Deterministic. */
export function generate(kind: PresetKind, params: PresetParams = DEFAULT_PARAMS[kind]): SfxFrame[] {
  const p = clampParams(params);
  const shape = SHAPES[kind];
  const rand = rng(SEED ^ (PRESET_KINDS.indexOf(kind) + 1));
  const noiseFrames = Math.round(p.noise * p.length);
  const frames: SfxFrame[] = [];
  for (let i = 0; i < p.length; i++) {
    const t = i / (p.length - 1);
    const steps = shape.pitch(t, p.slide, i);
    // draw the jitter for every frame, so a change of `rough` never shifts the sequence
    const jitter = (rand() * 2 - 1) * p.rough * 2;
    const noiseOnly = p.noise >= 1;
    const noise = noiseOnly || i < noiseFrames;
    frames.push({
      pitch: roundPitch(clamp(p.start + steps + jitter, MIN_PITCH, MAX_PITCH)),
      tone: !noiseOnly,
      noise,
      noisePeriod: noise ? clamp(shape.noisePeriod(t), 1, 31) : 0,
      volume: clamp(Math.round(15 * shape.volume(t)), 0, 15),
    });
  }
  return frames;
}

/** An effect made from a preset, with the preset recorded so the editor can offer its sliders. */
export function presetEffect(kind: PresetKind, name: string, params: PresetParams = DEFAULT_PARAMS[kind]): SfxEffect {
  const clamped = clampParams(params);
  return { name, frames: generate(kind, clamped), preset: { kind, params: clamped } };
}

/** A new bank of one blip, for "New Sound Effects Bank". */
export function newBank(): SfxDoc {
  return { format: SFX_FORMAT, version: SFX_VERSION, effects: [presetEffect('blip', 'blip')] };
}
