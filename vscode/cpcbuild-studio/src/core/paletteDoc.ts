/**
 * paletteDoc.ts -- the document model of the palette editor (.cpcpal and .cpcpal12).
 *
 * Pure TypeScript (host and tests). A .cpcpal file is exactly the text
 * `img2cpc.py --palette-file` reads: firmware colours 0-26, commas or
 * whitespace, `#` comments. A .cpcpal12 file is the Plus list: three hex digits
 * RGB per entry (entries 0-15 pens, 16 border, 17-31 sprite colours 1-15).
 *
 * Round trip: serialise(parsePalette(text)) is the input text, byte for byte,
 * until an edit changes the entries (or the border); after an edit the file is
 * rewritten as header comments + one list line, keeping the user's own comments.
 * Undoing back to the loaded entries gives the loaded text again.
 */
import { FW_NAMES, RGB, asicEntry, fwRgb, parsePalList, parseRgb12List, rgb12Word } from './palette';

export type PaletteKind = 'fw' | 'rgb12';

export interface PaletteError {
  /** Entry index of the bad token (it is in `entries` as -1). */
  index: number;
  token: string;
  /** The converter's own message (parsePalList / parseRgb12List). */
  message: string;
}

export interface PaletteSource {
  text: string;
  entries: number[];
  border: number | null;
  errors: PaletteError[];
}

export interface PaletteState {
  kind: PaletteKind;
  /** fw: firmware colour 0-26 per pen. rgb12: 0xRGB word (r<<8 | g<<4 | b). -1 = a bad token (see errors). */
  entries: number[];
  /** fw only: optional border colour, stored as a `# border: N` comment. rgb12 uses entry 16. */
  border: number | null;
  errors: PaletteError[];
  /** What was loaded; serialise() returns source.text while the entries equal source.entries. */
  source: PaletteSource;
}

export const MAX_FW_PENS = 16;
export const MAX_RGB12_ENTRIES = 32;

export function maxEntries(kind: PaletteKind): number {
  return kind === 'fw' ? MAX_FW_PENS : MAX_RGB12_ENTRIES;
}

/** Pen limit of a mode (spec 4.1: 16 / 4 / 2). */
export const MODE_PENS: readonly number[] = [16, 4, 2];

export function kindForFile(fileName: string): PaletteKind {
  return /\.cpcpal12$/i.test(fileName) ? 'rgb12' : 'fw';
}

// ------------------------------------------------------------------ parse

const BORDER_RE = /^\s*border\s*[:=]?\s*(\d+)\s*$/i;

function isBorderLine(line: string): number | undefined {
  const h = line.indexOf('#');
  if (h < 0 || line.slice(0, h).trim() !== '') return undefined;
  const m = BORDER_RE.exec(line.slice(h + 1));
  if (!m) return undefined;
  const v = parseInt(m[1], 10);
  return v <= 26 ? v : undefined;
}

