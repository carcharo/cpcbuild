/**
 * canvases.tsx -- the importer's two pictures: the source sheet with the grid overlay (cells can be
 * included / excluded by pointer or keyboard, a colour can be picked for --transparent) and the CPC
 * result, drawn from the pen indices and palette the host's converter sent (the webview never
 * quantises).
 */
import { useEffect, useRef } from 'preact/hooks';
import { gridLayout, type GridSpec } from '../../core/cpcgrid';
import type { Preview } from '../../shared/importerProtocol';
import { themeVar, useThemeVersion, withAlpha } from '../shared/theme';

export interface SourcePixels {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const CHECK_A = '#8884', CHECK_B = '#fff2';

function checker(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.clearRect(0, 0, w, h);
  const s = 8;
  for (let y = 0; y < h; y += s)
    for (let x = 0; x < w; x += s) {
      ctx.fillStyle = ((x / s + y / s) & 1) === 0 ? CHECK_A : CHECK_B;
      ctx.fillRect(x, y, s, s);
    }
}

function bitmapOf(width: number, height: number, rgba: Uint8ClampedArray): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = width;
  off.height = height;
  off.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return off;
}

export interface CellRect {
  x: number;
  y: number;
}

/** Pixel rectangle of grid cell `i` in the source. */
export function cellRect(g: GridSpec, cols: number, i: number): { x: number; y: number; w: number; h: number } {
  return { x: g.marginX + (i % cols) * (g.cellW + g.spacingX), y: g.marginY + Math.floor(i / cols) * (g.cellH + g.spacingY), w: g.cellW, h: g.cellH };
}

/** Index of the cell under a source pixel, or -1. */
export function cellAt(g: GridSpec, cols: number, rows: number, px: number, py: number): number {
  const cx = Math.floor((px - g.marginX) / (g.cellW + g.spacingX));
  const cy = Math.floor((py - g.marginY) / (g.cellH + g.spacingY));
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
  const r = cellRect(g, cols, cy * cols + cx);
  return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h ? cy * cols + cx : -1;
}

export interface SourceCanvasProps {
  src: SourcePixels;
  zoom: number;
  grid?: GridSpec;
  /** Frame size drawn as a plain overlay when there is no grid. */
  frame?: { w: number; h: number };
  showGrid: boolean;
  pick: boolean;
  cursor: number;
  onCursor(i: number): void;
  onCells(cells: number[], include: boolean): void;
  onPick(rgb: [number, number, number] | null): void;
  label: string;
}

