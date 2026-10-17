/**
 * img2cpc.ts -- a port of tools/img2cpc.py: converts an RGBA image into a
 * Boriel BASIC include (DIM ... => {...} arrays and CONSTs) for the cpcbuild
 * library, producing the same text as the Python tool for the same inputs
 * (src/core/img2cpc.test.ts compares the two byte for byte).
 *
 * Pure TypeScript, no vscode or node imports: file access is injected
 * (see `runCli`). Read the module docstring of tools/img2cpc.py for what the
 * options mean; briefly:
 *
 *   mode 0|1|2   sprite (default, optionally --frame WxH, --masked) or tiles
 *                (8x8, optionally --dedupe); pens are firmware colours 0-26,
 *                fixed with `palette` or built from the image (`pen0`).
 *   spectrum     ZX Spectrum bitmap + attributes (zxSprite: 1 bit per opaque
 *                non-black pixel).
 *   plusSprite / plusPalette   CPC Plus 12-bit data; bas, asm or bin output.
 *
 * Not ported: reading any image format but PNG (image.ts), and nothing of the
 * Python tool's behaviour otherwise. Errors are thrown as Img2cpcError (the
 * Python tool's SystemExit); the message has no "img2cpc: " prefix.
 */
import { decodePng, type RgbaImage } from './image';
import {
  asicEntry, dist2, FW_TABLE, nearest, nearestFw, parsePalList, parseRgb12List, rgb12, type RGB,
} from './palette';
import { MAXPENS, packBlock, PPB, type Mode, type PenGrid } from './pixels';

export class Img2cpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Img2cpcError';
  }
}

const fail = (msg: string): never => {
  throw new Img2cpcError(msg);
};

export type PlusFormat = 'bas' | 'asm' | 'bin';

export interface Options {
  /** Array name prefix. */
  name: string;
  /** Screen mode (not needed for spectrum or plus output). */
  mode?: Mode;
  tiles?: boolean;
  /** Sprite frame size in pixels, "WxH". */
  frame?: string;
  dedupe?: boolean;
  masked?: boolean;
  /** Colour treated as transparent. */
  transparent?: RGB;
  /**
   * Fixed palette as text: firmware colours "0,26,6,18" (CPC modes) or hex
   * RGB triples "F00,0F0" (plus). The caller reads --palette-file itself.
   */
  palette?: string;
  /** Auto palette: firmware colour for pen 0. */
  pen0?: number;
  noPalette?: boolean;
  spectrum?: boolean;
  zxSprite?: boolean;
  plusSprite?: boolean;
  plusPalette?: boolean;
  packed?: boolean;
  plusFormat?: PlusFormat;
}

/** What the header comment records. */
export interface HeaderInfo {
  /** The command-line arguments, as `img2cpc.py` was given them. */
  argv: readonly string[];
  /** The source path as given. */
  source: string;
}

export interface Result {
  /** The .bas / .asm text with its header (empty for plusFormat bin). */
  text: string;
  /** plusFormat bin: the data, and the palette (.pal) when the data is a sprite. */
  bin?: Uint8Array;
  palBin?: Uint8Array;
  /** The firmware pens used (CPC modes), e.g. to save with --write-palette. */
  pens?: number[];
  /** Mode-0/1/2 palette-file text for `pens` (what --write-palette writes). */
  paletteFile?: string;
}

// ---------------------------------------------------------------- image

/** pix[y][x] = RGB, or null where transparent (alpha < 128 or the key colour). */
export type Pix = (RGB | null)[][];

export function toPix(img: RgbaImage, transparent?: RGB): Pix {
  const pix: Pix = [];
  for (let y = 0; y < img.height; y++) {
    const row: (RGB | null)[] = [];
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2], a = img.data[i + 3];
      if (a < 128 || (transparent && r === transparent[0] && g === transparent[1] && b === transparent[2])) row.push(null);
      else row.push([r, g, b]);
    }
    pix.push(row);
  }
  return pix;
}

const key = (c: RGB): string => `${c[0]},${c[1]},${c[2]}`;

// ---------------------------------------------------------------- palette

