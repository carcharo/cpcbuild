/**
 * logic.ts -- the pure helpers of the tracker editor: the key map, row labels, tempo steps, cell names,
 * cursor movement, the envelope shape of an instrument, audition frames. No DOM, no Preact.
 */
import { MAX_NOTE, MIN_NOTE, bpmLabel, bpmOf, songNoteName, speedForBpm, type SongDoc, type SongEvent, type SongInstrument } from '../../core/songDoc';
import { songToFrames, type SongFrames } from '../../core/songFrames';
import { instrumentOf } from '../../core/songInstruments';
import type { CellEvent, SongOp } from '../../core/songOps';

export const MIN_OCTAVE = 1;
export const MAX_OCTAVE = 7;
export const DEFAULT_OCTAVE = 4;
export const MAX_STEP = 16;
export const CHANNEL_LETTERS = ['A', 'B', 'C'] as const;
/** Speeds the tempo buttons step through. */
export const MIN_TEMPO_SPEED = 3;
export const MAX_TEMPO_SPEED = 15;

export const clampOctave = (o: number): number => Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, Math.round(o)));

/** Semitones above the octave's C for each physical key (KeyboardEvent.code): the Z row, then the Q row an octave up. */
export const NOTE_CODES: Readonly<Record<string, number>> = {
  KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11,
  KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24,
};
export const OFF_CODE = 'Digit1';

/**
 * What a physical key enters at this octave: a note number, 'off', or undefined (not a note key, or the
 * note is outside C-1..B-7). `octave` 4 makes the Z key C-4 (60).
 */
export function noteForCode(code: string, octave: number): number | 'off' | undefined {
  if (code === OFF_CODE) return 'off';
  const semis = NOTE_CODES[code];
  if (semis === undefined) return undefined;
  const n = 12 * (clampOctave(octave) + 1) + semis;
  return n >= MIN_NOTE && n <= MAX_NOTE ? n : undefined;
}

export interface BoardKey {
  code: string;
  /** The key's letter on a QWERTY keyboard (used until the layout map is known). */
  letter: string;
}
const row = (codes: string[]): BoardKey[] => codes.map((c) => ({ code: c, letter: c.replace(/^(Key|Digit)/, '') }));
/** The board, top to bottom: the sharps of the Q row, the Q row, the sharps of the Z row, the Z row. */
export const BOARD_ROWS: readonly (readonly BoardKey[])[] = [
  row(['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7']),
  row(['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI']),
  row(['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ']),
  row(['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM']),
];

/** True for the black-key positions of the board (sharps), by code. */
export const isSharpCode = (code: string): boolean => (NOTE_CODES[code] !== undefined ? [1, 3, 6, 8, 10].includes(NOTE_CODES[code] % 12) : false);

/** The text on a board key: "off", the note name, or '' when the key plays nothing at this octave. */
export function keyNoteLabel(code: string, octave: number): string {
  const n = noteForCode(code, octave);
  return n === 'off' ? 'off' : n === undefined ? '' : songNoteName(n);
}

/** Row label by beat: `1`, then dots for the rows inside the beat, `2` ... (beat lines every `rowsPerBeat`). */
export function beatLabel(r: number, rowsPerBeat: number): string {
  const rpb = Math.max(1, rowsPerBeat | 0);
  return r % rpb === 0 ? String(r / rpb + 1) : '·';
}

/** "4.1": beat number, then the row inside the beat (both from 1). */
export function beatPos(r: number, rowsPerBeat: number): string {
  const rpb = Math.max(1, rowsPerBeat | 0);
  return `${Math.floor(r / rpb) + 1}.${(r % rpb) + 1}`;
}

/** The speed one step faster (+ on the tempo field) or slower; speeds stay 3-15, a speed outside that stays put. */
export function stepSpeed(speed: number, faster: boolean): number {
  if (faster) return speed <= MIN_TEMPO_SPEED ? speed : Math.min(speed - 1, MAX_TEMPO_SPEED);
  return speed >= MAX_TEMPO_SPEED ? speed : Math.max(speed + 1, MIN_TEMPO_SPEED);
}

/** A typed tempo snapped to the nearest speed 3-15, or undefined when the text is not a positive number. */
export function speedFromTyped(text: string, rowsPerBeat: number): number | undefined {
  const t = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined;
  const n = Number(t);
  if (!(n > 0)) return undefined;
  return speedForBpm(n, rowsPerBeat, MIN_TEMPO_SPEED, MAX_TEMPO_SPEED);
}

export const tempoLabel = (speed: number, rowsPerBeat: number): string => bpmLabel(bpmOf(speed, rowsPerBeat));
export const ticksLabel = (speed: number): string => `${speed} tick${speed === 1 ? '' : 's'}/row`;

