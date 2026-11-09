/**
 * songOps.ts -- the edit operations of the music tracker, applied to a SongDoc.
 *
 * Pure TypeScript. Every op returns a new document (the old one is untouched, so undo is a swap) with
 * a short undo label, or an error message. Documents are never mutated.
 */
import {
  CHANNELS,
  CUSTOM_IDS,
  DEFAULT_ROWS,
  INSTRUMENT_COLOURS,
  MAX_NOTE,
  MAX_ORDER,
  MAX_PATTERNS,
  MAX_ROWS,
  MAX_RPB,
  MAX_SPEED,
  MAX_NAME,
  MIN_NOTE,
  MIN_RPB,
  MIN_SPEED,
  SongDoc,
  SongEvent,
  SongFrame,
  SongInstrument,
  SongPattern,
  patternLetter,
  validateSong,
} from './songDoc';
import { instrumentOf } from './songInstruments';

/** A cell's content (the row comes from where it is put). */
export type CellEvent = Omit<SongEvent, 'row'>;

export interface InstrumentPatch {
  name?: string;
  colour?: SongInstrument['colour'];
  description?: string;
  frames?: SongFrame[];
  /** null removes the loop. */
  loop?: number | null;
}

export type SongOp =
  | { op: 'setCell'; pattern: number; channel: number; row: number; event: CellEvent | null }
  /** Paste a block: `events[c][r]` lands on channel `channel + c`, row `row + r`; null clears the cell; clipped to the pattern. */
  | { op: 'setCells'; pattern: number; channel: number; row: number; events: (CellEvent | null)[][]; label?: string }
  | { op: 'clearRange'; pattern: number; ch0: number; ch1: number; row0: number; row1: number }
  | { op: 'transpose'; pattern: number; ch0: number; ch1: number; row0: number; row1: number; semitones: number }
  | { op: 'addPattern' }
  | { op: 'copyPattern'; index: number }
  | { op: 'deletePattern'; index: number }
  | { op: 'setRows'; pattern: number; rows: number }
  | { op: 'setSpeed'; speed: number }
  | { op: 'setRowsPerBeat'; rowsPerBeat: number }
  | { op: 'orderAdd'; pattern: number; at?: number }
  | { op: 'orderRemove'; at: number }
  | { op: 'orderMove'; from: number; to: number }
  | { op: 'setLoop'; at: number }
  | { op: 'addInstrument'; fromId: string }
  | { op: 'updateInstrument'; id: string; patch: InstrumentPatch }
  | { op: 'deleteInstrument'; id: string };

export type SongOutcome = { state: SongDoc; label: string } | { error: string };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const inRange = (n: unknown, len: number): n is number => isInt(n) && n >= 0 && n < len;
const loopOf = (doc: SongDoc): number => doc.loop ?? 0;

function withPattern(doc: SongDoc, i: number, p: SongPattern): SongDoc {
  return { ...doc, patterns: doc.patterns.map((x, k) => (k === i ? p : x)) };
}

function withChannel(p: SongPattern, c: number, events: SongEvent[]): SongPattern {
  return { ...p, channels: p.channels.map((x, k) => (k === c ? events : x)) };
}

/** The events of a channel with `row` set to `event` (or cleared), still sorted. */
function putEvent(events: SongEvent[], row: number, event: CellEvent | null): SongEvent[] {
  const rest = events.filter((e) => e.row !== row);
  if (!event) return rest;
  const next: SongEvent = { ...event, row };
  const at = rest.findIndex((e) => e.row > row);
  return at < 0 ? [...rest, next] : [...rest.slice(0, at), next, ...rest.slice(at)];
}

/** Why this cell content is not allowed, or undefined. */
function cellProblem(doc: SongDoc, e: CellEvent): string | undefined {
  if (e.note === 'off') return undefined;
  if (!isInt(e.note) || e.note < MIN_NOTE || e.note > MAX_NOTE) return `a note is ${MIN_NOTE}-${MAX_NOTE} or "off"`;
  if (typeof e.inst !== 'string' || !instrumentOf(doc, e.inst)) return `no instrument "${String(e.inst)}"`;
  if (e.vol !== undefined && !(isInt(e.vol) && e.vol >= 0 && e.vol <= 15)) return 'volume is 0-15';
  return undefined;
}

/** A tidy copy of an event: an off carries nothing else, a volume of 15 is the default and is left out. */
function cleanCell(e: CellEvent): CellEvent {
  if (e.note === 'off') return { note: 'off' };
  const out: CellEvent = { note: e.note, inst: e.inst };
  if (e.vol !== undefined && e.vol !== 15) out.vol = e.vol;
  return out;
}

