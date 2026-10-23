/**
 * model.ts -- the sprite editor webview's pure helpers (no DOM, so vitest can check them): decoding the
 * host's view, painting RGBA, composing the tile views, the point sets of a drag, and the pen slots.
 */
import { FW_NAMES, fwRgb, rgb12To8, type RGB } from '../../core/palette';
import { MAXPENS, type Mode } from '../../core/pixels';
import type { Grid, Rect } from '../../core/spriteDoc';
import { rowsToGrid } from '../../core/spriteDoc';
import { ellipseCells, lineCells, mirrorPoints, rectCells, snapLine, type Pt } from '../../core/shapes';
import type { SpriteView } from '../../shared/spriteProtocol';
import type { PenSlot } from '../shared/components/PenStrip';

const rgbCss = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export const TRANSPARENT = -1;

export function decodeItems(v: SpriteView): Grid[] {
  const plus = v.kind === 'plus';
  return v.items.map((rows) => rowsToGrid(rows, v.w, v.h, plus));
}

/** Colour of a pen (CPC) or sprite colour (Plus); undefined = transparent or not in the palette. */
export function colourOf(v: Pick<SpriteView, 'kind' | 'pens' | 'colours'>, value: number): RGB | undefined {
  if (value < 0) return undefined;
  if (v.kind === 'plus') {
    const c = v.colours?.[value - 1];
    return c ? rgb12To8([parseInt(c[0], 16), parseInt(c[1], 16), parseInt(c[2], 16)]) : undefined;
  }
  const p = v.pens?.[value];
  return p === undefined ? undefined : fwRgb(p);
}

/** Shown for a pen the palette does not define (drawn in the file but unset). */
const MISSING: RGB = [128, 128, 128];

/** RGBA pixels of a grid; transparent = alpha 0; `alpha` scales the opacity (onion skin, dimmed neighbours). */
export function renderRgba(g: Grid, v: Pick<SpriteView, 'kind' | 'pens' | 'colours'>, alpha = 255): Uint8ClampedArray {
  const h = g.length, w = h ? g[0].length : 0;
  const out = new Uint8ClampedArray(w * h * 4);
  const cache = new Map<number, RGB>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const val = g[y][x];
      if (val < 0) continue;
      let c = cache.get(val);
      if (!c) {
        c = colourOf(v, val) ?? MISSING;
        cache.set(val, c);
      }
      const i = (y * w + x) * 4;
      out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = alpha;
    }
  return out;
}

/** Draws `top` over `under` (alpha 0 of top shows under). Same size. */
export function overlayRgba(under: Uint8ClampedArray, top: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(under);
  for (let i = 0; i < top.length; i += 4) if (top[i + 3] > 0) { out[i] = top[i]; out[i + 1] = top[i + 1]; out[i + 2] = top[i + 2]; out[i + 3] = top[i + 3]; }
  return out;
}

/** Copies the RGBA of a w x h block into a larger canvas at (ox, oy). */
export function blit(dst: Uint8ClampedArray, dw: number, src: Uint8ClampedArray, sw: number, sh: number, ox: number, oy: number): void {
  for (let y = 0; y < sh; y++) dst.set(src.subarray(y * sw * 4, (y + 1) * sw * 4), ((oy + y) * dw + ox) * 4);
}

/** The tile edit view (w x 8): the tile in the middle with its eight sheet neighbours dimmed (UX 3.3). Returns 3w x 24 RGBA. */
export function neighbourView(items: Grid[], index: number, cols: number, v: SpriteView): { rgba: Uint8ClampedArray; width: number; height: number; neighbours: (number | null)[] } {
  const n = v.w, m = v.h;
  const width = n * 3, height = m * 3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const neighbours: (number | null)[] = [];
  const col = index % cols;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = col + dx;
      const i = index + dy * cols + dx;
      const ok = cx >= 0 && cx < cols && i >= 0 && i < items.length;
      if (dx || dy) neighbours.push(ok ? i : null);
      if (!ok) continue;
      const own = dx === 0 && dy === 0;
      blit(rgba, width, renderRgba(items[i], v, own ? 255 : 110), n, m, (dx + 1) * n, (dy + 1) * m);
    }
  return { rgba, width, height, neighbours };
}

/** Tile `t` of the 2x2 view: tiles 4t..4t+3 as top-left, top-right, bottom-left, bottom-right (library.md 7.5). */
export function tile16(items: Grid[], t: number, v: SpriteView): Uint8ClampedArray {
  const n = v.w, m = v.h;
  const rgba = new Uint8ClampedArray(4 * n * m * 4);
  for (let k = 0; k < 4; k++) {
    const g = items[4 * t + k];
    if (g) blit(rgba, 2 * n, renderRgba(g, v), n, m, (k & 1) * n, (k >> 1) * m);
  }
  return rgba;
}

/** Which tile (index) and local pixel a point of the 2x2 view belongs to (tiles n x m pixels). */
export function tile16Target(t: number, x: number, y: number, n = 8, m = 8): { item: number; x: number; y: number } {
  return { item: 4 * t + (x >= n ? 1 : 0) + (y >= m ? 2 : 0), x: x % n, y: y % m };
}