export function buildPalette(pix: Pix, mode: Mode, fixed: number[] | undefined, pen0: number | undefined): number[] {
  const maxp = MAXPENS[mode];
  if (fixed) {
    if (!fixed.length) fail('empty palette');
    if (fixed.length > maxp) fail(`palette has ${fixed.length} pens, mode ${mode} has ${maxp}`);
    return [...fixed];
  }
  let pal: number[] = pen0 !== undefined ? [pen0] : [];
  for (const row of pix) {
    for (const p of row) {
      if (p) {
        const c = nearestFw(p);
        if (!pal.includes(c)) pal.push(c);
      }
    }
  }
  if (!pal.length) pal = [0];
  if (pal.length > maxp) {
    fail(`the image needs ${pal.length} colours (firmware [${pal.join(', ')}]), mode ${mode} has only ${maxp} pens`);
  }
  return pal;
}

/** Pen number per pixel, null where transparent. */
export function penGrid(pix: Pix, pal: number[]): PenGrid {
  const palRgb = pal.map((c) => FW_TABLE[c]);
  const cache = new Map<string, number>();
  return pix.map((row) =>
    row.map((p) => {
      if (!p) return null;
      const k = key(p);
      let v = cache.get(k);
      if (v === undefined) {
        v = nearest(p, palRgb);
        cache.set(k, v);
      }
      return v;
    }),
  );
}

// ---------------------------------------------------------------- Spectrum

// Spectrum colour index = G*4 + R*2 + B.
function zxRgb(idx: number, bright: number): RGB {
  const lv = bright ? 0xff : 0xd7;
  return [idx & 2 ? lv : 0, idx & 4 ? lv : 0, idx & 1 ? lv : 0];
}

// candidates as [idx, bright]; black appears once
const ZX_CANDS: [number, number][] = [[0, 0]];
for (const br of [0, 1]) for (let i = 1; i < 8; i++) ZX_CANDS.push([i, br]);
const ZX_TABLE = ZX_CANDS.map(([i, br]) => zxRgb(i, br));

function zxCheck(pix: Pix): void {
  const h = pix.length, w = h ? pix[0].length : 0;
  if (w % 8 || h % 8) fail(`Spectrum image size ${w}x${h} must be a multiple of 8`);
}

/** Spectrum sprite data (--zx-sprite): bit = 1 for every opaque pixel that isn't black. */
export function spectrumSpriteBits(pix: Pix): number[] {
  zxCheck(pix);
  const h = pix.length, w = h ? pix[0].length : 0;
  const bitmap: number[] = [];
  for (let cy = 0; cy < h; cy += 8)
    for (let cx = 0; cx < w; cx += 8)
      for (let y = cy; y < cy + 8; y++) {
        let b = 0;
        for (let c = 0; c < 8; c++) {
          const p = pix[y][cx + c];
          if (p && (p[0] || p[1] || p[2])) b |= 1 << (7 - c);
        }
        bitmap.push(b);
      }
  return bitmap;
}

