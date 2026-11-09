/**
 * cpcPreview.ts -- what an image looks like in each CPC mode: pixel shape, screen size, and the pen limit.
 *
 * Pure TypeScript, no DOM, no vscode: runs in the extension host and in webviews. The pen reduction is
 * deterministic: keep the most-used colours, map every other colour to the nearest kept one.
 */
import { MAXPENS, type Mode } from './pixels';
import { FW_NAMES, FW_TABLE, dist2, nearestFw, type RGB } from './palette';

export interface PreviewColour { rgb: RGB; name: string }
/** `pixels` holds indices into `palette`; 255 is transparent. */
export interface IndexedImage { w: number; h: number; pixels: Uint8Array; palette: PreviewColour[] }
export const TRANSPARENT = 255;

/** Width of one pixel in mode-1 pixel units. */
export const PIXEL_SHAPE: Record<Mode, number> = { 0: 2, 1: 1, 2: 0.5 };
export const SCREEN: Record<Mode, { w: number; h: number }> = { 0: { w: 160, h: 200 }, 1: { w: 320, h: 200 }, 2: { w: 640, h: 200 } };

export function shapeLabel(mode: Mode): string {
  return mode === 0 ? '2 : 1' : mode === 1 ? '1 : 1' : '1 : 2';
}

function fwColour(n: number): PreviewColour {
  return { rgb: FW_TABLE[n], name: FW_NAMES[n] };
}

/** pens[i] = firmware colour (0-26) of pen i. */
export function fromFirmware(w: number, h: number, pixels: Uint8Array, pens: number[]): IndexedImage {
  return { w, h, pixels, palette: pens.map(fwColour) };
}

/** Each opaque pixel becomes its nearest firmware colour; the palette lists the distinct ones in first-appearance order. */
export function fromRgba(w: number, h: number, rgba: Uint8ClampedArray | Uint8Array, alphaCut = 128): IndexedImage {
  const pixels = new Uint8Array(w * h);
  const palette: PreviewColour[] = [];
  const slot = new Map<number, number>();
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < alphaCut) { pixels[i] = TRANSPARENT; continue; }
    const fw = nearestFw([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
    let s = slot.get(fw);
    if (s === undefined) { s = palette.length; slot.set(fw, s); palette.push(fwColour(fw)); }
    pixels[i] = s;
  }
  return { w, h, pixels, palette };
}

/** Indices are into the INPUT palette. */
export interface Merge { from: number; to: number; fromName: string; toName: string; pixels: number }
export interface Reduced {
  mode: Mode; limit: number;
  used: number;
  fits: boolean;
  kept: number[];
  pixels: Uint8Array;
  merges: Merge[];
}

export function reducePens(img: IndexedImage, mode: Mode): Reduced {
  const limit = MAXPENS[mode];
  const n = img.palette.length;
  const count = new Array<number>(n).fill(0);
  const first = new Array<number>(n).fill(-1);
  for (let i = 0; i < img.pixels.length; i++) {
    const p = img.pixels[i];
    if (p === TRANSPARENT || p >= n) continue;
    count[p]++;
    if (first[p] < 0) first[p] = i;
  }
  const order: number[] = [];
  for (let i = 0; i < n; i++) if (count[i] > 0) order.push(i);
  order.sort((a, b) => count[b] - count[a] || first[a] - first[b]);
  const used = order.length;
  if (used <= limit) return { mode, limit, used, fits: true, kept: order, pixels: img.pixels.slice(), merges: [] };
  const kept = order.slice(0, limit);
  const target = new Array<number>(n).fill(-1);
  for (const k of kept) target[k] = k;
  const merges: Merge[] = [];
  for (const f of order.slice(limit)) {
    let best = kept[0];
    let bd = dist2(img.palette[f].rgb, img.palette[best].rgb);
    for (const k of kept) {
      const d = dist2(img.palette[f].rgb, img.palette[k].rgb);
      if (d < bd) { bd = d; best = k; }
    }
    target[f] = best;
    merges.push({ from: f, to: best, fromName: img.palette[f].name, toName: img.palette[best].name, pixels: count[f] });
  }
  merges.sort((a, b) => b.pixels - a.pixels); // stable: ties keep the most-used-first order
  const pixels = img.pixels.map((p) => (p === TRANSPARENT || p >= n ? p : target[p]));
  return { mode, limit, used, fits: false, kept, pixels, merges };
}

const colours = (n: number): string => `${n} ${n === 1 ? 'colour' : 'colours'}`;

export function mergeNote(r: Reduced): string {
  if (r.fits) return `fits: ${colours(r.used)}`;
  const head = `${colours(r.used)} → ${r.kept.length}: `;
  const names = r.merges.map((m) => m.fromName.toLowerCase());
  if (names.length > 3) return `${head}${colours(names.length)} merged`;
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${head}${list} merged`;
}

export function pensLabel(r: Reduced): string {
  return r.fits ? `${r.used} of ${r.limit} pens` : `${r.limit} of ${r.limit} pens (${r.used} colours)`;
}

/** The display area (640x400 frame units, two frame rows per CPC line) centred in a 768x544 frame. */
export const FRAME = { w: 768, h: 544, displayX: 64, displayY: 72, displayW: 640, displayH: 400 };
const ON_SCREEN: Record<Mode, { w: number; h: number }> = { 0: { w: 4, h: 2 }, 1: { w: 2, h: 2 }, 2: { w: 1, h: 2 } };
/** Frame units per CPC pixel. */
export function onScreenPixel(mode: Mode): { w: number; h: number } {
  return { ...ON_SCREEN[mode] };
}
export function onScreenSize(img: { w: number; h: number }, mode: Mode): { w: number; h: number; fits: boolean } {
  const p = ON_SCREEN[mode];
  return { w: img.w * p.w, h: img.h * p.h, fits: img.w <= SCREEN[mode].w && img.h <= SCREEN[mode].h };
}

/** Display size for the preview canvas in whole CSS px, so pixels stay crisp. */
export function displaySize(img: { w: number; h: number }, mode: Mode, scale: number): { w: number; h: number; px: number; py: number } {
  const px = scale * PIXEL_SHAPE[mode];
  return { w: img.w * px, h: img.h * scale, px, py: scale };
}

/** Largest scale whose display fits maxW x maxH with a whole-number px (mode 2: even scale); at least 1 (mode 2: 2). */
export function fitScale(img: { w: number; h: number }, mode: Mode, maxW: number, maxH: number): number {
  const min = mode === 2 ? 2 : 1;
  if (img.w <= 0 || img.h <= 0) return min;
  let s = Math.floor(Math.min(maxW / (img.w * PIXEL_SHAPE[mode]), maxH / img.h));
  if (mode === 2) s -= s % 2;
  return Math.max(min, s);
}
