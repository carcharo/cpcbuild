/**
 * spriteDoc.ts -- the document model of the sprite and tile editor (.cpcspr and .cpctil), spec 4.2.
 *
 * Pure TypeScript (host, webview and tests). A document is JSON with one row string per pixel row:
 * a pen as a hex digit, `.` = transparent. In memory a frame is `number[][]` ([y][x]) with -1 for
 * transparent; a Plus sprite stores colour k (1-15) as k and serialises -1 as `0`, so every operation
 * works on the same values. The webview holds pen indices only; bytes come from src/core/spriteExport.ts.
 *
 * Round trip: serialise(parseSprite(text)) is the input text, byte for byte, until an edit changes the
 * document (then it is rewritten in the canonical layout, keeping unknown top-level keys). Undoing back to
 * the loaded document gives the loaded text again.
 */
import { parsePalList, parseRgb12List } from './palette';
import { MAXPENS, PPB, packBlock, type Mode } from './pixels';
import { floodRegion } from './shapes';

export type DocType = 'spr' | 'til';
export type Kind = 'cpc' | 'plus';
export type PlusFormat = 'bas' | 'asm' | 'bin';
/** [y][x]; -1 = transparent. */
export type Grid = number[][];

/** A palette: inline firmware pens (cpc), inline 12-bit colours "RGB" hex (plus), or a shared file. */
export type PaletteSpec = { pens: number[] } | { colours: string[] } | { file: string };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteState {
  type: DocType;
  kind: Kind;
  /** CPC mode; unused (0) for plus. */
  mode: Mode;
  name: string;
  /** Item (frame or tile) size in pixels. Tiles are 8x8, plus sprites 16x16. */
  w: number;
  h: number;
  masked: boolean;
  palette: PaletteSpec;
  /** Frames (sprites) or tiles. */
  items: Grid[];
  output: string;
  emitPalette: boolean;
  dedupe: boolean;
  packed: boolean;
  plusFormat: PlusFormat;
  /** Unknown top-level keys, kept on save. */
  extras: Record<string, unknown>;
  /** What was loaded; serialise() returns source.text while the document equals it. */
  source: { text: string; key: string };
}

export const MAX_ITEM_SIDE = 1024;
export const MAX_TILES = 256;
export const MAX_ARRAY = 65535;
export const PLUS_SIZE = 16;
export const TILE_SIZE = 8;
export const MAX_PLUS_COLOURS = 15;

/** Pens a new document gets, by mode (16 distinct colours; mode 1 is the usual 0,26,6,18). */
export const DEFAULT_PENS: Record<Mode, number[]> = {
  0: [0, 26, 6, 18, 2, 24, 20, 12, 8, 10, 14, 16, 22, 4, 25, 13],
  1: [0, 26, 6, 18],
  2: [0, 26],
};
export const DEFAULT_PLUS_COLOURS = ['000', 'FFF', 'F00', '0F0', '00F', 'FF0', '0FF', 'F0F', '888', 'F80', '08F', '80F', '8F0', 'F08', '0F8'];

const hexDigit = (v: number): string => v.toString(16).toUpperCase();
const intIn = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** Identifier rule of generated names. */
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The importer's default name for a file stem (non-alphanumerics to "_", "img_" prefix before a digit). */
export function nameFromStem(stem: string): string {
  const n = stem.replace(/[^A-Za-z0-9_]/g, '_') || 'sprite';
  return /^[0-9]/.test(n) ? `img_${n}` : n;
}

export function itemNoun(s: Pick<SpriteState, 'type'>): 'frame' | 'tile' {
  return s.type === 'til' ? 'tile' : 'frame';
}

export const ppbOf = (s: Pick<SpriteState, 'kind' | 'mode'>): number => (s.kind === 'plus' ? 1 : PPB[s.mode]);

/** The pen / colour value that means "nothing drawn here" for new frames, clear and move. */
export function background(s: Pick<SpriteState, 'kind' | 'type' | 'masked'>): number {
  return s.kind === 'plus' || (s.type === 'spr' && s.masked) ? -1 : 0;
}

/** Highest paintable value, given how many palette entries are known (undefined = not known: the mode's limit). */
export function maxValue(s: Pick<SpriteState, 'kind' | 'mode' | 'palette'>, knownPens?: number): number {
  if (s.kind === 'plus') {
    const n = 'colours' in s.palette ? s.palette.colours.length : knownPens ?? MAX_PLUS_COLOURS;
    return Math.min(MAX_PLUS_COLOURS, n);
  }
  const n = 'pens' in s.palette ? s.palette.pens.length : knownPens ?? MAXPENS[s.mode];
  return Math.min(MAXPENS[s.mode], n) - 1;
}

export function blankGrid(w: number, h: number, v: number): Grid {
  return Array.from({ length: h }, () => new Array<number>(w).fill(v));
}
const cloneGrid = (g: Grid): Grid => g.map((r) => r.slice());
export function gridsEqual(a: Grid, b: Grid): boolean {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y++) {
    if (a[y].length !== b[y].length) return false;
    for (let x = 0; x < a[y].length; x++) if (a[y][x] !== b[y][x]) return false;
  }
  return true;
}

// ------------------------------------------------------------------ rows

/** Decodes row strings (lenient about nothing: throws on a bad character or size). */
export function rowsToGrid(rows: readonly string[], w: number, h: number, plus: boolean): Grid {
  return gridOf(rows, w, h, plus, 'frame');
}