/** Spectrum picture data: [bitmap (8 bytes per cell), attributes (one per cell)]. */
export function spectrumConvert(pix: Pix): [number[], number[]] {
  zxCheck(pix);
  const h = pix.length, w = h ? pix[0].length : 0;
  const bitmap: number[] = [];
  const attrs: number[] = [];
  for (let cy = 0; cy < h; cy += 8) {
    for (let cx = 0; cx < w; cx += 8) {
      const cell: number[] = []; // idx * 2 + bright
      for (let y = cy; y < cy + 8; y++)
        for (let x = cx; x < cx + 8; x++) {
          const p = pix[y][x];
          const [i, br] = p ? ZX_CANDS[nearest(p, ZX_TABLE)] : [0, 0];
          cell.push(i * 2 + br);
        }
      const cnt = new Map<number, number>();
      const first = new Map<number, number>();
      cell.forEach((c, i) => {
        cnt.set(c, (cnt.get(c) ?? 0) + 1);
        if (!first.has(c)) first.set(c, i);
      });
      const order = [...cnt.keys()].sort((a, b) => cnt.get(b)! - cnt.get(a)! || first.get(a)! - first.get(b)!);
      const paper = order[0];
      let ink = order.length > 1 ? order[1] : paper;
      if (ink >> 1 === paper >> 1) ink = paper; // same colour, differing only in brightness
      const nonblack = [paper, ink].filter((c) => c >> 1 !== 0);
      let bright = 0;
      if (nonblack.length) {
        let best = nonblack[0];
        for (const c of nonblack) if (cnt.get(c)! > cnt.get(best)!) best = c;
        bright = best & 1;
      }
      const pi = paper >> 1, ii = ink >> 1;
      attrs.push((bright << 6) | (pi << 3) | ii);
      const inkRgb = zxRgb(ii, bright), paperRgb = zxRgb(pi, bright);
      for (let r = 0; r < 8; r++) {
        let b = 0;
        for (let c = 0; c < 8; c++) {
          const idx = cell[r * 8 + c] >> 1;
          let bit: number;
          if (ii === pi) bit = 0;
          else if (idx === ii) bit = 1;
          else if (idx === pi) bit = 0;
          else {
            const p = pix[cy + r][cx + c];
            bit = p && dist2(p, inkRgb) < dist2(p, paperRgb) ? 1 : 0;
          }
          b |= bit << (7 - c);
        }
        bitmap.push(b);
      }
    }
  }
  return [bitmap, attrs];
}

// ---------------------------------------------------------------- CPC Plus

function plusColours(pixels: (RGB | null)[], limit: number, what: string, fixed: RGB[] | undefined): RGB[] {
  if (fixed) {
    if (fixed.length > limit) fail(`palette has ${fixed.length} entries, ${what} has ${limit}`);
    return [...fixed];
  }
  const pal: RGB[] = [];
  const seen = new Set<string>();
  for (const p of pixels) {
    if (p) {
      const c = rgb12(p);
      if (!seen.has(key(c))) {
        seen.add(key(c));
        pal.push(c);
      }
    }
  }
  if (pal.length > limit) {
    fail(`the image has ${pal.length} distinct 12-bit colours, ${what} has only ${limit}; pass --palette`);
  }
  return pal;
}

/** [sprite bytes, palette bytes (30), frames]. */
export function plusSpriteData(pix: Pix, packed: boolean, fixed?: RGB[]): [number[], number[], number] {
  const h = pix.length, w = h ? pix[0].length : 0;
  if (w % 16 || h % 16) fail(`sprite image ${w}x${h} must be a whole number of 16x16 cells`);
  const cells: [number, number][] = [];
  for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) cells.push([x, y]);
  const order: (RGB | null)[] = [];
  for (const [x, y] of cells) for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) order.push(pix[y + r][x + c]);
  let pal = plusColours(order, 15, 'the sprite palette', fixed);
  if (!pal.length) pal = [[0, 0, 0]];
  const idx = new Map<string, number>();
  const pen = (p: RGB | null): number => {
    if (!p) return 0;
    const c = rgb12(p);
    let v = idx.get(key(c));
    if (v === undefined) {
      v = 1 + (fixed ? nearest(c, pal) : pal.findIndex((q) => key(q) === key(c)));
      idx.set(key(c), v);
    }
    return v;
  };
  const data: number[] = [];
  for (const [x, y] of cells) {
    const px: number[] = [];
    for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) px.push(pen(pix[y + r][x + c]));
    if (packed) for (let i = 0; i < 256; i += 2) data.push((px[i] << 4) | px[i + 1]);
    else data.push(...px);
  }
  const palBytes: number[] = [];
  for (const c of pal) palBytes.push(...asicEntry(c));
  for (let i = pal.length; i < 15; i++) palBytes.push(0, 0);
  return [data, palBytes, cells.length];
}

/** The 16 pen colours (32 bytes) of a full-screen image. */
export function plusPaletteData(pix: Pix, fixed?: RGB[]): number[] {
  let pal = plusColours(pix.flat(), 16, 'the ASIC', fixed);
  if (!pal.length) pal = [[0, 0, 0]];
  const out: number[] = [];
  for (const c of pal) out.push(...asicEntry(c));
  for (let i = pal.length; i < 16; i++) out.push(0, 0);
  return out;
}