function rangeProblem(doc: SongDoc, pattern: unknown, ch0: number, ch1: number, row0: number, row1: number): string | undefined {
  if (!inRange(pattern, doc.patterns.length)) return `no pattern ${String(pattern)}`;
  if (!isInt(ch0) || !isInt(ch1) || ch0 < 0 || ch1 >= CHANNELS || ch0 > ch1) return 'channels are 0-2';
  const rows = doc.patterns[pattern].rows;
  if (!isInt(row0) || !isInt(row1) || row0 < 0 || row1 >= rows || row0 > row1) return `rows are 0-${rows - 1}`;
  return undefined;
}

/** Applies fn to the events of every channel in the range; the pattern is unchanged when fn changes nothing. */
function mapRange(doc: SongDoc, pattern: number, ch0: number, ch1: number, row0: number, row1: number, fn: (e: SongEvent) => SongEvent | null): SongPattern {
  const p = doc.patterns[pattern];
  return {
    ...p,
    channels: p.channels.map((events, c) => {
      if (c < ch0 || c > ch1) return events;
      const out: SongEvent[] = [];
      for (const e of events) {
        if (e.row < row0 || e.row > row1) out.push(e);
        else {
          const m = fn(e);
          if (m) out.push(m);
        }
      }
      return out;
    }),
  };
}

const samePattern = (a: SongPattern, b: SongPattern): boolean => JSON.stringify(a) === JSON.stringify(b);

function copyPatternOf(p: SongPattern): SongPattern {
  return { ...p, channels: p.channels.map((ch) => ch.map((e) => ({ ...e }))) };
}

function copyInstrument(i: SongInstrument): SongInstrument {
  return { ...i, frames: i.frames.map((f) => ({ ...f })) };
}

/** Where an instrument is first used, in words (`pattern A, channel B, row 4`), or undefined. */
function firstUse(doc: SongDoc, id: string): string | undefined {
  for (let p = 0; p < doc.patterns.length; p++) {
    let best: { row: number; c: number } | undefined;
    doc.patterns[p].channels.forEach((events, c) => {
      const e = events.find((x) => x.note !== 'off' && x.inst === id);
      if (e && (!best || e.row < best.row)) best = { row: e.row, c };
    });
    if (best) return `pattern ${patternLetter(p)}, channel ${'ABC'[best.c]}, row ${best.row}`;
  }
  return undefined;
}