export function rowsOf(g: Grid, plus: boolean): string[] {
  return g.map((r) => r.map((v) => (v < 0 ? (plus ? '0' : '.') : hexDigit(v))).join(''));
}

function gridOf(rows: unknown, w: number, h: number, plus: boolean, where: string): Grid {
  if (!Array.isArray(rows) || rows.length !== h) throw new Error(`${where} has ${Array.isArray(rows) ? rows.length : 'no'} rows, expected ${h}`);
  return rows.map((row, y) => {
    if (typeof row !== 'string' || row.length !== w) throw new Error(`${where}, row ${y} has ${typeof row === 'string' ? row.length : 'no'} pixels, expected ${w}`);
    return Array.from(row, (c, x) => {
      if (c === '.') return -1;
      if (!/^[0-9a-fA-F]$/.test(c)) throw new Error(`${where}, row ${y}, column ${x}: '${c}' is not a pen (0-9, A-F) or '.'`);
      const v = parseInt(c, 16);
      return plus && v === 0 ? -1 : v;
    });
  });
}

// ------------------------------------------------------------------ parse

function parsePalette(raw: unknown, kind: Kind, mode: Mode): PaletteSpec {
  if (raw === undefined) return kind === 'plus' ? { colours: DEFAULT_PLUS_COLOURS.slice() } : { pens: DEFAULT_PENS[mode].slice() };
  if (typeof raw !== 'object' || raw === null) throw new Error('"palette" must be an object');
  const p = raw as Record<string, unknown>;
  if (typeof p.file === 'string') {
    if (!p.file.trim()) throw new Error('"palette.file" is empty');
    return { file: p.file };
  }
  if (kind === 'plus') {
    if (!Array.isArray(p.colours)) throw new Error('a Plus sprite palette needs "colours" (three hex digits RGB each) or "file"');
    if (p.colours.length > MAX_PLUS_COLOURS) throw new Error(`palette has ${p.colours.length} entries, the sprite palette has ${MAX_PLUS_COLOURS}`);
    const c = p.colours.map((v) => {
      if (typeof v !== 'string' || !/^[0-9a-fA-F]{3}$/.test(v)) throw new Error(`bad 12-bit colour '${String(v)}' (expected three hex digits RGB)`);
      return v.toUpperCase();
    });
    return { colours: c };
  }
  if (!Array.isArray(p.pens)) throw new Error('the palette needs "pens" (firmware colours 0-26) or "file"');
  const pens = p.pens.map((v) => {
    if (!intIn(v, 0, 26)) throw new Error(`palette colour ${String(v)} is not a firmware colour (0-26)`);
    return v;
  });
  return { pens };
}

/** Parses a .cpcspr / .cpctil text. Throws with a message the fatal-error state shows. Empty text = a new default document. */
export function parseSprite(text: string, type: DocType, stem = 'sprite'): SpriteState {
  if (!text.trim()) return newSprite(type, { name: nameFromStem(stem) });
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`not valid JSON (${(e as Error).message})`);
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('the file must hold a JSON object');
  const tag = type === 'spr' ? 'cpcspr' : 'cpctil';
  if (j.format !== tag) throw new Error(`not a .${tag} document (the "format" field must be "${tag}")`);
  if (j.version !== undefined && (typeof j.version !== 'number' || j.version > 1)) throw new Error(`document version ${String(j.version)} is newer than this Studio understands (1)`);
  const kind: Kind = type === 'til' ? 'cpc' : j.kind === undefined ? 'cpc' : j.kind === 'cpc' || j.kind === 'plus' ? (j.kind as Kind) : (() => { throw new Error(`"kind" must be "cpc" or "plus", not ${JSON.stringify(j.kind)}`); })();
  let mode: Mode = 0;
  if (kind === 'cpc') {
    if (!intIn(j.mode, 0, 2)) throw new Error('"mode" must be 0, 1 or 2');
    mode = j.mode as Mode;
  }
  let w = TILE_SIZE, h = TILE_SIZE;
  if (kind === 'plus') w = h = PLUS_SIZE;
  else if (type === 'spr') {
    const f = j.frame as Record<string, unknown> | undefined;
    if (!f || typeof f !== 'object' || !intIn(f.w, 1, MAX_ITEM_SIDE) || !intIn(f.h, 1, MAX_ITEM_SIDE)) throw new Error(`"frame" must be {"w": n, "h": n} with sizes 1-${MAX_ITEM_SIDE}`);
    w = f.w as number;
    h = f.h as number;
  }
  const palette = parsePalette(j.palette, kind, mode);
  const list = j[type === 'spr' ? 'frames' : 'tiles'];
  if (list !== undefined && !Array.isArray(list)) throw new Error(`"${type === 'spr' ? 'frames' : 'tiles'}" must be an array`);
  const noun = itemNoun({ type });
  const items = (list ?? []).map((rows, i) => gridOf(rows, w, h, kind === 'plus', `${noun} ${i}`));
  const name = typeof j.name === 'string' && j.name ? j.name : nameFromStem(stem);
  const plus = (j.plus ?? {}) as Record<string, unknown>;
  const fmt = plus.format === 'asm' || plus.format === 'bin' ? (plus.format as PlusFormat) : 'bas';
  const known = new Set(['format', 'version', 'kind', 'mode', 'name', 'frame', 'masked', 'palette', 'frames', 'tiles', 'output', 'emitPalette', 'dedupe', 'plus']);
  const extras: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(j)) if (!known.has(k)) extras[k] = v;
  const s: SpriteState = {
    type, kind, mode, name, w, h,
    masked: type === 'spr' && kind === 'cpc' && j.masked === true,
    palette, items,
    output: typeof j.output === 'string' && j.output ? j.output : defaultOutput(name, fmt, kind),
    emitPalette: j.emitPalette !== false,
    dedupe: type === 'til' && j.dedupe === true,
    packed: kind === 'plus' && plus.packed === true,
    plusFormat: kind === 'plus' ? fmt : 'bas',
    extras,
    source: { text, key: '' },
  };
  s.source.key = formatSprite(s);
  return s;
}