// ---------------------------------------------------------------- output

const hex2 = (b: number): string => '$' + b.toString(16).toUpperCase().padStart(2, '0');

export function fmtAsm(name: string, data: number[]): string {
  const lines = [`${name}:`];
  for (let i = 0; i < data.length; i += 16) lines.push('    defb ' + data.slice(i, i + 16).map(hex2).join(', '));
  return lines.join('\n') + '\n';
}

export function fmtArray(name: string, data: number[]): string {
  if (!data.length) fail(`nothing to emit for ${name}`);
  if (data.length > 65535) fail(`${name} would have ${data.length} bytes (the limit is 65535)`);
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += 16) {
    const chunk = data.slice(i, i + 16).map(hex2).join(', ');
    lines.push('    ' + chunk + (i + 16 < data.length ? ', _' : ' _'));
  }
  return `DIM ${name}(${data.length - 1}) AS UBYTE => { _\n` + lines.join('\n') + '\n}\n';
}

export function fmtConst(name: string, value: number): string {
  return value < 256 ? `CONST ${name} AS UBYTE = ${value}\n` : `CONST ${name} AS UINTEGER = ${value}\n`;
}

export function parseWxH(s: string): [number, number] {
  const parts = s.toLowerCase().split('x');
  if (parts.length === 2 && /^\s*\d+\s*$/.test(parts[0]) && /^\s*\d+\s*$/.test(parts[1])) {
    const w = parseInt(parts[0], 10), h = parseInt(parts[1], 10);
    if (w >= 1 && h >= 1) return [w, h];
  }
  return fail(`bad --frame '${s}' (expected WxH in pixels)`);
}

/** Palette-file text for pens (what --write-palette saves, --palette-file reads). */
export function paletteFileText(pens: number[], mode: number): string {
  return `# firmware colours for pens 0-${pens.length - 1} (img2cpc, mode ${mode})\n` + pens.join(', ') + '\n';
}

interface Body {
  body: string;
  desc: string;
  pens?: number[];
}

function convertCpc(pix: Pix, w: number, h: number, o: Options): Body {
  const mode = o.mode as Mode;
  const ppb = PPB[mode];
  if (w % ppb) fail(`image width ${w} is not a multiple of ${ppb} (mode ${mode} has ${ppb} pixels per byte)`);
  let fixed: number[] | undefined;
  if (o.palette !== undefined) {
    try {
      fixed = parsePalList(o.palette);
    } catch (e) {
      fail((e as Error).message);
    }
  }
  const pal = buildPalette(pix, mode, fixed, o.pen0);
  const grid = penGrid(pix, pal);
  const body: string[] = [];
  let desc: string;
  if (o.tiles) {
    if (o.masked) fail('--masked applies to sprites only');
    if (w % 8 || h % 8) fail(`tile image size ${w}x${h} must be a multiple of 8`);
    const tiles: number[][] = [];
    const index = new Map<string, number>();
    const cells: number[] = [];
    for (let ty = 0; ty < h; ty += 8) {
      for (let tx = 0; tx < w; tx += 8) {
        const t = packBlock(grid, tx, ty, 8, 8, mode, false);
        const k = t.join(',');
        if (o.dedupe && index.has(k)) {
          cells.push(index.get(k)!);
        } else {
          if (!index.has(k)) index.set(k, tiles.length);
          tiles.push(t);
          cells.push(tiles.length - 1);
        }
      }
    }
    if (tiles.length > 256) fail(`${tiles.length} tiles; tile numbers go up to 255`);
    body.push(fmtArray(o.name, tiles.flat()));
    body.push(fmtConst(o.name + '_COUNT', tiles.length));
    if (o.dedupe) {
      body.push(fmtArray(o.name + '_MAP', cells));
      body.push(fmtConst(o.name + '_MAPW', w / 8));
      body.push(fmtConst(o.name + '_MAPH', h / 8));
    }
    desc = `${tiles.length} tiles of ${tiles[0].length} bytes`;
  } else {
    let fw = w, fh = h;
    if (o.frame) {
      [fw, fh] = parseWxH(o.frame);
      if (w % fw || h % fh) fail(`image ${w}x${h} is not a whole number of ${fw}x${fh} frames`);
    }
    if (fw % ppb) fail(`frame width ${fw} is not a multiple of ${ppb} (mode ${mode})`);
    const data: number[] = [];
    let nframes = 0;
    for (let y = 0; y < h; y += fh)
      for (let x = 0; x < w; x += fw) {
        for (const b of packBlock(grid, x, y, fw, fh, mode, !!o.masked)) data.push(b);
        nframes++;
      }
    const size = data.length / nframes;
    body.push(fmtArray(o.name, data));
    body.push(fmtConst(o.name + '_W', fw / ppb));
    body.push(fmtConst(o.name + '_H', fh));
    body.push(fmtConst(o.name + '_FRAMES', nframes));
    body.push(fmtConst(o.name + '_SIZE', size));
    desc = `${nframes} frame(s) of ${fw / ppb} bytes x ${fh} lines${o.masked ? ', masked' : ''}, ${size} bytes each`;
  }
  if (!o.noPalette) {
    body.push(fmtArray(o.name + '_pal', pal));
    body.push(fmtConst(o.name + '_PENS', pal.length));
  }
  return { body: body.join('\n'), desc, pens: pal };
}