function lineTokens(line: string): string[] {
  const h = line.indexOf('#');
  return (h < 0 ? line : line.slice(0, h)).replace(/,/g, ' ').split(/\s+/).filter(Boolean);
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function parsePalette(text: string, kind: PaletteKind): PaletteState {
  const entries: number[] = [];
  const errors: PaletteError[] = [];
  let border: number | null = null;
  for (const line of splitLines(text)) {
    if (kind === 'fw') {
      const b = isBorderLine(line);
      if (b !== undefined) border = b;
    }
    for (const tok of lineTokens(line)) {
      try {
        entries.push(kind === 'fw' ? parsePalList(tok)[0] : rgb12Word(parseRgb12List(tok)[0]));
      } catch (e) {
        errors.push({ index: entries.length, token: tok, message: (e as Error).message });
        entries.push(-1);
      }
    }
  }
  const source: PaletteSource = { text, entries: [...entries], border, errors: errors.map((e) => ({ ...e })) };
  return { kind, entries, border, errors, source };
}

/** A fresh state for new files. */
export function emptyPaletteText(kind: PaletteKind): string {
  return kind === 'fw'
    ? '# firmware colours for pens 0-3 (img2cpc, mode 1)\n0, 26, 6, 18\n'
    : '# CPC Plus palette: 12-bit colours RGB (hex), entries 0-15 pens, 16 border, 17-31 sprite colours 1-15\n000, FFF, F00, 0F0\n';
}

// -------------------------------------------------------------- serialise

export function formatEntry(kind: PaletteKind, v: number): string {
  if (kind === 'fw') return String(v);
  return v.toString(16).toUpperCase().padStart(3, '0');
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function isPristine(s: PaletteState): boolean {
  return sameList(s.entries, s.source.entries) && s.border === s.source.border && JSON.stringify(s.errors) === JSON.stringify(s.source.errors);
}

/** The first problem that stops a save, or undefined. Backups ignore it. */
export function saveProblem(s: PaletteState): string | undefined {
  const e = s.errors[0];
  if (e) return `${e.message} (entry ${e.index})`;
  return undefined;
}

export function serialise(s: PaletteState): string {
  if (isPristine(s)) return s.source.text;
  const eol = /\r\n/.test(s.source.text) ? '\r\n' : '\n';
  const pre: string[] = [];
  const post: string[] = [];
  let seenData = false;
  for (const line of splitLines(s.source.text)) {
    if (s.kind === 'fw' && isBorderLine(line) !== undefined) continue;
    if (lineTokens(line).length) {
      seenData = true;
      continue;
    }
    (seenData ? post : pre).push(line);
  }
  const n = s.entries.length;
  const header = pre.map((l) => {
    const m = /^(\s*# firmware colours for pens 0-)\d+(\s*\(img2cpc, mode \d\).*)$/.exec(l);
    return m && n > 0 ? `${m[1]}${n - 1}${m[2]}` : l;
  });
  const out = [...header];
  if (n > 0) {
    const bad = new Map(s.errors.map((e) => [e.index, e.token]));
    out.push(s.entries.map((v, i) => (v < 0 ? bad.get(i) ?? '?' : formatEntry(s.kind, v))).join(', '));
  }
  if (s.kind === 'fw' && s.border !== null) out.push(`# border: ${s.border}`);
  out.push(...post);
  return out.length ? out.join(eol) + eol : '';
}

// -------------------------------------------------------------------- ops

export type PaletteOp =
  | { op: 'setEntry'; index: number; value: number }
  | { op: 'addEntry'; value?: number }
  | { op: 'removeEntry'; index: number }
  | { op: 'moveEntry'; from: number; to: number }
  | { op: 'setBorder'; value: number | null }
  | { op: 'replace'; entries: number[]; border?: number | null; label?: string }
  | { op: 'truncate'; count: number }
  | { op: 'reset' };

export type ApplyResult = { state: PaletteState; label: string } | { error: string };

function validValue(kind: PaletteKind, v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= (kind === 'fw' ? 26 : 0xfff);
}

const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function withEntries(s: PaletteState, entries: number[], border: number | null = s.border): PaletteState {
  // errors follow their entries: rebuild from the -1 markers that survive
  return { ...s, entries, border, errors: s.errors };
}

export function applyOp(s: PaletteState, op: PaletteOp): ApplyResult {
  const kind = s.kind;
  const max = maxEntries(kind);
  const e = [...s.entries];
  switch (op.op) {
    case 'setEntry': {
      if (!validValue(kind, op.value)) return { error: `value ${String(op.value)} is not a valid ${kind === 'fw' ? 'firmware colour (0-26)' : '12-bit colour'}` };
      if (!intIn(op.index, 0, max - 1)) return { error: `no entry ${String(op.index)}` };
      if (kind === 'fw' && op.index > e.length) return { error: `pen ${op.index} comes after a gap` };
      while (e.length <= op.index) e.push(0); // rgb12 entries are positional
      if (e[op.index] === op.value) return { error: 'unchanged' };
      e[op.index] = op.value;
      const errors = s.errors.filter((x) => x.index !== op.index);
      return { state: { ...withEntries(s, e), errors }, label: 'Change palette colour' };
    }
    case 'addEntry': {
      if (e.length >= max) return { error: `a ${kind === 'fw' ? 'palette' : 'Plus palette'} has at most ${max} entries` };
      const v = op.value ?? 0;
      if (!validValue(kind, v)) return { error: 'bad colour' };
      e.push(v);
      return { state: withEntries(s, e), label: 'Add pen' };
    }
    case 'removeEntry': {
      if (!intIn(op.index, 0, e.length - 1)) return { error: `no entry ${String(op.index)}` };
      if (kind === 'rgb12' && op.index !== e.length - 1) return { error: 'only the last entry of a Plus palette can be removed (entries are positional)' };
      e.splice(op.index, 1);
      const errors = s.errors.filter((x) => x.index !== op.index).map((x) => (x.index > op.index ? { ...x, index: x.index - 1 } : x));
      return { state: { ...withEntries(s, e), errors }, label: 'Remove pen' };
    }
    case 'moveEntry': {
      if (!intIn(op.from, 0, e.length - 1) || !intIn(op.to, 0, e.length - 1)) return { error: 'bad pen index' };
      if (op.from === op.to) return { error: 'unchanged' };
      const [v] = e.splice(op.from, 1);
      e.splice(op.to, 0, v);
      const remap = (i: number): number => {
        if (i === op.from) return op.to;
        if (op.from < op.to && i > op.from && i <= op.to) return i - 1;
        if (op.from > op.to && i >= op.to && i < op.from) return i + 1;
        return i;
      };
      const errors = s.errors.map((x) => ({ ...x, index: remap(x.index) })).sort((a, b) => a.index - b.index);
      return { state: { ...withEntries(s, e), errors }, label: 'Move pen' };
    }
    case 'setBorder': {
      if (kind !== 'fw') return { error: 'a Plus palette keeps its border in entry 16' };
      if (op.value !== null && !intIn(op.value, 0, 26)) return { error: 'border must be a firmware colour 0-26 or none' };
      if (op.value === s.border) return { error: 'unchanged' };
      return { state: withEntries(s, e, op.value), label: 'Change border colour' };
    }
    case 'replace': {
      if (!Array.isArray(op.entries) || op.entries.length > max || !op.entries.every((v) => validValue(kind, v))) return { error: 'bad palette' };
      return { state: { ...s, entries: [...op.entries], border: op.border === undefined ? s.border : op.border, errors: [] }, label: op.label ?? 'Load palette' };
    }
    case 'truncate': {
      if (!intIn(op.count, 0, e.length)) return { error: 'bad pen count' };
      if (op.count === e.length) return { error: 'unchanged' };
      const errors = s.errors.filter((x) => x.index < op.count);
      return { state: { ...withEntries(s, e.slice(0, op.count)), errors }, label: 'Drop pens' };
    }
    case 'reset':
      return {
        state: { ...s, entries: [...s.source.entries], border: s.source.border, errors: s.source.errors.map((x) => ({ ...x })) },
        label: 'Reset palette',
      };
    default:
      return { error: 'unknown edit' };
  }
}

// ------------------------------------------------------------ derived facts

/** Display RGB of an entry: firmware colour table or n*17 for 12-bit. */
export function entryRgb(kind: PaletteKind, v: number): RGB {
  if (kind === 'fw') return fwRgb(v);
  return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17];
}

/** ASIC palette-RAM bytes of a 12-bit entry (red<<4 | blue, then green). */
export function entryBytes(v: number): [number, number] {
  return asicEntry([(v >> 8) & 15, (v >> 4) & 15, v & 15]);
}

/** Pairs of equal colours among the first `limit` entries: [lowerPen, higherPen]. */
export function duplicatePens(entries: readonly number[], limit: number): [number, number][] {
  const out: [number, number][] = [];
  const first = new Map<number, number>();
  entries.slice(0, limit).forEach((v, i) => {
    if (v < 0) return;
    const f = first.get(v);
    if (f === undefined) first.set(v, i);
    else out.push([f, i]);
  });
  return out;
}

export function colourName(v: number): string {
  return FW_NAMES[v]?.toLowerCase() ?? `colour ${v}`;
}

// ---------------------------------------------------------------- snippets

export interface Snippet {
  id: string;
  label: string;
  text: string;
}

const hex2 = (b: number): string => '&H' + b.toString(16).toUpperCase().padStart(2, '0');
const word = (v: number): string => '&H0' + v.toString(16).toUpperCase().padStart(3, '0');

/** The copy-as texts (spec 4.1 US4, US5, US6). Only good entries are used. */
export function snippets(s: PaletteState): Snippet[] {
  const good = s.entries.map((v, i) => [v, i] as const).filter(([v]) => v >= 0);
  if (s.kind === 'fw') {
    const e = s.entries.filter((v) => v >= 0);
    const border = s.border !== null ? `\nSetBorder ${s.border}` : '';
    const dim = e.length ? `DIM pal(${e.length - 1}) AS UBYTE => {${e.join(', ')}}\nSetPalette(@pal(0), ${e.length})${border}\n` : '\' empty palette\n';
    return [
      { id: 'boriel', label: 'Boriel DIM + SetPalette', text: dim },
      { id: 'list', label: 'Bare list (--palette)', text: e.join(',') },
      { id: 'setink', label: 'SetInk lines', text: good.map(([v, i]) => `SetInk ${i}, ${v}`).join('\n') + (good.length ? '' : '\' empty palette') + (s.border !== null ? `\nSetBorder ${s.border}` : '') + '\n' },
    ];
  }
  const lines: string[] = [];
  for (const [v, i] of good) {
    if (i < 16) lines.push(`SetPalette12 ${i}, ${word(v)}`);
    else if (i === 16) lines.push(`SetBorder12 ${word(v)}`);
    else lines.push(`SpriteColour ${i - 16}, ${word(v)}`);
  }
  const bytes: number[] = [];
  const pens = s.entries.slice(0, 16).map((v) => (v < 0 ? 0 : v));
  for (const v of pens) bytes.push(...entryBytes(v));
  const arr = bytes.length
    ? `DIM pal12(${bytes.length - 1}) AS UBYTE => {${bytes.map(hex2).join(', ')}}\nSetPalette12Block(@pal12(0), 0, ${pens.length})\n`
    : "' empty palette\n";
  return [
    { id: 'setpalette12', label: 'SetPalette12 lines', text: lines.join('\n') + (lines.length ? '\n' : "' empty palette\n") },
    { id: 'bytes', label: 'Byte array + SetPalette12Block', text: arr },
  ];
}

// ------------------------------------------------------------------ images

/**
 * Colours of an image for the palette editor ("take colours from PNG", spec 4.1 US7): distinct
 * colours in order of first appearance (transparent pixels skipped), each mapped to the nearest
 * firmware colour (fw) or quantised to 12 bits (rgb12); equal results are listed once, as the
 * importer does.
 */
export function coloursOfImage(kind: PaletteKind, pixels: ArrayLike<RGB | null>, nearestFw: (c: RGB) => number, rgb12: (c: RGB) => RGB): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < pixels.length; i++) {
    const p = pixels[i];
    if (!p) continue;
    const v = kind === 'fw' ? nearestFw(p) : rgb12Word(rgb12(p));
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
