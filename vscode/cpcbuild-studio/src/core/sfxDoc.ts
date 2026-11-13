/**
 * sfxDoc.ts -- the document model of the sound-effects editor (.cpcsfx).
 *
 * Pure TypeScript (host, webview and tests). A .cpcsfx file is JSON, pretty-printed with two
 * spaces and a final newline: a bank of 1-9 effects, each a list of 50 Hz frames (pitch as a
 * fractional note number, mixer, noise period, volume). vt2.ts turns a bank into the Arkos
 * .vt2 module the build converts; sfxPresets.ts makes frames from a few parameters.
 *
 * Round trip: serialiseSfx(parseSfx(text).doc) is the input text, byte for byte, when the text
 * was written by serialiseSfx. Unknown keys are kept (they stay on the objects they were on).
 */

export const SFX_FORMAT = 'cpcsfx';
export const SFX_VERSION = 1;

export const MAX_EFFECTS = 9; // the Arkos importer plays samples 1-9 from a pattern
export const MAX_FRAMES = 250; // 5 s at 50 Hz
export const MAX_NAME = 24;
export const MIN_PITCH = 24; // C-1
export const MAX_PITCH = 107; // B-7
export const FRAME_MS = 20;
export const PITCH_STEP = 0.01;

/** The PSG clock (the AY of the CPC, 1 MHz). */
export const CLOCKS = { cpc: 1000000 } as const;

export const PRESET_KINDS = ['blip', 'jump', 'coin', 'laser', 'hit', 'explosion', 'door', 'alarm'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];

export interface PresetParams {
  /** Note number of the first note (60 = C-4). */
  start: number;
  /** Semitones moved over the length, signed. */
  slide: number;
  /** Frames, 2-100. */
  length: number;
  /** 0 = tone only, 1 = noise only (see sfxPresets.ts). */
  noise: number;
  /** 0-1: random pitch jitter, from a fixed seed. */
  rough: number;
}

export interface SfxFrame {
  /** Fractional note number, 24.0-107.0 (60 = C-4). */
  pitch: number;
  tone: boolean;
  noise: boolean;
  /** 0-31 */
  noisePeriod: number;
  /** 0-15 */
  volume: number;
}

export interface SfxPreset {
  kind: PresetKind;
  params: PresetParams;
}

export interface SfxEffect {
  name: string;
  frames: SfxFrame[];
  /** Where the frames came from; removed when the user edits frames by hand ("drawn"). */
  preset?: SfxPreset;
}

export interface SfxDoc {
  format: typeof SFX_FORMAT;
  version: number;
  effects: SfxEffect[];
}

export interface SfxError {
  /** Where, as in the JSON: `effects[1].frames[3].volume`. */
  path: string;
  message: string;
}

// ------------------------------------------------------------------ helpers

/** AY tone period of a note at a PSG clock: round(clock / 16 / f), clamped to 1-4095. */
export function period(pitch: number, clock: number): number {
  const f = 440 * Math.pow(2, (pitch - 69) / 12);
  const p = Math.round(clock / 16 / f);
  return Math.min(4095, Math.max(1, p));
}

export function lengthMs(effect: SfxEffect): number {
  return effect.frames.length * FRAME_MS;
}

/** Pitch kept at 0.01 resolution. */
export function roundPitch(p: number): number {
  return Number((Math.round(p / PITCH_STEP) * PITCH_STEP).toFixed(2));
}

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/** Tracker name of the nearest semitone: 60 is C-4, 24 is C-1. */
export function noteName(pitch: number): string {
  const m = Math.round(pitch);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

export function validName(name: unknown): name is string {
  return typeof name === 'string' && name.length >= 1 && name.length <= MAX_NAME && NAME_RE.test(name);
}

export function nameProblem(name: unknown): string | undefined {
  if (validName(name)) return undefined;
  return `name must be 1-${MAX_NAME} characters: a letter, then letters, digits or _`;
}

/** The first name `base`, `base2`, `base3`... not used in the bank (case-insensitive). */
export function uniqueName(doc: SfxDoc, base: string): string {
  const used = new Set(doc.effects.map((e) => e.name.toLowerCase()));
  let n = 1;
  let name = base;
  while (used.has(name.toLowerCase())) name = `${base}${++n}`;
  return name;
}

export function silentFrame(): SfxFrame {
  return { pitch: 60, tone: true, noise: false, noisePeriod: 0, volume: 0 };
}

// --------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isInt = (v: unknown, lo: number, hi: number): boolean => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function frameErrors(f: unknown, path: string, out: SfxError[]): void {
  if (!isObj(f)) {
    out.push({ path, message: 'a frame must be an object' });
    return;
  }
  if (!isNum(f.pitch) || f.pitch < MIN_PITCH || f.pitch > MAX_PITCH) out.push({ path: `${path}.pitch`, message: `pitch must be a note number ${MIN_PITCH}-${MAX_PITCH}` });
  if (typeof f.tone !== 'boolean') out.push({ path: `${path}.tone`, message: 'tone must be true or false' });
  if (typeof f.noise !== 'boolean') out.push({ path: `${path}.noise`, message: 'noise must be true or false' });
  if (!isInt(f.noisePeriod, 0, 31)) out.push({ path: `${path}.noisePeriod`, message: 'noisePeriod must be a whole number 0-31' });
  if (!isInt(f.volume, 0, 15)) out.push({ path: `${path}.volume`, message: 'volume must be a whole number 0-15' });
}