/** POSIX shlex.quote. */
export function shellQuote(s: string): string {
  if (s === '') return "''";
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, `'"'"'`) + "'";
}

/**
 * Converts an image. `header` is what the comment block at the top of the
 * output records (the command line and source path), so the text matches the
 * Python tool's for the same invocation.
 */
export function convert(img: RgbaImage, o: Options, header: HeaderInfo): Result {
  const plus = !!(o.plusSprite || o.plusPalette);
  const fmt = o.plusFormat ?? 'bas';
  const pix = toPix(img, o.transparent);
  const cmt = fmt === 'asm' ? ';' : "'";
  const w = img.width, h = img.height;
  let body: string, desc: string, modeTxt: string;
  let pens: number[] | undefined;

  if (plus) {
    let fixed: RGB[] | undefined;
    if (o.palette !== undefined) {
      try {
        fixed = parseRgb12List(o.palette);
      } catch (e) {
        fail((e as Error).message);
      }
    }
    let arrays: [string, number[]][];
    let consts: [string, number][] = [];
    if (o.plusSprite) {
      const [data, pal, frames] = plusSpriteData(pix, !!o.packed, fixed);
      const size = data.length / frames;
      consts = [[o.name + '_FRAMES', frames], [o.name + '_SIZE', size], [o.name + '_PALN', 15]];
      desc = `${frames} sprite(s) of ${size} bytes (${o.packed ? 'packed 4-bit' : 'one byte per pixel'}), palette 15 entries`;
      arrays = [[o.name, data], [o.name + '_pal', pal]];
    } else {
      arrays = [[o.name + '_pal', plusPaletteData(pix, fixed)]];
      desc = '16 pen colours, 32 bytes';
    }
    if (fmt === 'bin') {
      return {
        text: '',
        bin: Uint8Array.from(arrays[0][1]),
        palBin: arrays.length === 2 ? Uint8Array.from(arrays[1][1]) : undefined,
      };
    }
    body = fmt === 'asm'
      ? [...arrays.map(([n, d]) => fmtAsm(n, d)), ...consts.map(([n, v]) => `${n} EQU ${v}\n`)].join('\n')
      : [...arrays.map(([n, d]) => fmtArray(n, d)), ...consts.map(([n, v]) => fmtConst(n, v))].join('\n');
    modeTxt = 'CPC Plus';
  } else if (o.spectrum) {
    let [bitmap, attrs] = spectrumConvert(pix);
    if (o.zxSprite) bitmap = spectrumSpriteBits(pix);
    body = fmtArray(o.name, bitmap) + fmtArray(o.name + '_attr', attrs)
      + fmtConst(o.name + '_COLS', w / 8) + fmtConst(o.name + '_ROWS', h / 8);
    desc = `spectrum ${w / 8}x${h / 8} cells, ${bitmap.length} + ${attrs.length} bytes`;
    modeTxt = 'Spectrum';
  } else {
    if (o.mode === undefined) fail('--mode is required (or --spectrum, --plus-sprite, --plus-palette)');
    ({ body, desc, pens } = convertCpc(pix, w, h, o));
    modeTxt = 'mode ' + o.mode;
  }
  const cmd = 'img2cpc.py ' + header.argv.map(shellQuote).join(' ');
  const head =
    `${cmt} Generated by ${cmd}\n` +
    `${cmt} Source: ${header.source}, ${w}x${h} pixels, ${modeTxt}\n` +
    `${cmt} ${desc}\n` +
    `${cmt} Do not edit; regenerate with tools/build_assets.sh.\n\n`;
  return {
    text: head + body,
    pens,
    paletteFile: pens && o.mode !== undefined ? paletteFileText(pens, o.mode) : undefined,
  };
}