export function applySongOp(doc: SongDoc, op: SongOp): SongOutcome {
  const needPattern = (i: unknown): string | undefined => (inRange(i, doc.patterns.length) ? undefined : `no pattern ${String(i)}`);
  switch (op.op) {
    case 'setCell': {
      const bad = needPattern(op.pattern);
      if (bad) return { error: bad };
      if (!inRange(op.channel, CHANNELS)) return { error: 'channels are 0-2' };
      const p = doc.patterns[op.pattern];
      if (!inRange(op.row, p.rows)) return { error: `rows are 0-${p.rows - 1}` };
      if (op.event) {
        const why = cellProblem(doc, op.event);
        if (why) return { error: why };
      }
      const events = putEvent(p.channels[op.channel], op.row, op.event ? cleanCell(op.event) : null);
      const next = withChannel(p, op.channel, events);
      if (samePattern(next, p)) return { error: 'unchanged' };
      return { state: withPattern(doc, op.pattern, next), label: !op.event ? 'Clear cell' : op.event.note === 'off' ? 'Set note off' : 'Set note' };
    }
    case 'setCells': {
      const bad = needPattern(op.pattern);
      if (bad) return { error: bad };
      if (!Array.isArray(op.events)) return { error: 'nothing to paste' };
      const p = doc.patterns[op.pattern];
      if (!inRange(op.channel, CHANNELS) || !inRange(op.row, p.rows)) return { error: 'the paste starts outside the pattern' };
      let next = p;
      for (let c = 0; c < op.events.length; c++) {
        const ch = op.channel + c;
        if (ch >= CHANNELS) break;
        const col = op.events[c];
        if (!Array.isArray(col)) return { error: 'nothing to paste' };
        for (let r = 0; r < col.length; r++) {
          const row = op.row + r;
          if (row >= p.rows) break;
          const e = col[r];
          if (e) {
            const why = cellProblem(doc, e);
            if (why) return { error: why };
          }
          next = withChannel(next, ch, putEvent(next.channels[ch], row, e ? cleanCell(e) : null));
        }
      }
      if (samePattern(next, p)) return { error: 'unchanged' };
      return { state: withPattern(doc, op.pattern, next), label: op.label ?? 'Paste' };
    }
    case 'clearRange': {
      const bad = rangeProblem(doc, op.pattern, op.ch0, op.ch1, op.row0, op.row1);
      if (bad) return { error: bad };
      const next = mapRange(doc, op.pattern, op.ch0, op.ch1, op.row0, op.row1, () => null);
      if (samePattern(next, doc.patterns[op.pattern])) return { error: 'unchanged' };
      return { state: withPattern(doc, op.pattern, next), label: 'Clear' };
    }
    case 'transpose': {
      const bad = rangeProblem(doc, op.pattern, op.ch0, op.ch1, op.row0, op.row1);
      if (bad) return { error: bad };
      if (!isInt(op.semitones) || op.semitones === 0) return { error: 'unchanged' };
      const next = mapRange(doc, op.pattern, op.ch0, op.ch1, op.row0, op.row1, (e) =>
        e.note === 'off' ? e : { ...e, note: Math.min(MAX_NOTE, Math.max(MIN_NOTE, e.note + op.semitones)) },
      );
      if (samePattern(next, doc.patterns[op.pattern])) return { error: 'unchanged' };
      return { state: withPattern(doc, op.pattern, next), label: 'Transpose' };
    }
    case 'addPattern': {
      if (doc.patterns.length >= MAX_PATTERNS) return { error: `a song has at most ${MAX_PATTERNS} patterns` };
      const rows = doc.patterns.length ? doc.patterns[doc.patterns.length - 1].rows : DEFAULT_ROWS;
      return { state: { ...doc, patterns: [...doc.patterns, { rows, channels: [[], [], []] }] }, label: 'Add pattern' };
    }
    case 'copyPattern': {
      const bad = needPattern(op.index);
      if (bad) return { error: bad };
      if (doc.patterns.length >= MAX_PATTERNS) return { error: `a song has at most ${MAX_PATTERNS} patterns` };
      return { state: { ...doc, patterns: [...doc.patterns, copyPatternOf(doc.patterns[op.index])] }, label: 'Copy pattern' };
    }
    case 'deletePattern': {
      const bad = needPattern(op.index);
      if (bad) return { error: bad };
      if (doc.patterns.length <= 1) return { error: 'a song needs at least one pattern' };
      const order: number[] = [];
      let loop = loopOf(doc);
      doc.order.forEach((p, k) => {
        if (p === op.index) {
          if (k < loopOf(doc)) loop--; // an entry before the loop point went away
          return;
        }
        order.push(p > op.index ? p - 1 : p);
      });
      if (!order.length) return { error: 'the order would be empty: add another pattern to the order first' };
      return {
        state: { ...doc, patterns: doc.patterns.filter((_, k) => k !== op.index), order, loop: Math.min(Math.max(0, loop), order.length - 1) },
        label: 'Delete pattern',
      };
    }
    case 'setRows': {
      const bad = needPattern(op.pattern);
      if (bad) return { error: bad };
      if (!isInt(op.rows) || op.rows < 1 || op.rows > MAX_ROWS) return { error: `a pattern has 1-${MAX_ROWS} rows` };
      const p = doc.patterns[op.pattern];
      if (op.rows === p.rows) return { error: 'unchanged' };
      const next: SongPattern = { ...p, rows: op.rows, channels: p.channels.map((ch) => ch.filter((e) => e.row < op.rows)) };
      return { state: withPattern(doc, op.pattern, next), label: 'Change pattern length' };
    }
    case 'setSpeed': {
      if (!isInt(op.speed) || op.speed < MIN_SPEED || op.speed > MAX_SPEED) return { error: `speed is ${MIN_SPEED}-${MAX_SPEED}` };
      if (op.speed === doc.speed) return { error: 'unchanged' };
      return { state: { ...doc, speed: op.speed }, label: 'Change speed' };
    }
    case 'setRowsPerBeat': {
      if (!isInt(op.rowsPerBeat) || op.rowsPerBeat < MIN_RPB || op.rowsPerBeat > MAX_RPB) return { error: `rows per beat is ${MIN_RPB}-${MAX_RPB}` };
      if (op.rowsPerBeat === doc.rowsPerBeat) return { error: 'unchanged' };
      return { state: { ...doc, rowsPerBeat: op.rowsPerBeat }, label: 'Change rows per beat' };
    }
    case 'orderAdd': {
      const bad = needPattern(op.pattern);
      if (bad) return { error: bad };
      if (doc.order.length >= MAX_ORDER) return { error: `the order has at most ${MAX_ORDER} entries` };
      const at = op.at === undefined ? doc.order.length : op.at;
      if (!isInt(at) || at < 0 || at > doc.order.length) return { error: `no position ${String(op.at)}` };
      const order = [...doc.order.slice(0, at), op.pattern, ...doc.order.slice(at)];
      const loop = at <= loopOf(doc) && doc.order.length > 0 ? loopOf(doc) + 1 : loopOf(doc);
      return { state: { ...doc, order, loop }, label: 'Add to order' };
    }
    case 'orderRemove': {
      if (!inRange(op.at, doc.order.length)) return { error: `no position ${String(op.at)}` };
      if (doc.order.length <= 1) return { error: 'the order needs at least one entry' };
      const order = doc.order.filter((_, k) => k !== op.at);
      const loop = op.at < loopOf(doc) ? loopOf(doc) - 1 : loopOf(doc);
      return { state: { ...doc, order, loop: Math.min(loop, order.length - 1) }, label: 'Remove from order' };
    }
    case 'orderMove': {
      if (!inRange(op.from, doc.order.length) || !inRange(op.to, doc.order.length)) return { error: 'no such position' };
      if (op.from === op.to) return { error: 'unchanged' };
      const idx = doc.order.map((_, k) => k);
      const [m] = idx.splice(op.from, 1);
      idx.splice(op.to, 0, m);
      // the loop point stays on the entry it was on
      const loop = idx.indexOf(loopOf(doc));
      return { state: { ...doc, order: idx.map((k) => doc.order[k]), loop }, label: 'Move in order' };
    }
    case 'setLoop': {
      if (!inRange(op.at, doc.order.length)) return { error: `no position ${String(op.at)}` };
      if (op.at === loopOf(doc)) return { error: 'unchanged' };
      return { state: { ...doc, loop: op.at }, label: 'Set loop point' };
    }
    case 'addInstrument': {
      const from = instrumentOf(doc, op.fromId);
      if (!from) return { error: `no instrument "${String(op.fromId)}"` };
      const used = new Set(doc.instruments.map((i) => i.id));
      const id = [...CUSTOM_IDS].find((c) => !used.has(c));
      if (!id) return { error: `a song has at most ${CUSTOM_IDS.length} custom instruments` };
      const name = `${from.name.slice(0, MAX_NAME - 5)} copy`;
      return { state: { ...doc, instruments: [...doc.instruments, { ...copyInstrument(from), id, name }] }, label: 'Add instrument' };
    }
    case 'updateInstrument': {
      const at = doc.instruments.findIndex((i) => i.id === op.id);
      if (at < 0) return { error: instrumentOf(doc, op.id) ? 'the built-in instruments cannot be changed: copy one first' : `no instrument "${String(op.id)}"` };
      const cur = doc.instruments[at];
      const p = op.patch ?? {};
      if (p.colour !== undefined && !(INSTRUMENT_COLOURS as readonly unknown[]).includes(p.colour)) return { error: `colour must be one of ${INSTRUMENT_COLOURS.join(', ')}` };
      const { loop: oldLoop, ...rest } = cur;
      const merged: SongInstrument = { ...rest };
      if (p.name !== undefined) merged.name = p.name;
      if (p.colour !== undefined) merged.colour = p.colour;
      if (p.description !== undefined) merged.description = p.description;
      if (p.frames !== undefined) merged.frames = p.frames.map((f) => ({ ...f }));
      const loop = p.loop === undefined ? oldLoop : p.loop === null ? undefined : p.loop;
      if (loop !== undefined) merged.loop = loop;
      const next: SongDoc = { ...doc, instruments: doc.instruments.map((i, k) => (k === at ? merged : i)) };
      const errs = validateSong(next).filter((e) => e.path.startsWith(`instruments[${at}]`));
      if (errs.length) return { error: errs[0].path ? `${errs[0].path}: ${errs[0].message}` : errs[0].message };
      if (JSON.stringify(merged) === JSON.stringify(cur)) return { error: 'unchanged' };
      return { state: next, label: p.frames !== undefined ? 'Edit instrument' : p.name !== undefined ? 'Rename instrument' : 'Change instrument' };
    }
    case 'deleteInstrument': {
      const at = doc.instruments.findIndex((i) => i.id === op.id);
      if (at < 0) return { error: instrumentOf(doc, op.id) ? 'the built-in instruments cannot be deleted' : `no instrument "${String(op.id)}"` };
      const use = firstUse(doc, op.id);
      if (use) return { error: `instrument ${op.id} (${doc.instruments[at].name}) is used at ${use}` };
      return { state: { ...doc, instruments: doc.instruments.filter((_, k) => k !== at) }, label: 'Delete instrument' };
    }
    default:
      return { error: 'unknown operation' };
  }
}
