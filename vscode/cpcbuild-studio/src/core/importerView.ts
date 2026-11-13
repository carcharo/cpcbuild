/**
 * importerView.ts -- the pure parts of the image importer's view (R5): the result-state pill, the images the CPC
 * preview shows, and the colour-mapping rows. No DOM, no vscode, nothing that reads files
 * (it does not import the converter, so the webview bundle stays small).
 */
import { gridLayout, type GridSpec } from './cpcgrid';
import { fromRgba, TRANSPARENT, type IndexedImage, type PreviewColour } from './cpcPreview';
import { FW_NAMES, type RGB } from './palette';

/** The slice of a Preview these helpers read (structurally the same as cpcimp's Preview). */
export interface PreviewLike {
  width: number;
  height: number;
  indices: number[];
  rows: { pen: number; label: string; rgb: [number, number, number]; colours: number; pixels: number }[];
  transparent: number;
}

export interface RgbaSource {
  width: number;
  height: number;
  rgba: Uint8ClampedArray | Uint8Array;
}

export interface ResultState {
  state: 'ok' | 'warn' | 'bad';
  text: string;
  title: string;
}

/** F17: the toolbar's result pill. An error wins; then an output that is missing or older than its inputs. */
export function resultState(v: { error: boolean; stale: boolean; outputExists: boolean; output?: string }): ResultState {
  const name = v.output ?? 'the output';
  if (v.error) return { state: 'bad', text: 'Error', title: 'The converter or the source image reported an error; the details are above.' };
  if (v.stale) return { state: 'warn', text: 'Out of date', title: v.outputExists ? `${name} is older than this recipe or its image. Generate writes it again.` : `${name} has not been generated yet.` };
  return { state: 'ok', text: 'Result up to date', title: `${name} is newer than this recipe and its image.` };
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
export const rgbHex = (c: readonly [number, number, number]): string => `${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
/** "RRGGBB" (a leading # is allowed) to a colour, or undefined. */
export function parseHexRgb(t: string | undefined): [number, number, number] | undefined {
  const m = t ? /^#?([0-9a-f]{6})$/i.exec(t.trim()) : null;
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : undefined;
}

/** What the converter sees: the source, or the sheet joined from the grid's chosen cells (the same layout as composeSheet). */
export function composedSource(src: RgbaSource, grid?: GridSpec): RgbaSource | undefined {
  if (!grid) return src;
  const lay = gridLayout(grid, src.width, src.height);
  if (!lay.cols || !lay.rows || !lay.selected.length) return undefined;
  const w = lay.sheetCols * grid.cellW, h = lay.sheetRows * grid.cellH;
  const out = new Uint8ClampedArray(w * h * 4);
  lay.selected.forEach((cell, n) => {
    const sx = grid.marginX + (cell % lay.cols) * (grid.cellW + grid.spacingX);
    const sy = grid.marginY + Math.floor(cell / lay.cols) * (grid.cellH + grid.spacingY);
    const dx = (n % lay.sheetCols) * grid.cellW, dy = Math.floor(n / lay.sheetCols) * grid.cellH;
    for (let y = 0; y < grid.cellH; y++) {
      const from = ((sy + y) * src.width + sx) * 4;
      out.set(src.rgba.subarray(from, from + grid.cellW * 4), ((dy + y) * w + dx) * 4);
    }
  });
  return { width: w, height: h, rgba: out };
}

/**
 * The image the CPC preview shows for a mode other than the recipe's: the converter's input (grid applied, the recipe's
 * transparent colour and alpha < 128 transparent), every opaque pixel at its nearest firmware colour, so reducePens shows the merges.
 */
export function previewSourceImage(src: RgbaSource, r: { grid?: GridSpec; transparent?: string }): IndexedImage | undefined {
  const c = composedSource(src, r.grid);
  if (!c) return undefined;
  const key = parseHexRgb(r.transparent);
  let rgba = c.rgba;
  if (key) {
    const copy = new Uint8ClampedArray(c.rgba);
    for (let i = 0; i < c.width * c.height; i++) if (copy[i * 4] === key[0] && copy[i * 4 + 1] === key[1] && copy[i * 4 + 2] === key[2]) copy[i * 4 + 3] = 0;
    rgba = copy;
  }
  return fromRgba(c.width, c.height, rgba);
}

/** The converter's result for the recipe's own mode as an indexed image (palette = the pens, in pen order). */
export function previewResultImage(p: PreviewLike): IndexedImage {
  const palette: PreviewColour[] = p.rows.map((row) => ({ rgb: row.rgb as RGB, name: FW_NAMES[Number(row.label)] ?? row.label }));
  const pixels = new Uint8Array(p.indices.length);
  for (let i = 0; i < pixels.length; i++) pixels[i] = p.indices[i] < palette.length ? p.indices[i] : TRANSPARENT;
  return { w: p.width, h: p.height, pixels, palette };
}

export interface MapRow {
  key: string;
  /** The source colour, or undefined for a pen no source colour uses. */
  src?: [number, number, number];
  pen: PreviewLike['rows'][number];
  /** Pixels of this source colour (for an unused pen: 0). */
  pixels: number;
  /** The pen's colour is not exactly the source colour. */
  nearest: boolean;
  /** Another pen has the same colour. */
  duplicate: boolean;
  unused: boolean;
}
export interface MapTable {
  rows: MapRow[];
  /** Source colours left out of `rows` (the cap). */
  more: number;
  transparentPixels: number;
}

/**
 * Colour mapping rows: each source colour with the pen it landed on, then the pens nothing landed on. Needs the converter's
 * input (same size as the preview); without it each used pen is one row. At most `cap` source colours are listed.
 */
export function mappingRows(p: PreviewLike, input: RgbaSource | undefined, cap = 64): MapTable {
  const labels = new Map<string, number>();
  p.rows.forEach((row) => labels.set(row.label, (labels.get(row.label) ?? 0) + 1));
  const dup = (row: PreviewLike['rows'][number]): boolean => (labels.get(row.label) ?? 0) > 1;
  const rows: MapRow[] = [];
  let more = 0;
  const usable = !!input && input.width === p.width && input.height === p.height && input.width * input.height === p.indices.length;
  if (usable && input) {
    const seen = new Map<number, number>(); // pen * 2^24 + rgb -> pixels
    const order: number[] = [];
    for (let i = 0; i < p.indices.length; i++) {
      const pen = p.indices[i];
      if (pen >= p.rows.length) continue;
      const k = pen * 16777216 + input.rgba[i * 4] * 65536 + input.rgba[i * 4 + 1] * 256 + input.rgba[i * 4 + 2];
      const n = seen.get(k);
      if (n === undefined) { seen.set(k, 1); order.push(k); } else seen.set(k, n + 1);
    }
    order.sort((a, b) => Math.floor(a / 16777216) - Math.floor(b / 16777216) || (seen.get(b) ?? 0) - (seen.get(a) ?? 0) || a - b);
    for (const k of order) {
      if (rows.length >= cap) { more++; continue; }
      const pen = p.rows[Math.floor(k / 16777216)];
      const rgb = k % 16777216;
      const src: [number, number, number] = [Math.floor(rgb / 65536), Math.floor(rgb / 256) % 256, rgb % 256];
      rows.push({ key: `${pen.pen}-${rgbHex(src)}`, src, pen, pixels: seen.get(k) ?? 0, nearest: src[0] !== pen.rgb[0] || src[1] !== pen.rgb[1] || src[2] !== pen.rgb[2], duplicate: dup(pen), unused: false });
    }
    for (const pen of p.rows) if (!order.some((k) => Math.floor(k / 16777216) === pen.pen)) rows.push({ key: `${pen.pen}-unused`, pen, pixels: 0, nearest: false, duplicate: dup(pen), unused: true });
    rows.sort((a, b) => Number(a.unused) - Number(b.unused) || a.pen.pen - b.pen.pen);
  } else {
    for (const pen of p.rows) rows.push({ key: `${pen.pen}-pen`, pen, pixels: pen.pixels, nearest: false, duplicate: dup(pen), unused: pen.pixels === 0 });
    rows.sort((a, b) => Number(a.unused) - Number(b.unused) || a.pen.pen - b.pen.pen);
  }
  return { rows, more, transparentPixels: p.transparent };
}
