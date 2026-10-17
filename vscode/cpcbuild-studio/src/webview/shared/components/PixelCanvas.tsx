/**
 * <cb-canvas> (UX 2.3): two stacked canvases in a scroll container.
 *  - the pixel layer is the image at document resolution, scaled by CSS with image-rendering: pixelated;
 *  - the overlay is at device resolution and draws the grids, selection and cursor, so lines stay one
 *    device pixel crisp at any zoom. It takes no pointer events: one handler sits on the container.
 * `aw` is the pixel width as a multiple of the zoom (the aspect, see geometry.aspectWidth).
 * The host never sends CPC bytes: the image is RGBA the webview paints, whose pens it got from the host.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Rect, cssSize, moveCursor, pixelAt } from '../geometry';
import { themeVar, useThemeVersion, withAlpha, isHighContrast } from '../theme';

export interface PixelImage {
  width: number;
  height: number;
  /** width*height*4 bytes, RGBA. Alpha 0 shows the checkerboard. */
  rgba: Uint8ClampedArray;
}

export interface GridOptions {
  /** 1 px line between pixels (hidden below zoom 4). */
  pixel?: boolean;
  /** Heavier line every n pixels horizontally (the byte grid: 2 / 4 / 8), 0 or absent for none. */
  byteEvery?: number;
  /** Dashed line every n pixels in both directions (tile grid). */
  tileEvery?: number;
}

export interface PointerInfo {
  kind: 'down' | 'move' | 'up';
  x: number;
  y: number;
  buttons: number;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

export interface PixelCanvasProps {
  image: PixelImage;
  zoom: number;
  aw?: number;
  grid?: GridOptions;
  selection?: Rect | null;
  /** Keyboard cursor / hover pixel (drawn as a two-pass outline). */
  cursor?: { x: number; y: number } | null;
  /** aria-label, e.g. "Sprite hero, frame 1 of 4, 16 by 16 pixels, mode 1". */
  label: string;
  /** Pixels per byte, used by Ctrl+Arrow. */
  bytePx?: number;
  /** Redraw only this rectangle of the pixel layer when the image changes (otherwise all). */
  dirty?: Rect | null;
  onPointer?(e: PointerInfo): void;
  onCursor?(c: { x: number; y: number }): void;
  /** Space on the keyboard cursor: apply the active tool there. */
  onApply?(c: { x: number; y: number }): void;
  /** Ctrl/Cmd+wheel: zoom in (-1 deltaY) or out. */
  onZoomWheel?(dir: 1 | -1, pixel: { x: number; y: number } | null): void;
}

export function PixelCanvas(p: PixelCanvasProps) {
  const aw = p.aw ?? 1;
  const size = cssSize(p.image.width, p.image.height, p.zoom, aw);
  const pix = useRef<HTMLCanvasElement>(null);
  const ov = useRef<HTMLCanvasElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const theme = useThemeVersion();
  const [live, setLive] = useState('');
  const lastAnnounce = useRef(0);
  const down = useRef(false);

  // pixel layer
  useEffect(() => {
    const c = pix.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const { width, height, rgba } = p.image;
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const data = new ImageData(new Uint8ClampedArray(rgba), width, height);
    if (p.dirty) ctx.putImageData(data, 0, 0, p.dirty.x, p.dirty.y, p.dirty.w, p.dirty.h);
    else ctx.putImageData(data, 0, 0);
  }, [p.image, p.dirty]);

  // overlay, in rAF
  useEffect(() => {
    const raf = requestAnimationFrame(() => drawOverlay(ov.current, p, aw, size));
    return () => cancelAnimationFrame(raf);
  }, [p.zoom, aw, p.grid?.pixel, p.grid?.byteEvery, p.grid?.tileEvery, p.selection, p.cursor, p.image.width, p.image.height, theme, size.width, size.height]);

  const at = (e: PointerEvent): { x: number; y: number } | null => {
    const r = stack.current?.getBoundingClientRect();
    if (!r) return null;
    return pixelAt(e.clientX - r.left, e.clientY - r.top, p.zoom, aw, p.image.width, p.image.height);
  };
  const emit = (kind: PointerInfo['kind'], e: PointerEvent): void => {
    const px = at(e);
    if (px && p.onPointer) p.onPointer({ kind, x: px.x, y: px.y, buttons: e.buttons, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey });
  };
  const announce = (text: string): void => {
    const now = Date.now();
    if (now - lastAnnounce.current < 250) return;
    lastAnnounce.current = now;
    setLive(text);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const c = p.cursor ?? { x: 0, y: 0 };
    const d: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (d[e.key] && p.onCursor) {
      e.preventDefault();
      const n = moveCursor(c, d[e.key][0], d[e.key][1], p.image.width, p.image.height, e.ctrlKey ? p.bytePx ?? 1 : 1);
      p.onCursor(n);
      announce(`x ${n.x}, y ${n.y}`);
    } else if (e.key === 'Home' && p.onCursor) { e.preventDefault(); p.onCursor({ x: 0, y: c.y }); }
    else if (e.key === 'End' && p.onCursor) { e.preventDefault(); p.onCursor({ x: p.image.width - 1, y: c.y }); }
    else if (e.key === ' ' && p.onApply) { e.preventDefault(); p.onApply(c); }
  };
  return (
    <div
      class="cb-canvas"
      role="application"
      aria-roledescription="pixel canvas"
      aria-label={p.label}
      tabIndex={0}
      onKeyDown={onKeyDown as never}
      onWheel={(e) => {
        if ((e.ctrlKey || e.metaKey) && p.onZoomWheel) {
          e.preventDefault();
          const r = stack.current?.getBoundingClientRect();
          p.onZoomWheel(e.deltaY < 0 ? 1 : -1, r ? pixelAt(e.clientX - r.left, e.clientY - r.top, p.zoom, aw, p.image.width, p.image.height) : null);
        }
      }}
    >
      <div
        class="cb-canvas-stack"
        ref={stack}
        style={{ width: `${size.width}px`, height: `${size.height}px` }}
        onPointerDown={(e) => { down.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); emit('down', e); }}
        onPointerMove={(e) => emit('move', e)}
        onPointerUp={(e) => { down.current = false; emit('up', e); }}
      >
        <canvas ref={pix} class="cb-canvas-pixels" width={p.image.width} height={p.image.height} style={{ width: `${size.width}px`, height: `${size.height}px` }} />
        <canvas ref={ov} class="cb-canvas-overlay" />
      </div>
      <div class="cb-visually-hidden" aria-live="polite">{live}</div>
    </div>
  );
}