function defaultOutput(name: string, fmt: PlusFormat, kind: Kind): string {
  return `${name}.${kind === 'plus' && fmt !== 'bas' ? fmt : 'bas'}`;
}

export interface NewOptions {
  name?: string;
  kind?: Kind;
  mode?: Mode;
  masked?: boolean;
  w?: number;
  h?: number;
  frames?: number;
  palette?: PaletteSpec;
}

/** A fresh document: one blank frame (sprites) or tile. */
export function newSprite(type: DocType, o: NewOptions = {}): SpriteState {
  const kind: Kind = type === 'til' ? 'cpc' : o.kind ?? 'cpc';
  const mode: Mode = kind === 'plus' ? 0 : o.mode ?? (type === 'til' ? 0 : 1);
  const name = o.name ?? (type === 'til' ? 'tiles' : 'sprite');
  const w = kind === 'plus' ? PLUS_SIZE : type === 'til' ? TILE_SIZE : o.w ?? 16;
  const h = kind === 'plus' ? PLUS_SIZE : type === 'til' ? TILE_SIZE : o.h ?? 16;
  const masked = type === 'spr' && kind === 'cpc' && (o.masked ?? true);
  const s: SpriteState = {
    type, kind, mode, name, w, h, masked,
    palette: o.palette ?? (kind === 'plus' ? { colours: DEFAULT_PLUS_COLOURS.slice() } : { pens: DEFAULT_PENS[mode].slice() }),
    items: [],
    output: `${name}.bas`,
    emitPalette: true,
    dedupe: false,
    packed: false,
    plusFormat: 'bas',
    extras: {},
    source: { text: '', key: '' },
  };
  const bg = background(s);
  s.items = Array.from({ length: o.frames ?? 1 }, () => blankGrid(w, h, bg));
  s.source = { text: formatSprite(s), key: formatSprite(s) };
  return s;
}

// -------------------------------------------------------------- serialise