/** A note name as a screen reader says it: "C-5" is "C 5", "F#3" is "F sharp 3". */
export function spokenNote(note: number): string {
  const n = songNoteName(note);
  return n.replace('#', ' sharp ').replace('-', ' ');
}

/** Accessible name of a grid cell: "Row 5, channel B: C 5, Piano, volume 12", "... empty", "... note off". Rows count from 1. */
export function cellName(r: number, channel: number, ev: SongEvent | undefined, doc: Pick<SongDoc, 'instruments'>): string {
  const head = `Row ${r + 1}, channel ${CHANNEL_LETTERS[channel] ?? channel}: `;
  if (!ev) return `${head}empty`;
  if (ev.note === 'off') return `${head}note off`;
  const inst = instrumentOf(doc, ev.inst)?.name ?? `instrument ${ev.inst ?? '?'}`;
  return `${head}${spokenNote(ev.note)}, ${inst}${ev.vol !== undefined ? `, volume ${ev.vol}` : ''}`;
}

/** The cell content for a note key: the note with the current instrument, keeping an existing volume. */
export function enterNote(existing: SongEvent | undefined, note: number | 'off', inst: string): CellEvent {
  if (note === 'off') return { note: 'off' };
  const out: CellEvent = { note, inst };
  if (existing && existing.note !== 'off' && existing.vol !== undefined) out.vol = existing.vol;
  return out;
}

/** The cell with its volume changed by `delta` (0-15), or undefined when it holds no note or nothing changes. */
export function bumpVolume(ev: SongEvent | undefined, delta: number): CellEvent | undefined {
  if (!ev || ev.note === 'off') return undefined;
  const cur = ev.vol ?? 15;
  const vol = Math.min(15, Math.max(0, cur + delta));
  if (vol === cur) return undefined;
  return { note: ev.note, inst: ev.inst, vol };
}

export interface Cursor {
  row: number;
  channel: number;
}

/** Where a navigation key takes the cursor (undefined when the key is not one). Left / right stop at channels A and C. */
export function moveCursor(key: string, cur: Cursor, rows: number, rowsPerBeat: number): Cursor | undefined {
  const last = rows - 1;
  const bar = Math.max(1, rowsPerBeat | 0) * 4;
  const r = (n: number): number => Math.min(last, Math.max(0, n));
  switch (key) {
    case 'ArrowUp': return { ...cur, row: r(cur.row - 1) };
    case 'ArrowDown': return { ...cur, row: r(cur.row + 1) };
    case 'ArrowLeft': return { ...cur, channel: Math.max(0, cur.channel - 1) };
    case 'ArrowRight': return { ...cur, channel: Math.min(2, cur.channel + 1) };
    case 'PageUp': return { ...cur, row: r(cur.row - bar) };
    case 'PageDown': return { ...cur, row: r(cur.row + bar) };
    case 'Home': return { ...cur, row: 0 };
    case 'End': return { ...cur, row: last };
    default: return undefined;
  }
}

/** Volume frames of an instrument as 0..1 values (at most `points`), for the shelf's envelope shape. */
export function envelopeShape(inst: Pick<SongInstrument, 'frames'>, points = 16): number[] {
  const v = inst.frames.map((f) => f.volume / 15);
  if (v.length <= points) return v;
  return Array.from({ length: points }, (_, i) => v[Math.round((i * (v.length - 1)) / (points - 1))]);
}

/** The order op that moves step `at` by `delta`, or undefined at the ends. */
export function moveStepOp(orderLength: number, at: number, delta: -1 | 1): SongOp | undefined {
  const to = at + delta;
  return at >= 0 && at < orderLength && to >= 0 && to < orderLength ? { op: 'orderMove', from: at, to } : undefined;
}

/** A half-second one-note playback on `channel` (speed 1, 25 rows), not looping: the audition of a note entry. */
export function auditionFrames(doc: SongDoc, note: number, inst: string, channel: number): SongFrames {
  const channels: SongEvent[][] = [[], [], []];
  channels[Math.min(2, Math.max(0, channel))] = [{ row: 0, note, inst }];
  const mini: SongDoc = { ...doc, speed: 1, patterns: [{ rows: 25, channels }], order: [0], loop: 0 };
  return { ...songToFrames(mini), loopTick: -1 };
}

export interface PlayPlan {
  doc: SongDoc;
  startStep: number;
  /** True when the pattern is not in the order and plays alone (the steps do not match the sequencer then). */
  solo: boolean;
}

/** What Space plays: from the selected step when it holds the shown pattern, else its first step, else the pattern alone. */
export function playPlan(doc: SongDoc, pattern: number, step: number): PlayPlan {
  if (doc.order[step] === pattern) return { doc, startStep: step, solo: false };
  const k = doc.order.indexOf(pattern);
  if (k >= 0) return { doc, startStep: k, solo: false };
  return { doc: { ...doc, order: [pattern], loop: 0 }, startStep: 0, solo: true };
}