function drawOverlay(c: HTMLCanvasElement | null, p: PixelCanvasProps, aw: number, size: { width: number; height: number }): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(size.width * dpr), H = Math.round(size.height * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  c.style.width = `${size.width}px`;
  c.style.height = `${size.height}px`;
  ctx.clearRect(0, 0, W, H);
  const fg = themeVar('--vscode-editor-foreground', '#cccccc');
  const bg = themeVar('--vscode-editor-background', '#1e1e1e');
  const hc = isHighContrast();
  const sx = p.zoom * aw * dpr, sy = p.zoom * dpr;
  const { width: iw, height: ih } = p.image;
  const lines = (every: number, colour: string, lw: number, dash?: number[]): void => {
    ctx.strokeStyle = colour;
    ctx.lineWidth = lw;
    ctx.setLineDash(dash ?? []);
    ctx.beginPath();
    for (let x = every; x < iw; x += every) { const px = Math.round(x * sx) + 0.5 * (lw % 2); ctx.moveTo(px, 0); ctx.lineTo(px, H); }
    ctx.stroke();
  };
  const g = p.grid;
  if (g?.pixel && p.zoom >= 4) {
    lines(1, withAlpha(fg, hc ? 0.8 : 0.25), 1);
    ctx.strokeStyle = withAlpha(fg, hc ? 0.8 : 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 1; y < ih; y++) { const py = Math.round(y * sy) + 0.5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
    ctx.stroke();
  }
  if (g?.byteEvery) lines(g.byteEvery, hc ? themeVar('--vscode-contrastActiveBorder', fg) : withAlpha(fg, 0.6), 2);
  if (g?.tileEvery) {
    for (const [colour, off] of [[fg, 0], [bg, 4]] as const) {
      ctx.strokeStyle = colour; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); ctx.lineDashOffset = off;
      ctx.beginPath();
      for (let x = g.tileEvery; x < iw; x += g.tileEvery) { const px = Math.round(x * sx) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, H); }
      for (let y = g.tileEvery; y < ih; y += g.tileEvery) { const py = Math.round(y * sy) + 0.5; ctx.moveTo(0, py); ctx.lineTo(W, py); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  const box = (r: Rect, lw: number): void => {
    for (const [colour, grow] of [[bg, lw], [fg, 0]] as const) {
      ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.setLineDash([]);
      ctx.strokeRect(r.x * sx + 0.5 - grow, r.y * sy + 0.5 - grow, r.w * sx - 1 + 2 * grow, r.h * sy - 1 + 2 * grow);
    }
  };
  if (p.selection) box(p.selection, hc ? 2 : 1);
  if (p.cursor) box({ x: p.cursor.x, y: p.cursor.y, w: 1, h: 1 }, 1);
}
