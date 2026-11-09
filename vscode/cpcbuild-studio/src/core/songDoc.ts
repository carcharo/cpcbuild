/**
 * songDoc.ts -- the document model of the music tracker (.cpcsong).
 *
 * Pure TypeScript (host, webview and tests). A .cpcsong file is JSON, pretty-printed with two spaces and
 * a final newline: 1-16 patterns of three sparse channels (A, B, C), an order list, and the custom
 * instruments (the ten built-ins live in songInstruments.ts). vt2.ts (`songToVt2`) turns a song into the
 * Arkos .vt2 module the build converts.
 *
 * Round trip: serialiseSong(parseSong(text).doc) is the input text, byte for byte, when the text was
 * written by serialiseSong. Unknown keys are kept (they stay on the objects they were on).
 */
import { BUILTINS } from './songInstruments';

export const SONG_FORMAT = 'cpcsong';
export const SONG_VERSION = 1;

export const MIN_NOTE = 24; // C-1
export const MAX_NOTE = 107; // B-7
export const MIDDLE_C = 60; // C-4

export const MAX_PATTERNS = 16;
export const MAX_ROWS = 128;
export const DEFAULT_ROWS = 32;
export const MAX_ORDER = 256;
export const MIN_SPEED = 1;
export const MAX_SPEED = 255;
export const MIN_RPB = 1;
export const MAX_RPB = 16;
export const DEFAULT_RPB = 4;
export const CHANNELS = 3;

export const MAX_NAME = 24;
export const MAX_DESCRIPTION = 60;
export const MAX_FRAMES = 128;
export const MAX_PITCH_OFFSET = 48;
/** Measured: sample digits J..V reach samples 10-22; 23-31 are unreachable. */
export const MAX_SONG_INSTRUMENTS = 22;
/** Measured: ornaments 1-15. */
export const MAX_SONG_ORNAMENTS = 15;

/** Identity colour names (the same list as ID_NAMES in src/webview/shared/theme.ts; core cannot import webview code). */
export const INSTRUMENT_COLOURS = ['blue', 'orange', 'lilac', 'teal', 'gold', 'green', 'red', 'white', 'pink', 'violet', 'grey', 'peach'] as const;
export type InstrumentColour = (typeof INSTRUMENT_COLOURS)[number];

/** Ids a custom instrument may take, in the order addInstrument picks them. */
export const CUSTOM_IDS = 'BCDEFGHIJKLMNOPQRSTUV';

export interface SongFrame {
  /** Semitones from the played note, -48..48. */
  pitch: number;
  tone: boolean;
  noise: boolean;
  /** 0-31 */
  noisePeriod: number;
  /** 0-15 */
  volume: number;
}

export interface SongInstrument {
  id: string;
  name: string;
  colour: InstrumentColour;
  description: string;
  frames: SongFrame[];
  /** Frame index the loop runs from (to the last frame); absent = play once and stop. */
  loop?: number;
}

export interface SongEvent {
  row: number;
  /** 24-107 (60 = C-4) or "off". */
  note: number | 'off';
  /** Instrument id; required for a note, absent for "off". */
  inst?: string;
  /** 0-15; absent = 15. */
  vol?: number;
}

export interface SongPattern {
  rows: number;
  /** Exactly three sparse arrays (A, B, C), events sorted by row. */
  channels: SongEvent[][];
}

export interface SongDoc {
  format: typeof SONG_FORMAT;
  version: number;
  /** Ticks (50 Hz frames) per row, 1-255. */
  speed: number;
  /** 1-16; default 4. */
  rowsPerBeat?: number;
  patterns: SongPattern[];
  order: number[];
  /** Index into `order` the song loops back to; default 0. */
  loop?: number;
  instruments: SongInstrument[];
}

export interface SongError {
  /** Where, as in the JSON: `patterns[1].channels[0][3].note`. */
  path: string;
  message: string;
}