// ---------------------------------------------------------------- command line

/** Parsed command line. */
export interface CliArgs {
  image: string;
  output?: string;
  paletteFile?: string;
  writePalette?: string;
  options: Options;
}

const VALUE_FLAGS = new Set([
  '--mode', '--name', '-o', '--output', '--frame', '--transparent', '--palette', '--palette-file',
  '--pen0', '--write-palette', '--plus-format',
]);
const BOOL_FLAGS = new Set([
  '--sprite', '--tiles', '--dedupe', '--masked', '--no-palette', '--plus-sprite', '--plus-palette',
  '--packed', '--spectrum', '--zx-sprite',
]);

/** The file stem img2cpc.py names its arrays after (Path.stem, non-alphanumerics to "_"). */
export function defaultName(imagePath: string): string {
  const base = imagePath.split('/').pop() ?? imagePath;
  const dot = base.lastIndexOf('.');
  const stemRaw = dot > 0 ? base.slice(0, dot) : base;
  const stem = [...stemRaw].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '_')).join('');
  return stem && !/^\d/.test(stem) ? stem : 'img_' + stem;
}

/** Path as Python's str(Path(p)) prints it (no "./", doubled or trailing slashes). */
export function normPath(p: string): string {
  const lead = p.startsWith('/') ? '/' : '';
  const rest = p.split('/').filter((s) => s !== '' && s !== '.');
  return rest.length ? lead + rest.join('/') : lead || '.';
}