function presetErrors(p: unknown, path: string, out: SfxError[]): void {
  if (!isObj(p)) {
    out.push({ path, message: 'preset must be an object' });
    return;
  }
  if (!(PRESET_KINDS as readonly unknown[]).includes(p.kind)) out.push({ path: `${path}.kind`, message: `preset kind must be one of ${PRESET_KINDS.join(', ')}` });
  if (!isObj(p.params)) {
    out.push({ path: `${path}.params`, message: 'params must be an object' });
    return;
  }
  for (const k of ['start', 'slide', 'length', 'noise', 'rough'] as const) {
    if (!isNum(p.params[k])) out.push({ path: `${path}.params.${k}`, message: `${k} must be a number` });
  }
}

/** Every problem of a document (any parsed JSON). Never throws. */
export function validateSfx(doc: unknown): SfxError[] {
  const out: SfxError[] = [];
  if (!isObj(doc)) return [{ path: '', message: 'a .cpcsfx file is a JSON object' }];
  if (doc.format !== SFX_FORMAT) out.push({ path: 'format', message: `format must be "${SFX_FORMAT}"` });
  if (doc.version !== SFX_VERSION) out.push({ path: 'version', message: `version must be ${SFX_VERSION}` });
  if (!Array.isArray(doc.effects)) {
    out.push({ path: 'effects', message: 'effects must be a list' });
    return out;
  }
  if (doc.effects.length < 1 || doc.effects.length > MAX_EFFECTS) out.push({ path: 'effects', message: `a bank has 1-${MAX_EFFECTS} effects, not ${doc.effects.length}` });
  const seen = new Map<string, number>();
  doc.effects.forEach((e: unknown, i) => {
    const path = `effects[${i}]`;
    if (!isObj(e)) {
      out.push({ path, message: 'an effect must be an object' });
      return;
    }
    const np = nameProblem(e.name);
    if (np) out.push({ path: `${path}.name`, message: np });
    else {
      const key = (e.name as string).toLowerCase();
      const first = seen.get(key);
      if (first !== undefined) out.push({ path: `${path}.name`, message: `name "${e.name as string}" is already used by effect ${first + 1}` });
      else seen.set(key, i);
    }
    if (!Array.isArray(e.frames)) out.push({ path: `${path}.frames`, message: 'frames must be a list' });
    else {
      if (e.frames.length < 1 || e.frames.length > MAX_FRAMES) out.push({ path: `${path}.frames`, message: `an effect has 1-${MAX_FRAMES} frames, not ${e.frames.length}` });
      e.frames.forEach((f: unknown, j) => frameErrors(f, `${path}.frames[${j}]`, out));
    }
    if (e.preset !== undefined) presetErrors(e.preset, `${path}.preset`, out);
  });
  return out;
}

export function describeError(e: SfxError): string {
  return e.path ? `${e.path}: ${e.message}` : e.message;
}

// ----------------------------------------------------------- parse / write

export interface SfxParse {
  /** null when the text is not usable; errors say why. */
  doc: SfxDoc | null;
  errors: SfxError[];
}

export function parseSfx(text: string): SfxParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { doc: null, errors: [{ path: '', message: `not valid JSON: ${(e as Error).message}` }] };
  }
  const errors = validateSfx(json);
  return { doc: errors.length ? null : (json as SfxDoc), errors };
}

/** Pretty JSON, two spaces, final newline; pitches at 0.01. */
export function serialiseSfx(doc: SfxDoc): string {
  const rounded: SfxDoc = {
    ...doc,
    effects: doc.effects.map((e) => ({ ...e, frames: e.frames.map((f) => ({ ...f, pitch: roundPitch(f.pitch) })) })),
  };
  return JSON.stringify(rounded, null, 2) + '\n';
}