const j1 = (v: unknown): string => JSON.stringify(v).replace(/,/g, ', ').replace(/":/g, '": ');

function formatSprite(s: SpriteState): string {
  const plus = s.kind === 'plus';
  const lines: string[] = [];
  const kv = (k: string, v: unknown): void => void lines.push(`  ${JSON.stringify(k)}: ${j1(v)}`);
  const tag = s.type === 'spr' ? 'cpcspr' : 'cpctil';
  kv('format', tag);
  kv('version', 1);
  if (s.type === 'spr') kv('kind', s.kind);
  if (!plus) kv('mode', s.mode);
  kv('name', s.name);
  if (s.type === 'spr' && !plus) kv('frame', { w: s.w, h: s.h });
  if (s.type === 'spr' && !plus) kv('masked', s.masked);
  kv('palette', s.palette);
  const key = s.type === 'spr' ? 'frames' : 'tiles';
  if (!s.items.length) lines.push(`  "${key}": []`);
  else {
    const body = s.items.map((g) => `    [\n${rowsOf(g, plus).map((r) => `      "${r}"`).join(',\n')}\n    ]`).join(',\n');
    lines.push(`  "${key}": [\n${body}\n  ]`);
  }
  if (s.type === 'til') kv('dedupe', s.dedupe);
  kv('output', s.output);
  kv('emitPalette', s.emitPalette);
  if (plus) kv('plus', { packed: s.packed, format: s.plusFormat });
  for (const [k, v] of Object.entries(s.extras)) lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

export function serialiseSprite(s: SpriteState): string {
  const now = formatSprite(s);
  return now === s.source.key ? s.source.text : now;
}

// ---------------------------------------------------------------- ops

export type SpriteOp =
  | { op: 'paint'; item: number; pixels: [number, number, number][]; label?: string }
  /** One gesture across several items (the 16x16 tile view paints up to four tiles). */
  | { op: 'paintMany'; pixels: [number, number, number, number][]; label?: string }
  | { op: 'fill'; item: number; x: number; y: number; value: number; box?: Rect }
  | { op: 'replace'; item: number; from: number; to: number; all?: boolean }
  | { op: 'flipH' | 'flipV'; item: number; rect?: Rect }
  | { op: 'rotate'; item: number; ccw?: boolean; rect?: Rect }
  | { op: 'shift'; item: number; dx: number; dy: number; rect?: Rect }
  | { op: 'clear'; item: number; value?: number }
  | { op: 'invert'; item: number }
  | { op: 'fillRect'; item: number; rect: Rect; value?: number; label?: string }
  | { op: 'move'; item: number; rect: Rect; dx: number; dy: number; copy?: boolean }
  | { op: 'paste'; item: number; x: number; y: number; rows: number[][] }
  /** Replaces a whole frame (a PNG taken into the canvas); smaller input is padded with the background, larger is cropped. */
  | { op: 'setItem'; item: number; rows: number[][]; label?: string }
  | { op: 'addItem'; at?: number }
  | { op: 'dupItem'; item: number }
  | { op: 'delItem'; item: number }
  | { op: 'moveItem'; from: number; to: number }
  | { op: 'setName'; name: string }
  | { op: 'setMode'; mode: Mode; force?: boolean }
  | { op: 'setMasked'; value: boolean }
  | { op: 'setSize'; w: number; h: number; crop?: boolean }
  | { op: 'setPens'; pens: number[] }
  | { op: 'setColours'; colours: string[] }
  | { op: 'setPaletteFile'; file: string; emitPalette?: boolean }
  | { op: 'setOutput'; path: string }
  | { op: 'setEmitPalette'; value: boolean }
  | { op: 'setDedupe'; value: boolean }
  | { op: 'setPacked'; value: boolean }
  | { op: 'setPlusFormat'; value: PlusFormat };

export type SpriteApplyResult = { state: SpriteState; label: string } | { error: string };

const ok = (state: SpriteState, label: string): SpriteApplyResult => ({ state, label });
const bad = (error: string): SpriteApplyResult => ({ error });
const UNCHANGED = bad('unchanged');

export function inRect(r: Rect, w: number, h: number): boolean {
  return intIn(r.x, 0, w - 1) && intIn(r.y, 0, h - 1) && intIn(r.w, 1, w) && intIn(r.h, 1, h) && r.x + r.w <= w && r.y + r.h <= h;
}

function withItem(s: SpriteState, i: number, g: Grid, label: string): SpriteApplyResult {
  if (gridsEqual(s.items[i], g)) return UNCHANGED;
  const items = s.items.slice();
  items[i] = g;
  return ok({ ...s, items }, label);
}

function checkValue(s: SpriteState, v: unknown, allowTransparent = true): string | undefined {
  if (!intIn(v, allowTransparent ? -1 : 0, 15)) return `${String(v)} is not a pen`;
  if (v >= 0 && (s.kind === 'plus' ? v === 0 || v > maxValue(s) : v > maxValue(s))) {
    return s.kind === 'plus' ? `sprite colour ${v} is not in the palette (${maxValue(s)} colours)` : `pen ${v} is not available (mode ${s.mode} palette has ${maxValue(s) + 1} pens)`;
  }
  return undefined;
}

/** Lifts rect out of g (clearing it unless `copy`) and sets it down shifted by (dx, dy); transparent cells do not overwrite. */
export function moveRect(g: Grid, rect: Rect, dx: number, dy: number, copy: boolean, bg: number): Grid {
  const out = cloneGrid(g);
  const lifted: Grid = [];
  for (let y = 0; y < rect.h; y++) lifted.push(g[rect.y + y].slice(rect.x, rect.x + rect.w));
  if (!copy) for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) out[rect.y + y][rect.x + x] = bg;
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) {
      const tx = rect.x + dx + x, ty = rect.y + dy + y;
      if (ty < 0 || ty >= g.length || tx < 0 || tx >= g[0].length || lifted[y][x] < 0) continue;
      out[ty][tx] = lifted[y][x];
    }
  return out;
}

/** Wrap-around shift of a region (the whole grid when `rect` is absent). */
export function shiftGrid(g: Grid, dx: number, dy: number, rect?: Rect): Grid {
  const r = rect ?? { x: 0, y: 0, w: g[0].length, h: g.length };
  const out = cloneGrid(g);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const sx = (((x - dx) % r.w) + r.w) % r.w, sy = (((y - dy) % r.h) + r.h) % r.h;
      out[r.y + y][r.x + x] = g[r.y + sy][r.x + sx];
    }
  return out;
}

export function flipGrid(g: Grid, horizontal: boolean, rect?: Rect): Grid {
  const r = rect ?? { x: 0, y: 0, w: g[0].length, h: g.length };
  const out = cloneGrid(g);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) out[r.y + y][r.x + x] = horizontal ? g[r.y + y][r.x + r.w - 1 - x] : g[r.y + r.h - 1 - y][r.x + x];
  return out;
}

/** Rotates a square region 90 degrees (clockwise unless `ccw`). */
export function rotateGrid(g: Grid, ccw: boolean, rect?: Rect): Grid {
  const r = rect ?? { x: 0, y: 0, w: g[0].length, h: g.length };
  const n = r.w;
  const out = cloneGrid(g);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) out[r.y + y][r.x + x] = ccw ? g[r.y + x][r.x + n - 1 - y] : g[r.y + n - 1 - x][r.x + y];
  return out;
}

/** Resizes a grid, padding with `fill`. */
function resizeGrid(g: Grid, w: number, h: number, fill: number): Grid {
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (y < g.length && x < g[0].length ? g[y][x] : fill)));
}

export function usedBeyond(s: SpriteState, limit: number): number {
  let n = 0;
  for (const g of s.items) for (const r of g) for (const v of r) if (v >= limit) n++;
  return n;
}