/** Parses img2cpc.py's command line; throws Img2cpcError on a usage error. */
export function parseArgs(argv: readonly string[]): CliArgs {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let val: string | undefined;
    if (a.startsWith('--') && a.includes('=')) {
      val = a.slice(a.indexOf('=') + 1);
      a = a.slice(0, a.indexOf('='));
    }
    if (VALUE_FLAGS.has(a)) {
      if (val === undefined) {
        if (i + 1 >= argv.length) fail(`argument ${a}: expected one argument`);
        val = argv[++i];
      }
      flags.set(a === '-o' ? '--output' : a, val);
    } else if (BOOL_FLAGS.has(a) && val === undefined) {
      flags.set(a, true);
    } else if (a.startsWith('-') && a.length > 1) {
      fail(`unrecognized arguments: ${a}`);
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 1) fail(positional.length ? `unrecognized arguments: ${positional.slice(1).join(' ')}` : 'the following arguments are required: image');
  const has = (f: string): boolean => flags.has(f);
  const str = (f: string): string | undefined => {
    const v = flags.get(f);
    return typeof v === 'string' ? v : undefined;
  };
  const image = positional[0];

  let mode: Mode | undefined;
  if (has('--mode')) {
    const m = str('--mode')!;
    if (!['0', '1', '2'].includes(m)) fail(`argument --mode: invalid choice: '${m}' (choose from 0, 1, 2)`);
    mode = Number(m) as Mode;
  }
  const plus = has('--plus-sprite') || has('--plus-palette');
  const plusFormat = (str('--plus-format') ?? 'bas') as PlusFormat;
  if (!['bas', 'asm', 'bin'].includes(plusFormat)) fail(`argument --plus-format: invalid choice: '${plusFormat}' (choose from bas, asm, bin)`);
  if (has('--sprite') && has('--tiles')) fail('argument --tiles: not allowed with argument --sprite');
  if (has('--plus-sprite') && has('--plus-palette')) fail('use --plus-sprite or --plus-palette, not both');
  if (plus && has('--spectrum')) fail('--plus-* and --spectrum are exclusive');
  if (has('--packed') && !has('--plus-sprite')) fail('--packed needs --plus-sprite');
  if (plusFormat !== 'bas' && !plus) fail('--plus-format needs --plus-sprite or --plus-palette');
  if (plusFormat === 'bin' && !has('--output')) fail('--plus-format bin needs -o');
  if (!plus && !has('--spectrum') && mode === undefined) fail('--mode is required (or --spectrum, --plus-sprite, --plus-palette)');
  if (has('--zx-sprite') && !has('--spectrum')) fail('--zx-sprite needs --spectrum');
  let pen0: number | undefined;
  if (has('--pen0')) {
    const t = str('--pen0')!;
    if (!/^\s*[+-]?\d+\s*$/.test(t)) fail(`argument --pen0: invalid int value: '${t}'`);
    pen0 = parseInt(t, 10);
    if (pen0 < 0 || pen0 > 26) fail('--pen0 must be a firmware colour 0-26');
  }
  if (has('--palette') && has('--palette-file')) fail('use --palette or --palette-file, not both');
  if (has('--dedupe') && !has('--tiles')) fail('--dedupe needs --tiles');
  if (has('--frame') && has('--tiles')) fail('--frame is for sprites');
  let transparent: RGB | undefined;
  if (str('--transparent')) {
    const t = str('--transparent')!.replace(/^#+/, '');
    if (!/^[0-9a-fA-F]{6}$/.test(t)) fail('--transparent expects RRGGBB');
    transparent = [parseInt(t.slice(0, 2), 16), parseInt(t.slice(2, 4), 16), parseInt(t.slice(4, 6), 16)];
  }
  const options: Options = {
    name: str('--name') ?? defaultName(image),
    mode,
    tiles: has('--tiles'),
    frame: str('--frame'),
    dedupe: has('--dedupe'),
    masked: has('--masked'),
    transparent,
    palette: str('--palette'),
    pen0,
    noPalette: has('--no-palette'),
    spectrum: has('--spectrum'),
    zxSprite: has('--zx-sprite'),
    plusSprite: has('--plus-sprite'),
    plusPalette: has('--plus-palette'),
    packed: has('--packed'),
    plusFormat,
  };
  return { image, output: str('--output'), paletteFile: str('--palette-file'), writePalette: str('--write-palette'), options };
}

/** File access for `runCli`; paths are as given on the command line. */
export interface CliIo {
  readFile(path: string): Uint8Array;
  readText(path: string): string;
}

export interface CliResult {
  /** Text for stdout (when no -o was given). */
  stdout?: string;
  /** Files to write (-o, the .pal beside a plus bin, --write-palette). */
  files: { path: string; data: string | Uint8Array }[];
}

/** Runs img2cpc.py's command line (`argv` without the program name) with injected file access. */
export function runCli(argv: readonly string[], io: CliIo): CliResult {
  const a = parseArgs(argv);
  const o = a.options;
  if (a.paletteFile !== undefined) o.palette = io.readText(a.paletteFile);
  const img = decodePng(io.readFile(a.image));
  const r = convert(img, o, { argv, source: normPath(a.image) });
  const files: CliResult['files'] = [];
  if (a.writePalette && r.paletteFile) files.push({ path: a.writePalette, data: r.paletteFile });
  if (o.plusFormat === 'bin') {
    files.push({ path: a.output!, data: r.bin! });
    if (r.palBin) files.push({ path: a.output!.replace(/\.[^./]*$/, '') + '.pal', data: r.palBin });
    return { files };
  }
  if (a.output) {
    files.push({ path: a.output, data: r.text });
    return { files };
  }
  return { stdout: r.text, files };
}