export function SourceCanvas(p: SourceCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const paint = useRef<{ include: boolean; seen: Set<number> } | null>(null);
  const lay = p.grid ? gridLayout(p.grid, p.src.width, p.src.height) : undefined;
  const excluded = new Set(p.grid?.exclude ?? []);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { width: w, height: h } = p.src;
    c.width = w * p.zoom;
    c.height = h * p.zoom;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    checker(ctx, c.width, c.height);
    ctx.drawImage(bitmapOf(w, h, p.src.rgba), 0, 0, c.width, c.height);
    if (!p.showGrid) return;
    const line = withAlpha(themeVar('--vscode-focusBorder', '#007fd4'), 0.9);
    const z = p.zoom;
    if (p.grid && lay) {
      const g = p.grid;
      ctx.lineWidth = 1;
      for (let i = 0; i < lay.cols * lay.rows; i++) {
        const r = cellRect(g, lay.cols, i);
        if (excluded.has(i)) {
          ctx.fillStyle = withAlpha(themeVar('--vscode-editor-background', '#1e1e1e'), 0.6);
          ctx.fillRect(r.x * z, r.y * z, r.w * z, r.h * z);
          ctx.strokeStyle = line;
          ctx.beginPath();
          ctx.moveTo(r.x * z, r.y * z);
          ctx.lineTo((r.x + r.w) * z, (r.y + r.h) * z);
          ctx.stroke();
        }
        ctx.strokeStyle = line;
        ctx.strokeRect(r.x * z + 0.5, r.y * z + 0.5, r.w * z - 1, r.h * z - 1);
      }
      // the leftover strips that fit no cell: hatched
      ctx.save();
      ctx.strokeStyle = withAlpha(themeVar('--vscode-editorWarning-foreground', '#cca700'), 0.8);
      const hatch = (x0: number, y0: number, x1: number, y1: number): void => {
        if (x1 <= x0 || y1 <= y0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 * z, y0 * z, (x1 - x0) * z, (y1 - y0) * z);
        ctx.clip();
        for (let d = -(y1 - y0) * z; d < (x1 - x0) * z; d += 8) {
          ctx.beginPath();
          ctx.moveTo(x0 * z + d, y1 * z);
          ctx.lineTo(x0 * z + d + (y1 - y0) * z, y0 * z);
          ctx.stroke();
        }
        ctx.restore();
      };
      hatch(w - lay.leftoverX, 0, w, h);
      hatch(0, h - lay.leftoverY, w - lay.leftoverX, h);
      ctx.restore();
      if (lay.cols * lay.rows && p.cursor >= 0 && p.cursor < lay.cols * lay.rows) {
        const r = cellRect(g, lay.cols, p.cursor);
        ctx.lineWidth = 3;
        ctx.strokeStyle = themeVar('--vscode-focusBorder', '#007fd4');
        ctx.strokeRect(r.x * z + 1.5, r.y * z + 1.5, r.w * z - 3, r.h * z - 3);
      }
    } else if (p.frame && p.frame.w > 0 && p.frame.h > 0) {
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      for (let x = p.frame.w; x < w; x += p.frame.w) {
        ctx.beginPath();
        ctx.moveTo(x * z + 0.5, 0);
        ctx.lineTo(x * z + 0.5, h * z);
        ctx.stroke();
      }
      for (let y = p.frame.h; y < h; y += p.frame.h) {
        ctx.beginPath();
        ctx.moveTo(0, y * z + 0.5);
        ctx.lineTo(w * z, y * z + 0.5);
        ctx.stroke();
      }
    }
  });
  void theme;

  const at = (e: PointerEvent): { x: number; y: number } => {
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    return { x: Math.floor((e.clientX - r.left) / p.zoom), y: Math.floor((e.clientY - r.top) / p.zoom) };
  };
  const cellFor = (e: PointerEvent): number => (p.grid && lay ? cellAt(p.grid, lay.cols, lay.rows, at(e).x, at(e).y) : -1);

  const down = (e: PointerEvent): void => {
    const pt = at(e);
    if (p.pick) {
      const i = (pt.y * p.src.width + pt.x) * 4;
      if (pt.x >= 0 && pt.y >= 0 && pt.x < p.src.width && pt.y < p.src.height) p.onPick([p.src.rgba[i], p.src.rgba[i + 1], p.src.rgba[i + 2]]);
      return;
    }
    const cell = cellFor(e);
    if (cell < 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    (e.currentTarget as HTMLElement).focus();
    if (e.shiftKey && p.cursor >= 0) {
      const [a, b] = [Math.min(p.cursor, cell), Math.max(p.cursor, cell)];
      const include = excluded.has(cell);
      p.onCells(Array.from({ length: b - a + 1 }, (_, k) => a + k), include);
    } else {
      const include = excluded.has(cell);
      paint.current = { include, seen: new Set([cell]) };
      p.onCells([cell], include);
    }
    p.onCursor(cell);
  };
  const move = (e: PointerEvent): void => {
    if (!paint.current) return;
    const cell = cellFor(e);
    if (cell < 0 || paint.current.seen.has(cell)) return;
    paint.current.seen.add(cell);
    p.onCells([cell], paint.current.include);
    p.onCursor(cell);
  };
  const up = (): void => {
    paint.current = null;
  };
  const key = (e: KeyboardEvent): void => {
    if (!p.grid || !lay || !lay.cols) return;
    const n = lay.cols * lay.rows;
    const cur = Math.max(0, Math.min(n - 1, p.cursor));
    const go = (i: number): void => {
      e.preventDefault();
      p.onCursor(Math.max(0, Math.min(n - 1, i)));
    };
    if (e.key === 'ArrowRight') go(cur + 1);
    else if (e.key === 'ArrowLeft') go(cur - 1);
    else if (e.key === 'ArrowDown') go(cur + lay.cols);
    else if (e.key === 'ArrowUp') go(cur - lay.cols);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(n - 1);
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      p.onCells([cur], excluded.has(cur));
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      p.onCells(Array.from({ length: n }, (_, i) => i), !e.shiftKey);
    }
  };

  const cell = p.grid && lay && lay.cols ? p.cursor : -1;
  return (
    <canvas
      ref={ref}
      class={`imp-canvas${p.pick ? ' imp-pick' : ''}`}
      tabIndex={p.grid ? 0 : -1}
      role="application"
      aria-label={`${p.label}${p.grid && lay ? `. Grid of ${lay.cols} by ${lay.rows} cells. Arrow keys move the cell cursor, Space includes or excludes the cell, Control A selects all, Control Shift A none.${cell >= 0 ? ` Cursor on cell ${cell + 1}, ${excluded.has(cell) ? 'excluded' : 'included'}.` : ''}` : ''}`}
      onPointerDown={down as never}
      onPointerMove={move as never}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key as never}
    />
  );
}

export interface ResultCanvasProps {
  preview: Preview;
  zoom: number;
  aw: number;
  /** Cell size to outline and number. */
  cell?: { w: number; h: number };
  dim: boolean;
  label: string;
}

export function ResultCanvas(p: ResultCanvasProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const { width: w, height: h, indices, rows } = p.preview;
    const cw = Math.round(w * p.zoom * p.aw), ch = h * p.zoom;
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    checker(ctx, cw, ch);
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < indices.length; i++) {
      const row = rows[indices[i]];
      if (!row) continue;
      rgba.set([row.rgb[0], row.rgb[1], row.rgb[2], 255], i * 4);
    }
    ctx.drawImage(bitmapOf(w, h, rgba), 0, 0, cw, ch);
    if (p.cell && p.cell.w > 0 && p.cell.h > 0) {
      const sx = p.zoom * p.aw, sy = p.zoom;
      ctx.strokeStyle = withAlpha(themeVar('--vscode-focusBorder', '#007fd4'), 0.8);
      ctx.lineWidth = 1;
      let n = 0;
      ctx.font = `${Math.min(14, Math.max(9, p.zoom))}px ${themeVar('--vscode-font-family', 'sans-serif')}`;
      for (let y = 0; y < h; y += p.cell.h)
        for (let x = 0; x < w; x += p.cell.w) {
          ctx.strokeRect(x * sx + 0.5, y * sy + 0.5, p.cell.w * sx - 1, p.cell.h * sy - 1);
          if (p.zoom >= 6) {
            ctx.fillStyle = themeVar('--vscode-editor-foreground', '#ccc');
            ctx.fillText(String(n), x * sx + 3, y * sy + 12);
          }
          n++;
        }
    }
  });
  void theme;
  return <canvas ref={ref} class={`imp-canvas${p.dim ? ' imp-dim' : ''}`} role="img" aria-label={p.label} />;
}