export function applySpriteOp(s: SpriteState, op: SpriteOp): SpriteApplyResult {
  const noun = itemNoun(s);
  const itemCheck = (i: unknown): string | undefined => (intIn(i, 0, s.items.length - 1) ? undefined : `no ${noun} ${String(i)}`);
  const bg = background(s);
  switch (op.op) {
    case 'paint': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      const g = cloneGrid(s.items[op.item]);
      for (const [x, y, v] of op.pixels) {
        if (!intIn(x, 0, s.w - 1) || !intIn(y, 0, s.h - 1)) return bad(`pixel ${x},${y} is outside the ${noun}`);
        const ve = checkValue(s, v);
        if (ve) return bad(ve);
        g[y][x] = v;
      }
      return withItem(s, op.item, g, op.label ?? 'Pencil');
    }
    case 'paintMany': {
      const items = s.items.slice();
      const touched = new Set<number>();
      for (const [i, x, y, v] of op.pixels) {
        const e = itemCheck(i) ?? checkValue(s, v) ?? (!intIn(x, 0, s.w - 1) || !intIn(y, 0, s.h - 1) ? `pixel ${x},${y} is outside the ${noun}` : undefined);
        if (e) return bad(e);
        if (!touched.has(i)) { touched.add(i); items[i] = cloneGrid(items[i]); }
        items[i][y][x] = v;
      }
      if (items.every((g, i) => gridsEqual(g, s.items[i]))) return UNCHANGED;
      return ok({ ...s, items }, op.label ?? 'Pencil');
    }
    case 'fill': {
      const e = itemCheck(op.item) ?? checkValue(s, op.value) ?? (!intIn(op.x, 0, s.w - 1) || !intIn(op.y, 0, s.h - 1) ? 'the fill point is outside the frame' : undefined);
      if (e) return bad(e);
      if (op.box && !inRect(op.box, s.w, s.h)) return bad('the selection is outside the frame');
      const g = cloneGrid(s.items[op.item]);
      for (const [x, y] of floodRegion(g, op.x, op.y, op.box)) g[y][x] = op.value;
      return withItem(s, op.item, g, 'Fill');
    }
    case 'replace': {
      const e = itemCheck(op.item) ?? checkValue(s, op.to);
      if (e) return bad(e);
      if (!intIn(op.from, -1, 15)) return bad(`${String(op.from)} is not a pen`);
      const items = s.items.map((g, i) => (op.all || i === op.item ? g.map((r) => r.map((v) => (v === op.from ? op.to : v))) : g));
      if (items.every((g, i) => gridsEqual(g, s.items[i]))) return UNCHANGED;
      return ok({ ...s, items }, op.all ? 'Replace colour in all frames' : 'Replace colour');
    }
    case 'flipH':
    case 'flipV': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (op.rect && !inRect(op.rect, s.w, s.h)) return bad('the selection is outside the frame');
      return withItem(s, op.item, flipGrid(s.items[op.item], op.op === 'flipH', op.rect), op.op === 'flipH' ? 'Flip horizontal' : 'Flip vertical');
    }
    case 'rotate': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (op.rect && !inRect(op.rect, s.w, s.h)) return bad('the selection is outside the frame');
      const r = op.rect ?? { x: 0, y: 0, w: s.w, h: s.h };
      if (r.w !== r.h) return bad(`rotate needs a square ${op.rect ? 'selection' : noun} (this one is ${r.w} x ${r.h})`);
      return withItem(s, op.item, rotateGrid(s.items[op.item], !!op.ccw, op.rect), 'Rotate 90');
    }
    case 'shift': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (!intIn(op.dx, -MAX_ITEM_SIDE, MAX_ITEM_SIDE) || !intIn(op.dy, -MAX_ITEM_SIDE, MAX_ITEM_SIDE)) return bad('bad shift');
      if (op.rect && !inRect(op.rect, s.w, s.h)) return bad('the selection is outside the frame');
      return withItem(s, op.item, shiftGrid(s.items[op.item], op.dx, op.dy, op.rect), 'Shift');
    }
    case 'clear': {
      const e = itemCheck(op.item) ?? checkValue(s, op.value ?? bg);
      if (e) return bad(e);
      return withItem(s, op.item, blankGrid(s.w, s.h, op.value ?? bg), `Clear ${noun}`);
    }
    case 'invert': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      const top = s.kind === 'plus' ? MAX_PLUS_COLOURS : MAXPENS[s.mode] - 1;
      // plus: colours 1..15 reverse among themselves
      const f = (v: number): number => (v < 0 ? v : s.kind === 'plus' ? top + 1 - v : top - v);
      return withItem(s, op.item, s.items[op.item].map((r) => r.map(f)), 'Invert pens');
    }
    case 'fillRect': {
      const e = itemCheck(op.item) ?? checkValue(s, op.value ?? bg);
      if (e) return bad(e);
      if (!inRect(op.rect, s.w, s.h)) return bad('the selection is outside the frame');
      const g = cloneGrid(s.items[op.item]);
      for (let y = 0; y < op.rect.h; y++) for (let x = 0; x < op.rect.w; x++) g[op.rect.y + y][op.rect.x + x] = op.value ?? bg;
      return withItem(s, op.item, g, op.label ?? 'Clear selection');
    }
    case 'move': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (!inRect(op.rect, s.w, s.h)) return bad('the selection is outside the frame');
      if (!intIn(op.dx, -MAX_ITEM_SIDE, MAX_ITEM_SIDE) || !intIn(op.dy, -MAX_ITEM_SIDE, MAX_ITEM_SIDE)) return bad('bad move');
      return withItem(s, op.item, moveRect(s.items[op.item], op.rect, op.dx, op.dy, !!op.copy, bg), op.copy ? 'Copy selection' : 'Move selection');
    }
    case 'paste': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (!Array.isArray(op.rows) || !op.rows.length || !intIn(op.x, -MAX_ITEM_SIDE, MAX_ITEM_SIDE) || !intIn(op.y, -MAX_ITEM_SIDE, MAX_ITEM_SIDE)) return bad('bad paste');
      const g = cloneGrid(s.items[op.item]);
      for (let y = 0; y < op.rows.length; y++)
        for (let x = 0; x < op.rows[y].length; x++) {
          const v = op.rows[y][x];
          const ve = checkValue(s, v);
          if (ve) return bad(ve);
          const tx = op.x + x, ty = op.y + y;
          if (v < 0 || tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) continue;
          g[ty][tx] = v;
        }
      return withItem(s, op.item, g, 'Paste');
    }
    case 'setItem': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (!Array.isArray(op.rows) || !op.rows.length) return bad('bad frame data');
      for (const row of op.rows) for (const v of row) { const ve = checkValue(s, v); if (ve) return bad(ve); }
      return withItem(s, op.item, resizeGrid(op.rows, s.w, s.h, bg), op.label ?? 'Replace image');
    }
    case 'addItem': {
      if (s.type === 'til' && s.items.length >= MAX_TILES) return bad(`${s.items.length + 1} tiles; tile numbers go up to 255`);
      const at = op.at === undefined ? s.items.length : op.at;
      if (!intIn(at, 0, s.items.length)) return bad(`no place ${String(op.at)} for a ${noun}`);
      const items = s.items.slice();
      items.splice(at, 0, blankGrid(s.w, s.h, bg));
      return ok({ ...s, items }, `Add ${noun}`);
    }
    case 'dupItem': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (s.type === 'til' && s.items.length >= MAX_TILES) return bad(`${s.items.length + 1} tiles; tile numbers go up to 255`);
      const items = s.items.slice();
      items.splice(op.item + 1, 0, cloneGrid(s.items[op.item]));
      return ok({ ...s, items }, `Duplicate ${noun}`);
    }
    case 'delItem': {
      const e = itemCheck(op.item);
      if (e) return bad(e);
      if (s.type === 'spr' && s.items.length === 1) return bad('a sprite needs at least one frame');
      const items = s.items.slice();
      items.splice(op.item, 1);
      return ok({ ...s, items }, `Delete ${noun}`);
    }
    case 'moveItem': {
      const e = itemCheck(op.from) ?? itemCheck(op.to);
      if (e) return bad(e);
      if (op.from === op.to) return UNCHANGED;
      const items = s.items.slice();
      const [m] = items.splice(op.from, 1);
      items.splice(op.to, 0, m);
      return ok({ ...s, items }, `Reorder ${noun}s`);
    }
    case 'setName': {
      const name = String(op.name).trim();
      if (!NAME_RE.test(name)) return bad(`'${name}' is not a valid name (letters, digits and _, not starting with a digit)`);
      if (name === s.name) return UNCHANGED;
      // the default output follows the name while it is still the default
      const output = s.output === defaultOutput(s.name, s.plusFormat, s.kind) ? defaultOutput(name, s.plusFormat, s.kind) : s.output;
      return ok({ ...s, name, output }, 'Change name');
    }
    case 'setMode': {
      if (s.kind === 'plus') return bad('a Plus sprite has no mode');
      if (!intIn(op.mode, 0, 2)) return bad('mode must be 0, 1 or 2');
      if (op.mode === s.mode) return UNCHANGED;
      const count = MAXPENS[op.mode];
      const lostPixels = usedBeyond(s, count);
      const lostPens = 'pens' in s.palette ? Math.max(0, s.palette.pens.length - count) : 0;
      if ((lostPixels || lostPens) && !op.force) {
        const parts = [];
        if (lostPixels) parts.push(`${lostPixels} pixel${lostPixels === 1 ? '' : 's'} use pens above ${count - 1}, which become pen 0`);
        if (lostPens) parts.push(`pens ${count}-${(s.palette as { pens: number[] }).pens.length - 1} of the palette are dropped`);
        return bad(`mode ${op.mode} has ${count} pens: ${parts.join('; ')}`);
      }
      const ppb = PPB[op.mode];
      const w = s.type === 'til' ? s.w : Math.ceil(s.w / ppb) * ppb; // snap up: nothing is cropped
      const items = s.items.map((g) => resizeGrid(g.map((r) => r.map((v) => (v >= count ? 0 : v))), w, s.h, bg));
      const palette: PaletteSpec = 'pens' in s.palette ? { pens: s.palette.pens.slice(0, count) } : s.palette;
      return ok({ ...s, mode: op.mode, w, items, palette }, 'Change mode');
    }
    case 'setMasked': {
      if (s.type !== 'spr' || s.kind !== 'cpc') return bad('only CPC sprites can be masked');
      if (op.value === s.masked) return UNCHANGED;
      return ok({ ...s, masked: op.value }, op.value ? 'Make masked' : 'Make unmasked');
    }
    case 'setSize': {
      if (s.type !== 'spr' || s.kind !== 'cpc') return bad(`${s.type === 'til' ? 'tiles are 8x8' : 'Plus sprites are 16x16'}`);
      if (!intIn(op.w, 1, MAX_ITEM_SIDE) || !intIn(op.h, 1, MAX_ITEM_SIDE)) return bad(`size must be 1-${MAX_ITEM_SIDE}`);
      const ppb = PPB[s.mode];
      if (op.w % ppb) return bad(`frame width ${op.w} is not a multiple of ${ppb} (mode ${s.mode})`);
      if (op.w === s.w && op.h === s.h) return UNCHANGED;
      if ((op.w < s.w || op.h < s.h) && !op.crop) {
        const dropped = s.items.reduce((n, g) => n + g.reduce((m, r, y) => m + r.reduce((k, v, x) => k + ((x >= op.w || y >= op.h) && v !== bg ? 1 : 0), 0), 0), 0);
        if (dropped) return bad(`crop: ${dropped} drawn pixel${dropped === 1 ? '' : 's'} would be cropped`);
      }
      return ok({ ...s, w: op.w, h: op.h, items: s.items.map((g) => resizeGrid(g, op.w, op.h, bg)) }, 'Change frame size');
    }
    case 'setPens': {
      if (s.kind !== 'cpc') return bad('this document has no firmware pens');
      if (!Array.isArray(op.pens) || !op.pens.length || op.pens.length > MAXPENS[s.mode] || !op.pens.every((p) => intIn(p, 0, 26))) return bad(`pens must be 1-${MAXPENS[s.mode]} firmware colours (0-26)`);
      if ('pens' in s.palette && s.palette.pens.length === op.pens.length && s.palette.pens.every((p, i) => p === op.pens[i])) return UNCHANGED;
      return ok({ ...s, palette: { pens: op.pens.slice() } }, 'Change palette colour');
    }
    case 'setColours': {
      if (s.kind !== 'plus') return bad('this document has no 12-bit colours');
      if (!Array.isArray(op.colours) || op.colours.length > MAX_PLUS_COLOURS) return bad(`the Plus sprite palette has ${MAX_PLUS_COLOURS} colours`);
      if (!op.colours.every((c) => /^[0-9a-fA-F]{3}$/.test(c))) return bad('colours are three hex digits RGB');
      const colours = op.colours.map((c) => c.toUpperCase());
      if ('colours' in s.palette && s.palette.colours.join() === colours.join()) return UNCHANGED;
      return ok({ ...s, palette: { colours } }, 'Change palette colour');
    }
    case 'setPaletteFile': {
      if (!op.file.trim()) return bad('the palette file name is empty');
      if ('file' in s.palette && s.palette.file === op.file && (op.emitPalette === undefined || op.emitPalette === s.emitPalette)) return UNCHANGED;
      return ok({ ...s, palette: { file: op.file }, emitPalette: op.emitPalette ?? s.emitPalette }, 'Use a shared palette');
    }
    case 'setOutput': {
      const path = String(op.path).trim();
      if (!path) return bad('the output path is empty');
      if (path === s.output) return UNCHANGED;
      return ok({ ...s, output: path }, 'Change output file');
    }
    case 'setEmitPalette':
      return op.value === s.emitPalette ? UNCHANGED : ok({ ...s, emitPalette: op.value }, 'Change emit palette');
    case 'setDedupe':
      if (s.type !== 'til') return bad('only tile sets can drop duplicates');
      return op.value === s.dedupe ? UNCHANGED : ok({ ...s, dedupe: op.value }, 'Change dedupe');
    case 'setPacked':
      if (s.kind !== 'plus') return bad('packed applies to Plus sprites');
      return op.value === s.packed ? UNCHANGED : ok({ ...s, packed: op.value }, 'Change packed');
    case 'setPlusFormat': {
      if (s.kind !== 'plus') return bad('the format applies to Plus sprites');
      if (!['bas', 'asm', 'bin'].includes(op.value)) return bad('format must be bas, asm or bin');
      if (op.value === s.plusFormat) return UNCHANGED;
      const output = s.output === defaultOutput(s.name, s.plusFormat, 'plus') ? defaultOutput(s.name, op.value, 'plus') : s.output;
      return ok({ ...s, plusFormat: op.value, output }, 'Change output format');
    }
    default:
      return bad(`unknown operation '${String((op as { op: string }).op)}'`);
  }
}