// ------------------------------------------------------------------ helpers

const NOTE_NAMES = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];

/** Tracker name of a note number: 60 is C-4, 24 is C-1. */
export function songNoteName(note: number): string {
  const m = Math.round(note);
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

/** Pattern letter: 0 -> A ... 15 -> P. */
export const patternLetter = (i: number): string => String.fromCharCode(65 + i);

/** Beats per minute: 3000 / (speed * rowsPerBeat) (50 Hz ticks). */
export function bpmOf(speed: number, rowsPerBeat: number = DEFAULT_RPB): number {
  return 3000 / (speed * rowsPerBeat);
}

/** The speed (min..max) whose tempo is nearest to `bpm`; a tie goes to the slower speed (the larger number). */
export function speedForBpm(bpm: number, rowsPerBeat: number = DEFAULT_RPB, min = 3, max = 15): number {
  let best = max;
  let bestDist = Infinity;
  for (let s = max; s >= min; s--) {
    const d = Math.abs(bpmOf(s, rowsPerBeat) - bpm);
    if (d < bestDist - 1e-9) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** "125", "187.5": one decimal when not whole. */
export function bpmLabel(bpm: number): string {
  const r = Math.round(bpm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Ids of the instruments the song plays, in order of first use: order list first, then rows, channels A-C; then patterns not in the order. */
export function usedInstrumentIds(doc: SongDoc): string[] {
  const seen: number[] = [];
  for (const p of doc.order) if (!seen.includes(p)) seen.push(p);
  doc.patterns.forEach((_, i) => {
    if (!seen.includes(i)) seen.push(i);
  });
  const ids: string[] = [];
  for (const pi of seen) {
    const pat = doc.patterns[pi];
    if (!pat) continue;
    const cells: SongEvent[] = pat.channels.flatMap((ch, c) => ch.map((e) => ({ ...e, row: e.row * CHANNELS + c })));
    cells.sort((a, b) => a.row - b.row);
    for (const e of cells) if (e.note !== 'off' && e.inst !== undefined && !ids.includes(e.inst)) ids.push(e.inst);
  }
  return ids;
}

export function emptyPattern(rows = DEFAULT_ROWS): SongPattern {
  return { rows, channels: [[], [], []] };
}

/** A new song: one empty pattern, played once round, speed 6. */
export function newSong(): SongDoc {
  return { format: SONG_FORMAT, version: SONG_VERSION, speed: 6, rowsPerBeat: DEFAULT_RPB, patterns: [emptyPattern()], order: [0], loop: 0, instruments: [] };
}

// --------------------------------------------------------------- validation

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function frameErrors(f: unknown, path: string, out: SongError[]): void {
  if (!isObj(f)) {
    out.push({ path, message: 'a frame must be an object' });
    return;
  }
  if (!isInt(f.pitch, -MAX_PITCH_OFFSET, MAX_PITCH_OFFSET)) out.push({ path: `${path}.pitch`, message: `pitch must be a whole number of semitones, ${-MAX_PITCH_OFFSET} to ${MAX_PITCH_OFFSET}` });
  if (typeof f.tone !== 'boolean') out.push({ path: `${path}.tone`, message: 'tone must be true or false' });
  if (typeof f.noise !== 'boolean') out.push({ path: `${path}.noise`, message: 'noise must be true or false' });
  if (!isInt(f.noisePeriod, 0, 31)) out.push({ path: `${path}.noisePeriod`, message: 'noisePeriod must be a whole number 0-31' });
  if (!isInt(f.volume, 0, 15)) out.push({ path: `${path}.volume`, message: 'volume must be a whole number 0-15' });
}

function instrumentErrors(inst: unknown, path: string, ids: Map<string, number>, out: SongError[]): void {
  if (!isObj(inst)) {
    out.push({ path, message: 'an instrument must be an object' });
    return;
  }
  if (typeof inst.id !== 'string' || !/^[B-V]$/.test(inst.id)) out.push({ path: `${path}.id`, message: 'id must be one letter B-V (1-9 and A are the built-in instruments)' });
  else {
    const first = ids.get(inst.id);
    if (first !== undefined) out.push({ path: `${path}.id`, message: `id "${inst.id}" is already used by instrument ${first + 1}` });
    else ids.set(inst.id, Number(/\[(\d+)\]$/.exec(path)?.[1] ?? 0));
  }
  if (typeof inst.name !== 'string' || inst.name.length < 1 || inst.name.length > MAX_NAME) out.push({ path: `${path}.name`, message: `name must be 1-${MAX_NAME} characters` });
  if (!(INSTRUMENT_COLOURS as readonly unknown[]).includes(inst.colour)) out.push({ path: `${path}.colour`, message: `colour must be one of ${INSTRUMENT_COLOURS.join(', ')}` });
  if (inst.description !== undefined && (typeof inst.description !== 'string' || inst.description.length > MAX_DESCRIPTION)) out.push({ path: `${path}.description`, message: `description must be text of at most ${MAX_DESCRIPTION} characters` });
  if (!Array.isArray(inst.frames)) {
    out.push({ path: `${path}.frames`, message: 'frames must be a list' });
    return;
  }
  if (inst.frames.length < 1 || inst.frames.length > MAX_FRAMES) out.push({ path: `${path}.frames`, message: `an instrument has 1-${MAX_FRAMES} frames, not ${inst.frames.length}` });
  inst.frames.forEach((f: unknown, j) => frameErrors(f, `${path}.frames[${j}]`, out));
  if (inst.loop !== undefined && !isInt(inst.loop, 0, Math.max(0, inst.frames.length - 1))) out.push({ path: `${path}.loop`, message: 'loop must be a frame number inside the instrument' });
}

function patternErrors(p: unknown, path: string, known: (id: string) => boolean, out: SongError[]): void {
  if (!isObj(p)) {
    out.push({ path, message: 'a pattern must be an object' });
    return;
  }
  const rowsOk = isInt(p.rows, 1, MAX_ROWS);
  if (!rowsOk) out.push({ path: `${path}.rows`, message: `rows must be a whole number 1-${MAX_ROWS}` });
  if (!Array.isArray(p.channels) || p.channels.length !== CHANNELS) {
    out.push({ path: `${path}.channels`, message: `a pattern has exactly ${CHANNELS} channels (A, B, C)` });
    return;
  }
  p.channels.forEach((ch: unknown, c) => {
    const cp = `${path}.channels[${c}]`;
    if (!Array.isArray(ch)) {
      out.push({ path: cp, message: 'a channel must be a list of events' });
      return;
    }
    let prev = -1;
    ch.forEach((e: unknown, k) => {
      const ep = `${cp}[${k}]`;
      if (!isObj(e)) {
        out.push({ path: ep, message: 'an event must be an object' });
        return;
      }
      if (!isInt(e.row, 0, rowsOk ? (p.rows as number) - 1 : MAX_ROWS - 1)) out.push({ path: `${ep}.row`, message: `row must be a whole number inside the pattern (0-${rowsOk ? (p.rows as number) - 1 : MAX_ROWS - 1})` });
      else {
        if (e.row <= prev) out.push({ path: `${ep}.row`, message: e.row === prev ? `row ${e.row} is used twice in this channel` : 'events must be sorted by row' });
        prev = e.row;
      }
      if (e.note === 'off') {
        if (e.inst !== undefined) out.push({ path: `${ep}.inst`, message: 'a note-off has no instrument' });
      } else {
        if (!isInt(e.note, MIN_NOTE, MAX_NOTE)) out.push({ path: `${ep}.note`, message: `note must be ${MIN_NOTE}-${MAX_NOTE} or "off"` });
        if (typeof e.inst !== 'string') out.push({ path: `${ep}.inst`, message: 'a note needs an instrument id' });
        else if (!known(e.inst)) out.push({ path: `${ep}.inst`, message: `no instrument "${e.inst}"` });
      }
      if (e.vol !== undefined && !isInt(e.vol, 0, 15)) out.push({ path: `${ep}.vol`, message: 'vol must be a whole number 0-15' });
    });
  });
}

/** Every problem of a document (any parsed JSON). Never throws. */
export function validateSong(doc: unknown): SongError[] {
  const out: SongError[] = [];
  if (!isObj(doc)) return [{ path: '', message: 'a .cpcsong file is a JSON object' }];
  if (doc.format !== SONG_FORMAT) out.push({ path: 'format', message: `format must be "${SONG_FORMAT}"` });
  if (doc.version !== SONG_VERSION) out.push({ path: 'version', message: `version must be ${SONG_VERSION}` });
  if (!isInt(doc.speed, MIN_SPEED, MAX_SPEED)) out.push({ path: 'speed', message: `speed must be a whole number ${MIN_SPEED}-${MAX_SPEED}` });
  if (doc.rowsPerBeat !== undefined && !isInt(doc.rowsPerBeat, MIN_RPB, MAX_RPB)) out.push({ path: 'rowsPerBeat', message: `rowsPerBeat must be a whole number ${MIN_RPB}-${MAX_RPB}` });

  const ids = new Map<string, number>();
  if (!Array.isArray(doc.instruments)) out.push({ path: 'instruments', message: 'instruments must be a list' });
  else doc.instruments.forEach((i: unknown, k) => instrumentErrors(i, `instruments[${k}]`, ids, out));
  const known = (id: string): boolean => BUILTINS.some((b) => b.id === id) || ids.has(id);

  let patterns = 0;
  if (!Array.isArray(doc.patterns)) out.push({ path: 'patterns', message: 'patterns must be a list' });
  else {
    patterns = doc.patterns.length;
    if (patterns < 1 || patterns > MAX_PATTERNS) out.push({ path: 'patterns', message: `a song has 1-${MAX_PATTERNS} patterns, not ${patterns}` });
    doc.patterns.forEach((p: unknown, k) => patternErrors(p, `patterns[${k}]`, known, out));
  }

  if (!Array.isArray(doc.order)) out.push({ path: 'order', message: 'order must be a list of pattern numbers' });
  else {
    if (doc.order.length < 1 || doc.order.length > MAX_ORDER) out.push({ path: 'order', message: `the order has 1-${MAX_ORDER} entries, not ${doc.order.length}` });
    doc.order.forEach((p: unknown, k) => {
      if (!isInt(p, 0, Math.max(0, patterns - 1)) || patterns === 0) out.push({ path: `order[${k}]`, message: `no pattern ${String(p)}` });
    });
    if (doc.loop !== undefined && !isInt(doc.loop, 0, Math.max(0, doc.order.length - 1))) out.push({ path: 'loop', message: 'loop must be a position in the order' });
  }
  if (doc.loop !== undefined && !Array.isArray(doc.order) && !isInt(doc.loop, 0, MAX_ORDER - 1)) out.push({ path: 'loop', message: 'loop must be a position in the order' });
  return out;
}

export function describeSongError(e: SongError): string {
  return e.path ? `${e.path}: ${e.message}` : e.message;
}

// ----------------------------------------------------------- parse / write

export interface SongParse {
  /** null when the text is not usable; errors say why. */
  doc: SongDoc | null;
  errors: SongError[];
}

export function parseSong(text: string): SongParse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return { doc: null, errors: [{ path: '', message: `not valid JSON: ${(e as Error).message}` }] };
  }
  const errors = validateSong(json);
  return { doc: errors.length ? null : (json as SongDoc), errors };
}

/** Pretty JSON, two spaces, final newline. */
export function serialiseSong(doc: SongDoc): string {
  return JSON.stringify(doc, null, 2) + '\n';
}