export type ShapeTool = 'line' | 'rect' | 'ellipse';

/** The pixels of a line / rectangle / ellipse drag (UX 4.1): Shift snaps the line or squares the box, Alt grows from the centre. */
export function shapeCells(tool: ShapeTool, a: Pt, b: Pt, o: { filled?: boolean; shift?: boolean; alt?: boolean } = {}): Pt[] {
  let [x0, y0] = a;
  let [x1, y1] = b;
  if (tool === 'line') {
    if (o.shift) [x1, y1] = snapLine(x0, y0, x1, y1);
    return lineCells(x0, y0, x1, y1);
  }
  if (o.shift) {
    const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    x1 = x0 + (x1 >= x0 ? d : -d);
    y1 = y0 + (y1 >= y0 ? d : -d);
  }
  if (o.alt) {
    const dx = x1 - x0, dy = y1 - y0;
    [x0, y0, x1, y1] = [x0 - dx, y0 - dy, x0 + dx, y0 + dy];
  }
  return tool === 'rect' ? rectCells(x0, y0, x1, y1, !!o.filled) : ellipseCells(x0, y0, x1, y1, !!o.filled);
}

/** Applies mirror stamps, clips to the frame, and returns each pixel once (the last stamp wins). */
export function stamps(points: Pt[], w: number, h: number, mx: boolean, my: boolean): Pt[] {
  const seen = new Map<number, Pt>();
  for (const [x, y] of points)
    for (const [px, py] of mirrorPoints(x, y, w, h, mx, my)) if (px >= 0 && py >= 0 && px < w && py < h) seen.set(py * 4096 + px, [px, py]);
  return [...seen.values()];
}

/** A copy of `g` with the pixels set. */
export function withPixels(g: Grid, pts: readonly Pt[], value: number): Grid {
  const out = g.map((r) => r.slice());
  for (const [x, y] of pts) if (out[y]?.[x] !== undefined) out[y][x] = value;
  return out;
}

export function clipRect(r: Rect, w: number, h: number): Rect | null {
  const x0 = Math.max(0, r.x), y0 = Math.max(0, r.y), x1 = Math.min(w, r.x + r.w), y1 = Math.min(h, r.y + r.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/** Rectangle between two points, inclusive. */
export function rectBetween(a: Pt, b: Pt): Rect {
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

export function insideRect(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

export function copyRect(g: Grid, r: Rect): Grid {
  return g.slice(r.y, r.y + r.h).map((row) => row.slice(r.x, r.x + r.w));
}

// ------------------------------------------------------------------ pens

const hex3 = (c: string): string => c.toUpperCase();

/** Slots of the pen strip: the transparent slot (masked sprites, Plus) then the pens / colours of the mode. */
export function penSlots(v: SpriteView): PenSlot[] {
  const slots: PenSlot[] = [];
  const transparent = v.kind === 'plus' || (v.docType === 'spr' && v.masked);
  if (transparent) slots.push({ index: TRANSPARENT, number: 'none', name: 'nothing drawn (transparent)' });
  if (v.kind === 'plus') {
    const cols = v.colours ?? [];
    for (let i = 0; i < cols.length; i++) {
      const c = colourOf(v, i + 1) as RGB;
      slots.push({ index: i + 1, colour: rgbCss(c), number: hex3(cols[i]), name: '' });
    }
    return slots;
  }
  const pens = v.pens ?? [];
  const seen = new Map<number, number>();
  const count = MAXPENS[v.mode];
  for (let i = 0; i < count; i++) {
    if (i >= pens.length) {
      slots.push({ index: i, unset: true, number: '', name: '' });
      continue;
    }
    const fw = pens[i];
    const dup = seen.get(fw);
    if (dup === undefined) seen.set(fw, i);
    slots.push({
      index: i,
      colour: rgbCss(fwRgb(fw)),
      number: String(fw),
      name: (FW_NAMES[fw] ?? '').toLowerCase(),
      warn: dup !== undefined ? `Same colour as pen ${dup}: a PNG round trip through the importer merges them into pen ${dup}` : undefined,
    });
  }
  return slots;
}

/** Highest pen / colour number that can be painted. */
export function topValue(v: SpriteView): number {
  if (v.kind === 'plus') return v.colours?.length ?? 0;
  return Math.min(MAXPENS[v.mode], v.pens?.length ?? 0) - 1;
}

export function describeValue(v: SpriteView, value: number): string {
  if (value < 0) return 'transparent';
  if (v.kind === 'plus') return `colour ${value}${v.colours?.[value - 1] ? ` ${hex3(v.colours[value - 1])}` : ''}`;
  const p = v.pens?.[value];
  return p === undefined ? `pen ${value} (unset)` : `pen ${value} = ${p} ${(FW_NAMES[p] ?? '').toLowerCase()}`;
}

/** Modes: pixel aspect key for geometry.aspectWidth. */
export const aspectKey = (v: Pick<SpriteView, 'kind' | 'mode'>): Mode | 'plus' => (v.kind === 'plus' ? 'plus' : v.mode);