// -------------------------------------------------------- palette files

/** Resolved palette of a document: firmware pens, or 12-bit colours as "RGB" strings; or why the file could not be used. */
export interface ResolvedPalette {
  pens?: number[];
  colours?: string[];
  problem?: string;
}

/**
 * The palette a document draws with. For a file reference `fileText` is the file's content (undefined = not
 * readable). A Plus palette file may be a .cpcpal12 with 17+ entries (pens, border, sprite colours): the sprite
 * colours are entries 17-31; a shorter list is used whole (what `--palette-file` would take).
 */
export function resolvePalette(s: Pick<SpriteState, 'kind' | 'palette'>, fileText?: string): ResolvedPalette {
  const p = s.palette;
  if ('pens' in p) return { pens: p.pens };
  if ('colours' in p) return { colours: p.colours };
  if (fileText === undefined) return { problem: `palette file ${p.file} could not be read` };
  try {
    if (s.kind === 'plus') {
      const all = parseRgb12List(fileText).map((c) => c.map((n) => n.toString(16).toUpperCase()).join(''));
      const colours = all.length > MAX_PLUS_COLOURS ? all.slice(17, 17 + MAX_PLUS_COLOURS) : all;
      return { colours };
    }
    return { pens: parsePalList(fileText) };
  } catch (e) {
    return { problem: `${p.file}: ${(e as Error).message}` };
  }
}

