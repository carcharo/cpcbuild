/** geometry.ts -- the arithmetic of the zoomable pixel canvas (UX 2.3), pure so vitest can check it. */

/** Zoom steps (spec 4.2 US1: 1x-32x). */
export const ZOOM_STEPS: readonly number[] = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32];

export type AspectMode = 0 | 1 | 2 | 'plus';

/**
 * CSS width of a pixel as a multiple of its height (`aw`). "square" is 1. "crt" follows the virtual
 * 640x400 grid: mode 0 pixels are 2:1 wide, mode 1 1:1, mode 2 1:2 tall; a Plus sprite pixel is
 * magx / (2 * magy) (UX 2.3).
 */
export function aspectWidth(mode: AspectMode, aspect: 'square' | 'crt', magx = 2, magy = 1): number {
  if (aspect === 'square') return 1;
  if (mode === 'plus') return magx / (2 * magy);
  return mode === 0 ? 2 : mode === 1 ? 1 : 0.5;
}

/** A zoom/aspect pair is usable when the pixel width in CSS pixels is a whole number. */
export function zoomUsable(zoom: number, aw: number): boolean {
  return Number.isInteger(zoom * aw);
}

/** Next zoom step in a direction, skipping steps that would give a fractional pixel width. */
export function stepZoom(zoom: number, dir: 1 | -1, aw = 1): number {
  const steps = ZOOM_STEPS.filter((z) => zoomUsable(z, aw));
  if (dir > 0) return steps.find((z) => z > zoom) ?? steps[steps.length - 1];
  for (let i = steps.length - 1; i >= 0; i--) if (steps[i] < zoom) return steps[i];
  return steps[0];
}

/** The usable step closest to a wanted zoom (e.g. the defaultZoom setting). */
export function nearestZoom(zoom: number, aw = 1): number {
  const steps = ZOOM_STEPS.filter((z) => zoomUsable(z, aw));
  return steps.reduce((best, z) => (Math.abs(z - zoom) < Math.abs(best - zoom) ? z : best), steps[0]);
}

/** CSS size of the canvas stack. */
export function cssSize(w: number, h: number, zoom: number, aw: number): { width: number; height: number } {
  return { width: Math.round(w * zoom * aw), height: h * zoom };
}

/** A measured height below this is a layout that has not settled. */
export const MIN_FIT_H = 64;

/** Largest usable step that fits the area with a margin on every side ("Fit"). */
export function fitZoom(w: number, h: number, aw: number, availW: number, availH: number, margin = 16): number {
  if (availH < MIN_FIT_H) availH = Infinity; // an unsettled layout measures a sliver: fit by width alone, never collapse to 1x
  const steps = ZOOM_STEPS.filter((z) => zoomUsable(z, aw));
  let best = steps[0];
  for (const z of steps) {
    const s = cssSize(w, h, z, aw);
    if (s.width + 2 * margin <= availW && s.height + 2 * margin <= availH) best = z;
  }
  return best;
}

/** Pixel under a point given in CSS pixels relative to the canvas, or null outside. */
export function pixelAt(px: number, py: number, zoom: number, aw: number, w: number, h: number): { x: number; y: number } | null {
  const x = Math.floor(px / (zoom * aw));
  const y = Math.floor(py / zoom);
  return x >= 0 && y >= 0 && x < w && y < h ? { x, y } : null;
}

/** Byte-boundary grid spacing in pixels (UX 2.3): 2 / 4 / 8 for modes 0 / 1 / 2; none for Plus. */
export function byteGridEvery(mode: AspectMode): number {
  return mode === 0 ? 2 : mode === 1 ? 4 : mode === 2 ? 8 : 0;
}

/** Points of the line between two pixels (Bresenham), both ends included, so fast drags leave no gaps. */
export function line(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Clamp a cursor move to the image; a byte-sized move (Ctrl+Arrow) lands on byte boundaries. */
export function moveCursor(c: { x: number; y: number }, dx: number, dy: number, w: number, h: number, bytePx = 1): { x: number; y: number } {
  let x = c.x + dx * bytePx;
  if (bytePx > 1 && dx !== 0) x = dx > 0 ? Math.floor(c.x / bytePx) * bytePx + bytePx : Math.ceil(c.x / bytePx) * bytePx - bytePx;
  return { x: Math.max(0, Math.min(w - 1, x)), y: Math.max(0, Math.min(h - 1, c.y + dy)) };
}