// ------------------------------------------------------------ analysis

export interface Analysis {
  /** Pixels per screen byte (1 for plus). */
  ppb: number;
  /** NAME_W: bytes per row of a CPC frame (undefined for tiles and plus). */
  wBytes?: number;
  /** NAME_SIZE for sprites; bytes per tile for tiles. */
  itemBytes: number;
  /** Bytes in the main array. */
  totalBytes: number;
  /** Stops generating: the tool's wording where it has one. */
  problems: string[];
  /** Library limits (img2cpc does not check them) and other cautions. */
  warnings: string[];
  /** Tiles: [duplicate, first] pairs, what --dedupe would drop. */
  duplicates: [number, number][];
  /** Transparent pixels in a document that will emit them as pen 0. */
  transparentAsPen0: number;
}


export function itemBytes(s: Pick<SpriteState, 'kind' | 'type' | 'mode' | 'masked' | 'w' | 'h' | 'packed'>): number {
  if (s.kind === 'plus') return s.packed ? 128 : 256;
  return (s.w / PPB[s.mode]) * s.h * (s.type === 'spr' && s.masked ? 2 : 1);
}

export function analyse(s: SpriteState, resolved: ResolvedPalette = resolvePalette(s)): Analysis {
  const problems: string[] = [];
  const warnings: string[] = [];
  const plus = s.kind === 'plus';
  const ppb = ppbOf(s);
  const noun = itemNoun(s);
  if (resolved.problem) problems.push(resolved.problem);
  if (!plus && s.w % ppb) problems.push(`frame width ${s.w} is not a multiple of ${ppb} (mode ${s.mode})`);
  if (!s.items.length) problems.push(`no ${noun}s to emit`);
  if (s.type === 'til' && s.items.length > MAX_TILES) problems.push(`${s.items.length} tiles; tile numbers go up to 255`);
  if (plus) {
    const n = resolved.colours?.length ?? 0;
    if (n > MAX_PLUS_COLOURS) problems.push(`palette has ${n} entries, the sprite palette has ${MAX_PLUS_COLOURS}`);
    if (resolved.colours && !n) problems.push('empty palette');
    const used = usedMax(s);
    if (resolved.colours && used > n) warnings.push(`sprite colour ${used} is used but the palette has only ${n} colour${n === 1 ? '' : 's'}`);
  } else if (resolved.pens) {
    const n = resolved.pens.length;
    if (!n) problems.push('empty palette');
    else if (n > MAXPENS[s.mode]) problems.push(`palette has ${n} pens, mode ${s.mode} has ${MAXPENS[s.mode]}`);
    const used = usedMax(s);
    if (used >= MAXPENS[s.mode]) problems.push(`pen ${used} is used but mode ${s.mode} has only ${MAXPENS[s.mode]} pens`);
    else if (used >= n && n) warnings.push(`pen ${used} is used but the palette has only ${n} pen${n === 1 ? '' : 's'}`);
  }
  const bytes = plus || s.w % ppb === 0 ? itemBytes(s) : 0;
  const total = bytes * s.items.length;
  if (total > MAX_ARRAY) problems.push(`${s.name} would have ${total} bytes (the limit is ${MAX_ARRAY})`);
  if (s.type === 'spr' && !plus) {
    const wb = s.w / ppb;
    if (wb > 255) warnings.push(`the frame is ${wb} bytes wide; PutSprite takes a width of 1-255`);
    if (s.h > 255) warnings.push(`the frame is ${s.h} lines tall; PutSprite takes a height of 1-255`);
    if (wb > 8 && wb <= 255) warnings.push(`the frame is ${wb} bytes wide; SprListDraw (if used) draws sprites up to 8 bytes wide`);
  }
  let transparentAsPen0 = 0;
  if (!plus && !(s.type === 'spr' && s.masked)) for (const g of s.items) for (const r of g) for (const v of r) if (v < 0) transparentAsPen0++;
  const duplicates: [number, number][] = [];
  if (s.type === 'til' && !problems.length) {
    const seen = new Map<string, number>();
    s.items.forEach((g, i) => {
      const key = packBlock(g.map((r) => r.map((v) => (v < 0 ? null : v))), 0, 0, 8, 8, s.mode, false).join(',');
      const first = seen.get(key);
      if (first === undefined) seen.set(key, i);
      else duplicates.push([i, first]);
    });
  }
  return { ppb, wBytes: s.type === 'spr' && !plus && s.w % ppb === 0 ? s.w / ppb : undefined, itemBytes: bytes, totalBytes: total, problems, warnings, duplicates, transparentAsPen0 };
}

function usedMax(s: SpriteState): number {
  let m = -1;
  for (const g of s.items) for (const r of g) for (const v of r) if (v > m) m = v;
  return m;
}

/** A problem that stops saving the document itself (none: a document with export problems still saves). */
export function saveProblemOf(_s: SpriteState): string | undefined {
  return undefined;
}
