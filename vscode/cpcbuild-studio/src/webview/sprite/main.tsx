/**
 * The sprite and tile editor webview (S2, S3): one bundle for .cpcspr and .cpctil. It holds pen indices
 * only; every change is a semantic operation the host applies (src/core/spriteDoc.ts), so undo, redo,
 * save and backup belong to VS Code and the bytes come from the host's codec.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { moveRect, background, type Grid, type Rect, type SpriteOp } from '../../core/spriteDoc';
import { lineCells, type Pt } from '../../core/shapes';
import { PPB } from '../../core/pixels';
import type { SpriteRequests, SpriteView } from '../../shared/spriteProtocol';
import { startEditor, type EditorHost } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Copyable } from '../shared/components/Copyable';
import { Icon } from '../shared/components/Icon';
import { EmptyState, Notice, type NoticeAction } from '../shared/components/Notice';
import { PenStrip } from '../shared/components/PenStrip';
import { PixelCanvas, type PixelImage, type PointerInfo } from '../shared/components/PixelCanvas';
import { CheckField, Field, NumberField, PropertyPanel, Section, Segmented } from '../shared/components/PropertyPanel';
import { StatusLine } from '../shared/components/StatusLine';
import { Toolbar, type ToolbarGroup, type ToolbarItem } from '../shared/components/Toolbar';
import { aspectWidth, byteGridEvery, fitZoom, nearestZoom, stepZoom, ZOOM_STEPS } from '../shared/geometry';
import { ColourPopover } from './ColourPopover';
import { FrameStrip } from './FrameStrip';
import {
  TRANSPARENT, aspectKey, clipRect, copyRect, decodeItems, describeValue, insideRect, neighbourView, overlayRgba, penSlots,
  rectBetween, renderRgba, shapeCells, stamps, tile16, tile16Target, topValue, type ShapeTool,
} from './model';
import { Thumb } from './Thumb';
import './sprite.css';

type Host = EditorHost<SpriteRequests, SpriteView>;
type Tool = 'pencil' | 'line' | 'rect' | 'ellipse' | 'fill' | 'replace' | 'picker' | 'select';
type Px = [number, number, number, number]; // item, x, y, value

interface Persisted {
  zoom?: number;
  gridPixel?: boolean;
  gridByte?: boolean;
  gridTile?: boolean;
  crt?: boolean;
  fps?: number;
  tool?: Tool;
  magX?: number;
  magY?: number;
}

/** What a drag shows before it is committed. */
type Draft = { kind: 'pixels'; list: Px[] } | { kind: 'grid'; item: number; grid: Grid };

interface Gesture {
  tool: Tool;
  button: 'L' | 'R';
  value: number;
  start: Pt;
  last: Pt;
  path: Pt[];
  mode: 'draw' | 'marquee' | 'move';
  prevSel: Rect | null;
  copy: boolean;
  flags: { shift: boolean; alt: boolean };
}

interface Msg {
  severity: 'info' | 'warning' | 'error';
  text: string;
  actions?: NoticeAction[];
  key: string;
}

const TOOLS: { id: Tool; label: string; icon: string; key: string }[] = [
  { id: 'pencil', label: 'Pencil', icon: 'edit', key: 'B' },
  { id: 'line', label: 'Line', icon: 'graph-line', key: 'L' },
  { id: 'rect', label: 'Rectangle', icon: 'primitive-square', key: 'R' },
  { id: 'ellipse', label: 'Ellipse', icon: 'circle-large-outline', key: 'E' },
  { id: 'fill', label: 'Flood fill', icon: 'paintcan', key: 'F' },
  { id: 'replace', label: 'Replace colour', icon: 'symbol-color', key: 'K' },
  { id: 'picker', label: 'Picker', icon: 'eye', key: 'I' },
  { id: 'select', label: 'Select', icon: 'selection', key: 'S' },
];

function applyDraft(items: Grid[], d: Draft | null): Grid[] {
  if (!d) return items;
  const out = items.slice();
  if (d.kind === 'grid') {
    out[d.item] = d.grid;
    return out;
  }
  const copied = new Set<number>();
  for (const [i, x, y, v] of d.list) {
    if (!out[i] || out[i][y]?.[x] === undefined) continue;
    if (!copied.has(i)) { copied.add(i); out[i] = out[i].map((r) => r.slice()); }
    out[i][y][x] = v;
  }
  return out;
}

const isEditable = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

function TextField({ id, label, value, description, validate, onCommit }: { id: string; label: string; value: string; description?: string; validate?(v: string): string | undefined; onCommit(v: string): void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(value); setError(undefined); }, [value]);
  const commit = (): void => {
    const t = text.trim();
    const msg = validate?.(t);
    setError(msg);
    if (!msg && t !== value) onCommit(t);
  };
  return (
    <Field id={id} label={label} description={description} error={error}>
      <input id={id} class="cb-input" type="text" value={text} aria-invalid={error ? 'true' : undefined} aria-describedby={[description ? `${id}-desc` : '', error ? `${id}-err` : ''].filter(Boolean).join(' ') || undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') { setText(value); setError(undefined); } }} />
    </Field>
  );
}

function Help({ onClose }: { onClose(): void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const rows: [string, string][] = [
    ['B L R E F K I S', 'Pencil, line, rectangle, ellipse, fill, replace colour, picker, select. R / E again: filled'],
    ['0-9, [ ], /', 'Left pen (Alt: right pen); / is transparent. X swaps left and right'],
    ['Alt+click', 'Pick the colour under the pointer (from any tool)'],
    ['Arrows, Ctrl+Arrow, Space', 'Keyboard cursor (by pixel, by byte); Space applies the tool (twice for shapes: anchor, then commit)'],
    ['Shift+H, Shift+V, Q, Shift+Q', 'Flip horizontally / vertically, rotate 90 (counter-clockwise)'],
    ['Shift+Arrow, Ctrl+Shift+Arrow', 'Shift with wrap by one pixel / one byte (the selection if there is one)'],
    ['Alt+Arrow', 'Move the selection by one pixel (Ctrl+Alt: one byte)'],
    ['Ctrl+C, Ctrl+X, Ctrl+V, Delete', 'Copy, cut, paste and clear the selection'],
    ['Alt+X, Alt+Y', 'Mirror drawing about the vertical / horizontal axis'],
    [', .', 'Previous / next frame (tile)'],
    ['N, Shift+N', 'Add / duplicate frame (tile)'],
    ['G, Shift+G, Alt+G, A, O', 'Pixel grid, byte grid, tile grid, CPC aspect, onion skin'],
    ['= -, Z', 'Zoom in, out, fit'],
    ['T, P, ?', 'Tile 8x8 / 16x16 view, play the preview, this help'],
    ['Esc', 'Cancel the drag or the anchor, clear the selection'],
  ];
  return (
    <div class="sp-help" role="dialog" aria-label="Keyboard shortcuts" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div class="sp-help-h"><strong>Keyboard shortcuts</strong><button type="button" class="cb-icon-btn" aria-label="Close shortcuts" onClick={onClose} ref={btn}><Icon name="close" /></button></div>
      <dl>{rows.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
      <p class="cb-muted">Undo, Redo and Save are VS Code's: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S.</p>
    </div>
  );
}

function SpriteApp({ client, settings, view }: Host) {
  const v = view;
  const plus = v.kind === 'plus';
  const tiles = v.docType === 'til';
  const noun = tiles ? 'tile' : 'frame';
  const saved = client.getState<Persisted>() ?? {};
  const aKey = aspectKey(v);

  // ------------------------------------------------------------ state
  const [tool, setTool] = useState<Tool>(saved.tool ?? 'pencil');
  const [filled, setFilled] = useState(false);
  const [mirX, setMirX] = useState(false);
  const [mirY, setMirY] = useState(false);
  const [lPen, setLPen] = useState(1);
  const [rPen, setRPen] = useState(plus || (v.docType === 'spr' && v.masked) ? TRANSPARENT : 0);
  const [crt, setCrt] = useState(saved.crt ?? settings.pixelAspect === 'crt');
  const [gridPixel, setGridPixel] = useState(saved.gridPixel ?? true);
  const [gridByte, setGridByte] = useState(saved.gridByte ?? settings.showByteGrid);
  const [gridTile, setGridTile] = useState(saved.gridTile ?? false);
  const [onion, setOnion] = useState(false);
  const [curRaw, setCur] = useState(0);
  const [sel, setSel] = useState<Rect | null>(null);
  /** The pointer or keyboard cursor, in canvas (composite) pixels. */
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [pendingMode, setPendingMode] = useState<{ mode: 0 | 1 | 2; text: string } | null>(null);
  const [pendingSize, setPendingSize] = useState<{ w: number; h: number; text: string } | null>(null);
  const [view16, setView16] = useState(false);
  const [t16, setT16] = useState(0);
  const [numbers, setNumbers] = useState(false);
  const [cols, setCols] = useState(8);
  const [popover, setPopover] = useState<number | null>(null);
  const [help, setHelp] = useState(false);
  const [narrow, setNarrow] = useState(window.innerWidth <= 720);
  const [propsOpen, setPropsOpen] = useState(window.innerWidth > 720);
  const [fmt, setFmt] = useState('use');
  const [live, setLive] = useState('');
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(saved.fps ?? 8);
  const [allFrames, setAllFrames] = useState(true);
  const [magX, setMagX] = useState(saved.magX ?? 2);
  const [magY, setMagY] = useState(saved.magY ?? 1);
  const [slot, setSlot] = useState(0);
  const [seenGen, setSeenGen] = useState(0);
  const [previewFrame, setPreviewFrame] = useState(0);
  const [area, setArea] = useState({ w: 600, h: 400 });
  const version = useRef(v.version);
  version.current = v.version;
  const areaRef = useRef<HTMLDivElement>(null);
  const gest = useRef<Gesture | null>(null);
  const draftRef = useRef<Draft | null>(null);
  const anchor = useRef<Pt | null>(null);
  const lastPencil = useRef<Pt | null>(null);
  const clip = useRef<Grid | null>(null);
  const initialFit = useRef(saved.zoom === undefined);

  // ----------------------------------------------------------- decode
  const decoded = useMemo(() => {
    try {
      return { items: decodeItems(v) };
    } catch (e) {
      return { items: [] as Grid[], error: (e as Error).message };
    }
  }, [v]);
  const items = decoded.items;
  const n = items.length;
  const cur = n ? Math.min(curRaw, n - 1) : 0;
  useEffect(() => { if (curRaw !== cur) setCur(cur); }, [curRaw, cur]);
  const bg = background({ kind: v.kind, type: v.docType, masked: v.masked });
  const top = topValue(v);
  const ppb = plus ? 1 : PPB[v.mode];

  // the editing space: plain, the tile with neighbours, or the 16x16 view
  const space: 'plain' | 'nb' | 't16' = tiles ? (view16 ? 't16' : 'nb') : 'plain';
  const lw = space === 't16' ? 2 * v.w : v.w;
  const lh = space === 't16' ? 2 * v.h : v.h;
  const off = space === 'nb' ? { x: v.w, y: v.h } : { x: 0, y: 0 };
  const compW = space === 'plain' ? v.w : space === 't16' ? 2 * v.w : 3 * v.w;
  const compH = space === 'plain' ? v.h : space === 't16' ? 2 * v.h : 3 * v.h;

  const disp = useMemo(() => applyDraft(items, draft), [items, draft]);
  const thumbs = useMemo(() => disp.map((g) => renderRgba(g, v)), [disp, v.pens, v.colours, v.kind]);
  const image: PixelImage = useMemo(() => {
    if (!n) return { width: compW, height: compH, rgba: new Uint8ClampedArray(compW * compH * 4) };
    if (space === 'plain') {
      let rgba = thumbs[cur];
      if (onion && cur > 0) rgba = overlayRgba(renderRgba(disp[cur - 1], v, 76), rgba);
      return { width: v.w, height: v.h, rgba };
    }
    if (space === 't16') return { width: compW, height: compH, rgba: tile16(disp, t16, v) };
    const nb = neighbourView(disp, cur, cols, v);
    return { width: nb.size, height: nb.size, rgba: nb.rgba };
  }, [disp, thumbs, cur, onion, space, t16, cols, compW, compH, v.w, v.h, v.pens, v.colours]);

  // ------------------------------------------------------------ view
  const aw = aspectWidth(aKey, crt ? 'crt' : 'square', 2, 1);
  const [zoomRaw, setZoom] = useState(saved.zoom ?? settings.defaultZoom);
  const zoom = nearestZoom(zoomRaw, aw);
  useEffect(() => client.setState({ zoom, gridPixel, gridByte, gridTile, crt, fps, tool, magX, magY } satisfies Persisted), [zoom, gridPixel, gridByte, gridTile, crt, fps, tool, magX, magY]);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = (): void => { setArea({ w: el.clientWidth, h: el.clientHeight }); setNarrow(window.innerWidth <= 720); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = (): void => setZoom(fitZoom(compW, compH, aw, area.w - 24, Math.max(160, area.h - 24)));
  useEffect(() => {
    if (initialFit.current && area.w > 100) {
      initialFit.current = false;
      const z = nearestZoom(settings.defaultZoom, aw);
      if (compW * z * aw + 56 > area.w || compH * z + 56 > Math.max(200, area.h)) fit();
    }
  }, [area.w, area.h]);

  // --------------------------------------------------------- messages
  const say = (severity: Msg['severity'], text: string, key = text, actions?: NoticeAction[]): void =>
    setMsgs((m) => [...m.filter((x) => x.key !== key), { severity, text, key, actions }]);
  const dismiss = (key: string): void => setMsgs((m) => m.filter((x) => x.key !== key));

  // ------------------------------------------------------ host calls
  const send = async (op: SpriteOp, quiet = false): Promise<string | undefined> => {
    try {
      const r = await client.request('edit', { baseVersion: version.current, op });
      version.current = r.version;
      return undefined;
    } catch (e) {
      const text = (e as Error).message;
      if (!quiet) say('error', text, 'edit-error');
      return text;
    }
  };
  const ask = async <K extends keyof SpriteRequests>(name: K, args: SpriteRequests[K]['args']): Promise<SpriteRequests[K]['result'] | undefined> => {
    try {
      return await client.request(name, args);
    } catch (e) {
      say('error', (e as Error).message, `${name}-error`);
      return undefined;
    }
  };

  // -------------------------------------------------------- selection
  useEffect(() => { setSel(null); anchor.current = null; }, [cur, space]);
  const selRect = (): Rect | undefined => (sel && space !== 't16' ? sel : undefined);

  // ------------------------------------------------------ coordinates
  /** Composite pixel -> the frame pixel it edits (null for the dimmed neighbours). */
  const targetOf = (lx: number, ly: number): { item: number; x: number; y: number } | null => {
    if (lx < 0 || ly < 0 || lx >= lw || ly >= lh) return null;
    if (space === 't16') {
      const t = tile16Target(t16, lx, ly, v.w);
      return t.item < n ? t : null;
    }
    return { item: cur, x: lx, y: ly };
  };
  const valueAt = (lx: number, ly: number): number | undefined => {
    const t = targetOf(lx, ly);
    return t ? disp[t.item]?.[t.y]?.[t.x] : undefined;
  };

  const pixelsOf = (pts: Pt[], value: number): Px[] => {
    const out: Px[] = [];
    for (const [x, y] of stamps(pts, lw, lh, mirX, mirY)) {
      const t = targetOf(x, y);
      if (t) out.push([t.item, t.x, t.y, value]);
    }
    return out;
  };

  const commitPixels = async (list: Px[], label: string): Promise<void> => {
    if (!list.length) return;
    const first = list[0][0];
    if (list.every((p) => p[0] === first)) await send({ op: 'paint', item: first, pixels: list.map(([, x, y, val]) => [x, y, val]), label });
    else await send({ op: 'paintMany', pixels: list, label });
  };

  const labelOf = (t: Tool): string => ({ pencil: 'Pencil', line: 'Line', rect: filled ? 'Filled rectangle' : 'Rectangle', ellipse: filled ? 'Filled ellipse' : 'Ellipse' } as Record<string, string>)[t] ?? 'Pencil';

  // --------------------------------------------------------- gestures
  const setDraftNow = (d: Draft | null): void => {
    draftRef.current = d;
    setDraft(d);
  };

  const shapePixels = (g: Gesture, p: Pt): Px[] => {
    const pts = g.tool === 'pencil' ? g.path : shapeCells(g.tool as ShapeTool, g.start, p, { filled, shift: g.flags.shift, alt: g.flags.alt });
    return pixelsOf(pts, g.value);
  };

  const pick = (x: number, y: number, button: 'L' | 'R'): void => {
    const val = valueAt(x, y);
    if (val === undefined) return;
    if (button === 'L') setLPen(val); else setRPen(val);
    setLive(`Picked ${describeValue(v, val)}`);
  };

  const finishGesture = async (end?: Pt): Promise<void> => {
    const g = gest.current;
    if (!g) return;
    gest.current = null;
    const p = end ?? g.last;
    if (g.mode === 'marquee') {
      const r = clipRect(rectBetween(g.start, p), lw, lh);
      const click = g.start[0] === p[0] && g.start[1] === p[1];
      setSel(click ? null : r);
      return;
    }
    if (g.mode === 'move') {
      const dx = p[0] - g.start[0], dy = p[1] - g.start[1];
      const r = g.prevSel as Rect;
      setDraftNow(null);
      if (dx || dy) {
        const err = await send({ op: 'move', item: cur, rect: r, dx, dy, copy: g.copy });
        if (!err) setSel(clipRect({ ...r, x: r.x + dx, y: r.y + dy }, lw, lh));
      }
      return;
    }
    const list = shapePixels(g, p);
    if (g.tool === 'pencil') lastPencil.current = p;
    await commitPixels(list, labelOf(g.tool));
    setDraftNow(null);
  };

  const cancelGesture = (): void => {
    const g = gest.current;
    if (g) {
      gest.current = null;
      if (g.mode === 'marquee') setSel(g.prevSel);
      setDraftNow(null);
    }
    anchor.current = null;
  };

  useEffect(() => {
    const up = (): void => void finishGesture();
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  });

  const doFill = async (x: number, y: number, value: number): Promise<void> => {
    const t = targetOf(x, y);
    if (!t) return;
    const box = space === 'nb' ? selRect() : undefined;
    await send({ op: 'fill', item: t.item, x: t.x, y: t.y, value, box });
  };
  const doReplace = async (x: number, y: number, value: number, all: boolean): Promise<void> => {
    const t = targetOf(x, y);
    if (!t) return;
    const from = disp[t.item][t.y][t.x];
    if (from === value) return;
    const r = await send({ op: 'replace', item: t.item, from, to: value, all });
    if (r === undefined) setLive(`Replaced ${describeValue(v, from)} with ${describeValue(v, value)}`);
  };

  const onPointer = (e: PointerInfo): void => {
    const lx = e.x - off.x, ly = e.y - off.y;
    if (e.kind === 'move') {
      setPt({ x: e.x, y: e.y });
      const g = gest.current;
      if (!g) return;
      const p: Pt = [lx, ly];
      if (g.mode === 'marquee') { setSel(clipRect(rectBetween(g.start, p), lw, lh)); g.last = p; return; }
      if (g.mode === 'move') {
        const r = g.prevSel as Rect;
        setSel(clipRect({ ...r, x: r.x + p[0] - g.start[0], y: r.y + p[1] - g.start[1] }, lw, lh));
        setDraftNow({ kind: 'grid', item: cur, grid: moveRect(items[cur], r, p[0] - g.start[0], p[1] - g.start[1], g.copy, bg) });
        g.last = p;
        return;
      }
      g.flags = { shift: e.shift, alt: e.alt };
      if (g.tool === 'pencil') g.path = g.path.concat(lineCells(g.last[0], g.last[1], p[0], p[1]));
      g.last = p;
      setDraftNow({ kind: 'pixels', list: shapePixels(g, p) });
      return;
    }
    if (e.kind === 'up') { void finishGesture([lx, ly]); return; }
    // down
    if (space === 'nb' && (e.x < off.x || e.y < off.y || e.x >= off.x + v.w || e.y >= off.y + v.h)) {
      const ci = Math.floor(e.x / v.w) - 1, cj = Math.floor(e.y / v.h) - 1;
      const col = cur % cols;
      const idx = cur + cj * cols + ci;
      if (col + ci >= 0 && col + ci < cols && idx >= 0 && idx < n) setCur(idx);
      return;
    }
    const button: 'L' | 'R' = e.buttons & 2 ? 'R' : 'L';
    const value = button === 'L' ? lPen : rPen;
    if (e.alt) { pick(lx, ly, button); return; }
    const p: Pt = [lx, ly];
    switch (tool) {
      case 'picker': pick(lx, ly, button); return;
      case 'fill': void doFill(lx, ly, value); return;
      case 'replace': void doReplace(lx, ly, value, e.shift); return;
      case 'select': {
        if (space === 't16') { say('info', 'Select works on one tile: switch to the 8x8 view.', 'sel-t16'); return; }
        const inside = sel && insideRect(sel, lx, ly);
        gest.current = { tool, button, value, start: p, last: p, path: [], mode: inside ? 'move' : 'marquee', prevSel: sel, copy: e.ctrl, flags: { shift: e.shift, alt: e.alt } };
        if (!inside) setSel({ x: lx, y: ly, w: 1, h: 1 });
        return;
      }
      default: {
        let path: Pt[] = [p];
        if (tool === 'pencil' && e.shift && lastPencil.current) path = lineCells(lastPencil.current[0], lastPencil.current[1], lx, ly);
        const g: Gesture = { tool, button, value, start: p, last: p, path, mode: 'draw', prevSel: sel, copy: false, flags: { shift: e.shift, alt: e.alt } };
        gest.current = g;
        setDraftNow({ kind: 'pixels', list: shapePixels(g, p) });
      }
    }
  };

  // keyboard cursor + Space
  const onApply = (c: { x: number; y: number }): void => {
    const lx = c.x - off.x, ly = c.y - off.y;
    const value = lPen;
    if (tool === 'pencil') { void commitPixels(pixelsOf([[lx, ly]], value), 'Pencil'); return; }
    if (tool === 'fill') { void doFill(lx, ly, value); return; }
    if (tool === 'picker') { pick(lx, ly, 'L'); return; }
    if (tool === 'replace') { void doReplace(lx, ly, value, false); return; }
    if (!anchor.current) {
      anchor.current = [lx, ly];
      say('info', 'Anchor set. Move the cursor and press Space again to finish, or Esc to cancel.', 'anchor');
      return;
    }
    const a = anchor.current;
    anchor.current = null;
    dismiss('anchor');
    if (tool === 'select') { const r = clipRect(rectBetween(a, [lx, ly]), lw, lh); setSel(r); return; }
    const list = pixelsOf(shapeCells(tool as ShapeTool, a, [lx, ly], { filled }), value);
    void commitPixels(list, labelOf(tool)).then(() => setLive(`${labelOf(tool)} drawn, ${plural(list.length, 'pixel')}`));
  };

  // ---------------------------------------------------------- actions
  const fx = (name: string): boolean => {
    if (space === 't16') { say('info', `${name} works on one tile: switch to the 8x8 view.`, 'fx-t16'); return false; }
    return n > 0;
  };
  const flip = (h: boolean): void => { if (fx('Flip')) void send({ op: h ? 'flipH' : 'flipV', item: cur, rect: selRect() }); };
  const rotate = (ccw: boolean): void => { if (fx('Rotate')) void send({ op: 'rotate', item: cur, ccw, rect: selRect() }); };
  const shiftBy = (dx: number, dy: number): void => { if (fx('Shift')) void send({ op: 'shift', item: cur, dx, dy, rect: selRect() }); };
  const clearFrame = (): void => { if (fx('Clear')) void send({ op: 'clear', item: cur }); };
  const invert = (): void => { if (fx('Invert')) void send({ op: 'invert', item: cur }); };
  const moveSel = (dx: number, dy: number): void => {
    if (!sel) return;
    void send({ op: 'move', item: cur, rect: sel, dx, dy }).then((err) => { if (!err) setSel(clipRect({ ...sel, x: sel.x + dx, y: sel.y + dy }, lw, lh)); });
  };
  const copySel = (cut: boolean): void => {
    if (!sel || !n) return;
    clip.current = copyRect(items[cur], sel);
    say('info', `${cut ? 'Cut' : 'Copied'} ${sel.w} x ${sel.h} pixels.`, 'clip');
    if (cut) void send({ op: 'fillRect', item: cur, rect: sel, label: 'Cut' });
  };
  const paste = (): void => {
    const c = clip.current;
    if (!c || !n) { say('info', 'Nothing to paste: select an area and press Ctrl+C first.', 'clip'); return; }
    const x = sel?.x ?? 0, y = sel?.y ?? 0;
    void send({ op: 'paste', item: cur, x, y, rows: c }).then((err) => { if (!err) setSel(clipRect({ x, y, w: c[0].length, h: c.length }, lw, lh)); });
  };
  const clearSel = (): void => { if (sel) void send({ op: 'fillRect', item: cur, rect: sel }); };

  const gotoItem = (i: number): void => { if (n) setCur(Math.max(0, Math.min(n - 1, i))); };
  const addItem = (): void => { void send({ op: 'addItem', at: cur + 1 }).then((err) => { if (!err) { setCur(cur + 1); setLive(`${noun} ${cur + 1} added`); } }); };
  const dupItem = (i: number): void => { void send({ op: 'dupItem', item: i }).then((err) => { if (!err) { setCur(i + 1); setLive(`${noun} ${i + 1} added`); } }); };
  const delItem = (i: number): void => { void send({ op: 'delItem', item: i }).then((err) => { if (!err) { setCur(Math.max(0, Math.min(i, n - 2))); setLive(`${noun} ${i} deleted`); } }); };
  const moveItem = (from: number, to: number): void => { void send({ op: 'moveItem', from, to }); };

  const chooseMode = async (m: 0 | 1 | 2): Promise<void> => {
    if (m === v.mode) { setPendingMode(null); return; }
    const err = await send({ op: 'setMode', mode: m }, true);
    if (err === undefined) { setPendingMode(null); return; }
    if (err.startsWith(`mode ${m} has`)) setPendingMode({ mode: m, text: err });
    else say('error', err, 'mode-error');
  };
  const convertMode = async (): Promise<void> => {
    if (!pendingMode) return;
    const err = await send({ op: 'setMode', mode: pendingMode.mode, force: true });
    if (!err) setPendingMode(null);
  };
  const resize = async (w: number, h: number, crop = false): Promise<void> => {
    let ww = w;
    if (!plus && !tiles && w % ppb) {
      ww = Math.max(ppb, Math.round(w / ppb) * ppb);
      say('info', `Width snapped to ${ww}: mode ${v.mode} needs a multiple of ${ppb}.`, 'snap');
    }
    const err = await send({ op: 'setSize', w: ww, h, crop }, true);
    if (err === undefined) { setPendingSize(null); return; }
    if (err.startsWith('crop:')) setPendingSize({ w: ww, h, text: err.slice(5).trim() });
    else say('error', err, 'size-error');
  };

  useEffect(() => { if (lPen > top && top >= 0) setLPen(top); }, [top]);
  const penPick = (i: number, button: 'left' | 'right'): void => {
    if (!plus && i >= (v.pens?.length ?? 0) && i >= 0) { say('info', `Pen ${i} is unset: choose a colour for it first (double-click the slot).`, 'unset'); return; }
    if (button === 'left') setLPen(i); else setRPen(i);
  };
  const stepPen = (d: number, right: boolean): void => {
    const lo = plus || (v.docType === 'spr' && v.masked) ? -1 : 0;
    const cur = right ? rPen : lPen;
    const next = Math.max(lo, Math.min(top, cur + d));
    if (right) setRPen(next); else setLPen(next);
  };
  const setPenAt = (i: number, fwOrHex: string): void => {
    setPopover(null);
    if (plus) {
      const cols2 = (v.colours ?? []).slice();
      cols2[i - 1] = fwOrHex;
      void send({ op: 'setColours', colours: cols2 });
    } else {
      const pens = (v.pens ?? []).slice();
      pens[i] = Number(fwOrHex);
      void send({ op: 'setPens', pens });
    }
  };
  const addPen = (): void => {
    if (plus) {
      if ((v.colours?.length ?? 0) >= 15) return;
      void send({ op: 'setColours', colours: [...(v.colours ?? []), '888'] }).then((err) => { if (!err) setLPen((v.colours?.length ?? 0) + 1); });
    } else {
      const pens = v.pens ?? [];
      if (pens.length >= (v.mode === 0 ? 16 : v.mode === 1 ? 4 : 2)) return;
      const free = Array.from({ length: 27 }, (_, k) => k).find((k) => !pens.includes(k)) ?? 0;
      void send({ op: 'setPens', pens: [...pens, free] }).then((err) => { if (!err) setLPen(pens.length); });
    }
  };
  const removePen = (): void => {
    if (plus) void send({ op: 'setColours', colours: (v.colours ?? []).slice(0, -1) });
    else if ((v.pens?.length ?? 0) > 1) void send({ op: 'setPens', pens: (v.pens ?? []).slice(0, -1) });
  };

  const generate = async (): Promise<void> => {
    const r = await ask('generate', {});
    if (r) say(r.ok ? 'info' : 'error', r.message, 'gen');
  };

  // ---------------------------------------------------------- keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (isEditable(e.target) || e.defaultPrevented) return;
      const k = e.key;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.altKey && !e.shiftKey) {
        const lk = k.toLowerCase();
        if (lk === 'c' && sel) { e.preventDefault(); copySel(false); }
        else if (lk === 'x' && sel) { e.preventDefault(); copySel(true); }
        else if (lk === 'v' && clip.current) { e.preventDefault(); paste(); }
        return;
      }
      if (mod) return;
      const arrow: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (arrow[k] && e.shiftKey && !e.altKey) { return; } // handled in the canvas capture below
      if (e.altKey) {
        const lk = k.toLowerCase();
        if (lk === 'x') { e.preventDefault(); setMirX((m) => !m); }
        else if (lk === 'y') { e.preventDefault(); setMirY((m) => !m); }
        else if (lk === 'g') { e.preventDefault(); setGridTile((g) => !g); }
        else if (/^[0-9]$/.test(k)) { e.preventDefault(); const val = plus && k === '0' ? TRANSPARENT : Number(k); if (val <= top) setRPen(val); }
        else if (k === '[') { e.preventDefault(); stepPen(-1, true); }
        else if (k === ']') { e.preventDefault(); stepPen(1, true); }
        return;
      }
      const lk = k.toLowerCase();
      if (!e.shiftKey || k === '?' || k === '+' || lk === 'g' || lk === 'n' || lk === 'q' || lk === 'h' || lk === 'v') {
        switch (k) {
          case 'Escape': cancelGesture(); setSel(null); setPopover(null); setHelp(false); return;
          case 'Delete': if (sel) { e.preventDefault(); clearSel(); } return;
          case '=': case '+': e.preventDefault(); setZoom(stepZoom(zoom, 1, aw)); return;
          case '-': e.preventDefault(); setZoom(stepZoom(zoom, -1, aw)); return;
          case '[': e.preventDefault(); stepPen(-1, false); return;
          case ']': e.preventDefault(); stepPen(1, false); return;
          case ',': e.preventDefault(); if (cur === 0) setLive(`First ${noun}`); gotoItem(cur - 1); return;
          case '.': e.preventDefault(); if (cur === n - 1) setLive(`Last ${noun}`); gotoItem(cur + 1); return;
          case '/': e.preventDefault(); if (plus || (v.docType === 'spr' && v.masked)) setLPen(TRANSPARENT); return;
          case '?': e.preventDefault(); setHelp((h) => !h); return;
          default:
        }
        if (/^[0-9]$/.test(k) && !e.shiftKey) {
          const val = plus && k === '0' ? TRANSPARENT : Number(k);
          if (val <= top && (plus || val < (v.pens?.length ?? 0))) { e.preventDefault(); setLPen(val); }
          return;
        }
        switch (lk) {
          case 'b': setTool('pencil'); break;
          case 'l': setTool('line'); break;
          case 'r': if (tool === 'rect') setFilled((f) => !f); setTool('rect'); break;
          case 'e': if (tool === 'ellipse') setFilled((f) => !f); setTool('ellipse'); break;
          case 'f': setTool('fill'); break;
          case 'k': setTool('replace'); break;
          case 'i': setTool('picker'); break;
          case 's': setTool('select'); break;
          case 'x': { const l = lPen; setLPen(rPen); setRPen(l); break; }
          case 'g': if (e.shiftKey) setGridByte((g) => !g); else setGridPixel((g) => !g); break;
          case 'a': setCrt((c) => !c); break;
          case 'o': setOnion((o) => !o); break;
          case 'z': fit(); break;
          case 'p': setPlaying((p) => !p); break;
          case 't': if (tiles) setView16((x) => !x); break;
          case 'n': if (e.shiftKey) dupItem(cur); else if (!(tiles && n >= 256)) addItem(); break;
          case 'q': rotate(e.shiftKey); break;
          case 'h': if (e.shiftKey) flip(true); break;
          case 'v': if (e.shiftKey) flip(false); break;
          default: return;
        }
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  /** Shift / Alt + arrows act on the frame or the selection, before the canvas moves its cursor. */
  const onCanvasKey = (e: KeyboardEvent): void => {
    const arrow: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = arrow[e.key];
    if (!d || (!e.shiftKey && !e.altKey) || isEditable(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const by = e.ctrlKey || e.metaKey ? ppb : 1;
    if (e.altKey) moveSel(d[0] * by, d[1] * by);
    else shiftBy(d[0] * by, d[1] * by);
  };

  // ---------------------------------------------------------- preview
  useEffect(() => {
    if (!playing || n < 2 || !allFrames) return;
    const id = window.setInterval(() => setPreviewFrame((f) => (f + 1) % n), 1000 / Math.max(1, Math.min(60, fps)));
    return () => window.clearInterval(id);
  }, [playing, fps, n, allFrames]);
  const shown = allFrames && playing ? Math.min(previewFrame, n - 1) : cur;

  // ---------------------------------------------------------- toolbar
  const mk = (id: Tool): ToolbarItem => {
    const t = TOOLS.find((x) => x.id === id) as (typeof TOOLS)[number];
    const dis = id === 'select' && space === 't16';
    return { kind: 'radio', id: `tool-${id}`, label: t.label, icon: t.icon, shortcut: dis ? 'not in the 16x16 view' : t.key, checked: tool === id, onActivate: () => setTool(id) };
  };
  const zoomItems = [...ZOOM_STEPS.filter((z) => Number.isInteger(z * aw)).map((z) => ({ id: `z${z}`, label: `${z}x`, checked: z === zoom, onActivate: () => setZoom(z) })), { id: 'zfit', label: 'Fit to window', shortcut: 'Z', onActivate: fit }];
  const snippetOf = (id: string) => v.snippets.find((s) => s.id === id);
  const copyText = async (text: string, what: string): Promise<void> => {
    await ask('copy', { text });
    say('info', `Copied ${what}.`, 'copied');
  };
  const groups: ToolbarGroup[] = [
    { label: 'Drawing tools', radio: true, items: TOOLS.map((t) => mk(t.id)) },
    {
      label: 'Drawing options',
      items: [
        { kind: 'button', id: 'filled', label: 'Filled shapes', text: 'Filled', pressed: filled, shortcut: 'R / E again', onActivate: () => setFilled((f) => !f) },
        { kind: 'button', id: 'mirx', label: 'Mirror about the vertical axis', text: 'X', icon: 'mirror', pressed: mirX, shortcut: 'Alt+X', onActivate: () => setMirX((m) => !m) },
        { kind: 'button', id: 'miry', label: 'Mirror about the horizontal axis', text: 'Y', icon: 'mirror', pressed: mirY, shortcut: 'Alt+Y', onActivate: () => setMirY((m) => !m) },
      ],
    },
    {
      label: 'Transform',
      items: [
        { kind: 'button', id: 'fliph', label: 'Flip horizontally', icon: 'arrow-both', text: 'H', shortcut: 'Shift+H', onActivate: () => flip(true) },
        { kind: 'button', id: 'flipv', label: 'Flip vertically', icon: 'arrow-swap', text: 'V', shortcut: 'Shift+V', onActivate: () => flip(false) },
        { kind: 'button', id: 'rotate', label: 'Rotate 90 clockwise', icon: 'refresh', shortcut: 'Q', disabled: !sel && v.w !== v.h, why: `needs a square ${noun}`, onActivate: () => rotate(false) },
        {
          kind: 'menu', id: 'shift', label: 'Shift with wrap', text: 'Shift', icon: 'arrow-both',
          items: [
            ...([['Left', -1, 0], ['Right', 1, 0], ['Up', 0, -1], ['Down', 0, 1]] as [string, number, number][]).map(([l, dx, dy]) => ({ id: `s${l}`, label: `${l} by 1 pixel`, shortcut: `Shift+${l === 'Left' ? '←' : l === 'Right' ? '→' : l === 'Up' ? '↑' : '↓'}`, onActivate: () => shiftBy(dx, dy) })),
            ...(ppb > 1 ? ([['Left', -1, 0], ['Right', 1, 0]] as [string, number, number][]).map(([l, dx]) => ({ id: `b${l}`, label: `${l} by 1 byte (${ppb} pixels)`, onActivate: () => shiftBy(dx * ppb, 0) })) : []),
          ],
        },
        {
          kind: 'menu', id: 'transform', label: 'More transforms', icon: 'symbol-misc',
          items: [
            { id: 'rotccw', label: 'Rotate 90 counter-clockwise', shortcut: 'Shift+Q', onActivate: () => rotate(true) },
            { id: 'clear', label: `Clear ${noun}`, onActivate: clearFrame },
            { id: 'invert', label: 'Invert pens', onActivate: invert },
          ],
        },
      ],
    },
    {
      label: 'View',
      items: [
        { kind: 'button', id: 'zout', label: 'Zoom out', icon: 'zoom-out', shortcut: '-', onActivate: () => setZoom(stepZoom(zoom, -1, aw)) },
        { kind: 'menu', id: 'zoom', label: 'Zoom', text: `${zoom}x`, items: zoomItems },
        { kind: 'button', id: 'zin', label: 'Zoom in', icon: 'zoom-in', shortcut: '=', onActivate: () => setZoom(stepZoom(zoom, 1, aw)) },
        { kind: 'button', id: 'grid', label: gridPixel && zoom < 4 ? 'Pixel grid (hidden at this zoom)' : 'Pixel grid', text: 'Grid', pressed: gridPixel, shortcut: 'G', onActivate: () => setGridPixel((g) => !g) },
        ...(!plus ? [{ kind: 'button' as const, id: 'gridbyte', label: 'Byte grid', text: 'Byte', pressed: gridByte, shortcut: 'Shift+G', onActivate: () => setGridByte((g) => !g) }] : []),
        { kind: 'button', id: 'gridtile', label: 'Tile grid', text: 'Tile', pressed: gridTile, shortcut: 'Alt+G', onActivate: () => setGridTile((g) => !g) },
        { kind: 'button', id: 'aspect', label: 'CPC pixel aspect', text: 'CPC', icon: 'screen-normal', pressed: crt, shortcut: 'A', onActivate: () => setCrt((c) => !c) },
        ...(!tiles ? [{ kind: 'button' as const, id: 'onion', label: 'Onion skin', icon: 'layers', pressed: onion, shortcut: 'O', onActivate: () => setOnion((o) => !o) }] : []),
      ],
    },
  ];
  if (tiles)
    groups.push({
      label: 'Tile view',
      radio: true,
      items: [
        { kind: 'radio', id: 'v8', label: '8x8 view with neighbours', text: '8x8', checked: !view16, shortcut: 'T', onActivate: () => setView16(false) },
        { kind: 'radio', id: 'v16', label: '16x16 view (tiles 4t to 4t+3)', text: '16x16', checked: view16, shortcut: 'T', onActivate: () => setView16(true) },
      ],
    });
  groups.push(
    {
      label: 'History',
      items: [
        { kind: 'button', id: 'undo', label: 'Undo', icon: 'discard', disabled: !v.canUndo, why: 'nothing to undo', onActivate: () => void client.request('history', { action: 'undo' }) },
        { kind: 'button', id: 'redo', label: 'Redo', icon: 'redo', disabled: !v.canRedo, why: 'nothing to redo', onActivate: () => void client.request('history', { action: 'redo' }) },
      ],
    },
    {
      label: 'Asset',
      items: [
        // narrow: Generate and Copy as move into the More menu so the toolbar stays at two rows
        ...(narrow ? [] : [
          { kind: 'button' as const, id: 'generate', label: `Generate ${v.output}`, text: 'Generate', icon: 'run', disabled: !!v.exportProblem, why: v.exportProblem, onActivate: () => void generate() },
          {
            kind: 'menu' as const, id: 'copyas', label: 'Copy as BASIC', text: 'Copy as', icon: 'copy',
            items: [
              ...v.snippets.map((s) => ({ id: `c-${s.id}`, label: s.label, onActivate: () => void copyText(s.text, s.label) })),
              { id: 'c-cmd', label: 'Equivalent img2cpc.py command', onActivate: () => void copyText(v.command, 'the img2cpc.py command') },
            ],
          },
        ]),
        {
          kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis',
          items: [
            ...(narrow ? [
              { id: 'generate', label: `Generate ${v.output}`, icon: 'run', disabled: !!v.exportProblem, onActivate: () => void generate() },
              ...v.snippets.map((s) => ({ id: `c-${s.id}`, label: `Copy as ${s.label}`, icon: 'copy', onActivate: () => void copyText(s.text, s.label) })),
              { id: 'c-cmd', label: 'Copy the img2cpc.py command', icon: 'copy', onActivate: () => void copyText(v.command, 'the img2cpc.py command') },
            ] : []),
            { id: 'takepng', label: `Import PNG into this ${tiles ? 'tile' : 'frame'}...`, icon: 'file-media', onActivate: () => void ask('importPng', { baseVersion: version.current, item: cur }).then((r) => r && (r.taken ? say(r.message?.includes('became') ? 'warning' : 'info', r.message ?? 'PNG imported.', 'png') : undefined)) },
            { id: 'savepng', label: 'Export the sheet as PNG...', icon: 'save-as', onActivate: () => void ask('exportPng', {}).then((r) => r?.saved && say('info', `Saved ${r.file}`, 'png')) },
            { id: 'help', label: 'Keyboard shortcuts', shortcut: '?', onActivate: () => setHelp(true) },
            { id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) },
          ],
        },
      ],
    },
  );

  // ----------------------------------------------------------- notices
  const notices: ComponentChildren[] = [];
  if (decoded.error) notices.push(<Notice key="dec" severity="error">{decoded.error}</Notice>);
  if (pendingMode)
    notices.push(<Notice key="pm" severity="warning" actions={[{ label: 'Convert', onClick: () => void convertMode() }, { label: 'Cancel', secondary: true, onClick: () => setPendingMode(null) }]}>{pendingMode.text}.</Notice>);
  if (pendingSize)
    notices.push(<Notice key="ps" severity="warning" actions={[{ label: 'Crop', onClick: () => void resize(pendingSize.w, pendingSize.h, true) }, { label: 'Cancel', secondary: true, onClick: () => setPendingSize(null) }]}>{pendingSize.text}.</Notice>);
  if (v.paletteProblem) notices.push(<Notice key="pp" severity="error" actions={v.paletteFile ? [{ label: 'Open palette', onClick: () => void ask('openPalette', {}) }] : undefined}>{v.paletteProblem}</Notice>);
  if (v.exportProblem && !v.paletteProblem) notices.push(<Notice key="ep" severity="error">{v.exportProblem}. Generating is blocked until this is fixed; the document can still be saved.</Notice>);
  for (const w of v.analysis.warnings) notices.push(<Notice key={`w${w}`} severity="warning">{w}.</Notice>);
  if (v.analysis.transparentAsPen0 && !tiles)
    notices.push(<Notice key="t0" severity="info" actions={[{ label: 'Make masked', onClick: () => void send({ op: 'setMasked', value: true }) }]}>{plural(v.analysis.transparentAsPen0, 'transparent pixel')} will come out as pen 0 because this sprite is not masked.</Notice>);
  if (!v.generateOnSave && (v.outputState === 'stale' || v.outputState === 'missing') && !v.exportProblem)
    notices.push(<Notice key="stale" severity="info" actions={[{ label: 'Generate', onClick: () => void generate() }]}>{v.outputState === 'missing' ? `${v.output} has not been generated yet.` : `${v.output} is out of date.`}</Notice>);
  if (v.generated && v.generated.seq > seenGen) notices.push(<Notice key={`g${v.generated.seq}`} severity={v.generated.ok ? 'info' : 'error'} onDismiss={() => setSeenGen(v.generated?.seq ?? 0)}>{v.generated.message}</Notice>);
  for (const m of msgs) notices.push(<Notice key={m.key} severity={m.severity} actions={m.actions} onDismiss={() => dismiss(m.key)}>{m.text}</Notice>);

  // -------------------------------------------------------- the panels
  const slots = penSlots(v);
  const caption = (i: number): { short: string; spoken: string } =>
    i < 0 ? { short: 'T', spoken: 'Transparent' } : plus ? { short: `C${i}`, spoken: `Sprite colour ${i}` } : { short: `P${i}`, spoken: `Pen ${i}` };
  const strip = (
    <FrameStrip
      thumbs={thumbs}
      w={v.w}
      h={v.h}
      selected={cur}
      noun={noun}
      layout={tiles ? 'grid' : 'strip'}
      horizontal={narrow}
      canDelete={tiles ? n > 0 : n > 1}
      canAdd={!(tiles && n >= 256)}
      addWhy="tile numbers go up to 255"
      numbers={numbers}
      duplicates={tiles ? new Set(v.analysis.duplicates.map(([d]) => d)) : undefined}
      onSelect={gotoItem}
      onAdd={addItem}
      onDuplicate={dupItem}
      onDelete={delItem}
      onMove={moveItem}
      onEnter={() => areaRef.current?.querySelector<HTMLElement>('.cb-canvas')?.focus()}
      onColumns={setCols}
    />
  );

  const local = pt && pt.x - off.x >= 0 && pt.y - off.y >= 0 && pt.x - off.x < lw && pt.y - off.y < lh ? { x: pt.x - off.x, y: pt.y - off.y } : null;
  const status = [
    { id: 'xy', value: local ? `x ${local.x}, y ${local.y}` : 'x --, y --' },
    !plus && { id: 'byte', label: 'byte', value: local ? Math.floor(local.x / ppb) : '--' },
    { id: 'pen', value: describeValue(v, lPen) },
    tiles ? { id: 'tile', value: `tile ${cur} of ${n}` } : { id: 'frame', value: `${noun} ${n ? cur + 1 : 0} of ${n}` },
    { id: 'size', value: plus ? `${v.w}x${v.h} px` : `${v.w}x${v.h} px = ${plural(v.w / ppb, 'byte')} wide` },
    v.analysis.itemBytes ? { id: 'bytes', value: tiles ? `${v.analysis.itemBytes} B/tile` : `${v.analysis.itemBytes} B/frame${v.masked ? ' (masked)' : ''}` } : undefined,
    { id: 'total', value: `${plural(n, noun)}, ${v.analysis.totalBytes} B total` },
    v.analysis.totalBytes >= v.limit * 0.9 ? { id: 'limit', value: `limit ${v.limit}` } : undefined,
    mirX || mirY ? { id: 'mirror', value: `mirror ${mirX ? 'X' : ''}${mirY ? 'Y' : ''}` } : undefined,
    sel ? { id: 'sel', value: `selection ${sel.w}x${sel.h} at ${sel.x},${sel.y}` } : undefined,
    v.analysis.warnings.length ? { id: 'warn', value: <><Icon name="warning" /> {v.analysis.warnings.length} warning{v.analysis.warnings.length === 1 ? '' : 's'}</> } : undefined,
  ];

  const canvasLabel = tiles
    ? `Tile ${cur} of ${n}, ${v.w} by ${v.h} pixels, mode ${v.mode}${view16 ? `, 16 by 16 view of tiles ${4 * t16} to ${4 * t16 + 3}` : ''}`
    : `${plus ? 'Plus sprite' : 'Sprite'} ${v.name}, frame ${cur + 1} of ${n}, ${v.w} by ${v.h} pixels${plus ? '' : `, mode ${v.mode}`}`;

  const props = (
    <PropertyPanel label={tiles ? 'Tile set properties' : 'Sprite properties'}>
      {!tiles && (
        <Section title="Preview" open={narrow ? propsOpen : true} onToggle={setPropsOpen}>
          <div class="sp-preview">
            {n > 0 && <Thumb rgba={thumbs[Math.min(shown, n - 1)]} w={v.w} h={v.h} scale={plus ? 2 * magY : Math.max(1, Math.floor(96 / Math.max(v.w * (crt ? aspectWidth(aKey, 'crt') : 1), v.h)))} aw={plus ? (crt ? magX / (2 * magY) : magX / magY) : crt ? aspectWidth(aKey, 'crt') : 1} label={`Preview of ${noun} ${shown + 1}`} />}
          </div>
          <div class="cb-row">
            <button type="button" class="cb-icon-btn" aria-label={playing ? 'Pause preview (P)' : 'Play preview (P)'} title={playing ? 'Pause (P)' : 'Play (P)'} aria-pressed={playing} onClick={() => setPlaying((p) => !p)}><Icon name={playing ? 'debug-pause' : 'play'} /></button>
            <CheckField id="sp-all" label="Play all frames" checked={allFrames} onChange={setAllFrames} />
          </div>
          <NumberField id="sp-fps" label="Rate (frames per second)" value={fps} min={1} max={60} onCommit={setFps} />
          {plus && (
            <>
              <Field id="sp-magx" label="Magnification X"><Segmented label="Magnification X" value={magX} options={[1, 2, 4].map((m) => ({ value: m, label: `x${m}` }))} onChange={(m) => setMagX(Number(m))} /></Field>
              <Field id="sp-magy" label="Magnification Y"><Segmented label="Magnification Y" value={magY} options={[1, 2, 4].map((m) => ({ value: m, label: `x${m}` }))} onChange={(m) => setMagY(Number(m))} /></Field>
              <p class="cb-muted">In CPC aspect a sprite pixel is magx / (2 x magy) as wide as it is tall.</p>
              <div role="group" aria-label="Sprite slot (preview order only)">
                <div class="cb-muted">Sprite slot (lower numbers draw in front; preview ordering only)</div>
                <div class="sp-slots">{Array.from({ length: 16 }, (_, i) => <button key={i} type="button" class={`sp-slot${slot === i ? ' sp-slot-on' : ''}`} aria-pressed={slot === i} aria-label={`Sprite slot ${i}`} title="Lower numbers draw in front (preview ordering only)" onClick={() => setSlot(i)}>{i}</button>)}</div>
              </div>
            </>
          )}
        </Section>
      )}
      <Section title={tiles ? 'Tile set' : plus ? 'Plus sprite' : 'Sprite'} open={narrow ? propsOpen : true} onToggle={setPropsOpen}>
        <TextField id="sp-name" label="Name" value={v.name} description="Prefix of the generated arrays and constants." validate={(t) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? undefined : 'Use letters, digits and _, not starting with a digit')} onCommit={(t) => void send({ op: 'setName', name: t })} />
        {!plus && (
          <Field id="sp-mode" label="Mode">
            <Segmented label="Screen mode" value={v.mode} options={([0, 1, 2] as const).map((m) => ({ value: m, label: `${m}`, title: `Mode ${m}: ${[16, 4, 2][m]} pens, ${[2, 4, 8][m]} pixels per byte` }))} onChange={(m) => void chooseMode(m)} />
          </Field>
        )}
        {!plus && !tiles && (
          <>
            <NumberField id="sp-w" label="Frame width (pixels)" value={v.w} min={ppb} max={1024} step={ppb} bigStep={2} pageStep={ppb * 4} description={`A multiple of ${ppb} (mode ${v.mode}).`} onCommit={(w) => void resize(w, v.h)} />
            <NumberField id="sp-h" label="Frame height (pixels)" value={v.h} min={1} max={1024} onCommit={(h) => void resize(v.w, h)} />
            <CheckField id="sp-masked" label="Masked" checked={v.masked} description="Masked sprites keep the background where a pixel is transparent (mask, pixel byte pairs)." onChange={(c) => void send({ op: 'setMasked', value: c })} />
          </>
        )}
        {plus && <p class="cb-muted">16 x 16 pixels, 15 colours and transparent. The array holds one byte per pixel (0 = transparent).</p>}
        {tiles && <CheckField id="sp-dedupe" label="Drop duplicate tiles" checked={v.dedupe} description="Like --dedupe: duplicates are removed and NAME_MAP maps each position to a tile." onChange={(c) => void send({ op: 'setDedupe', value: c })} />}
        {tiles && (
          <>
            <CheckField id="sp-numbers" label="Show tile numbers" checked={numbers} onChange={setNumbers} />
            {v.analysis.duplicates.length > 0 && (
              <ul class="sp-dups" aria-label="Duplicate tiles">
                {v.analysis.duplicates.slice(0, 12).map(([d, f]) => (
                  <li key={d}><button type="button" class="cb-link" onClick={() => gotoItem(d)}>Tile {d} duplicates tile {f}</button>{v.dedupe ? ': dropped by dedupe' : ': dedupe would drop it'}</li>
                ))}
                {v.analysis.duplicates.length > 12 && <li class="cb-muted">and {v.analysis.duplicates.length - 12} more</li>}
              </ul>
            )}
            <p class="cb-muted">{n} of 256 tiles. {view16 ? '' : 'Neighbouring tiles are dimmed; click one to edit it.'}</p>
          </>
        )}
      </Section>
      <Section title="Palette" open={narrow ? propsOpen : true} onToggle={setPropsOpen}>
        <Field id="sp-pal" label="Palette">
          <select id="sp-pal" class="cb-select" value={v.paletteFile !== undefined ? 'file' : 'inline'}
            onChange={(e) => {
              const val = (e.target as HTMLSelectElement).value;
              if (val === 'file') void ask('setPaletteFile', { baseVersion: version.current }).then((r) => r?.message && say('info', r.message, 'palshare'));
              else void ask('inlinePalette', { baseVersion: version.current });
            }}>
            <option value="inline">This document</option>
            <option value="file">Shared file...</option>
          </select>
        </Field>
        {v.paletteFile !== undefined && (
          <div class="cb-row">
            <button type="button" class="cb-link" onClick={() => void ask('openPalette', {})} title="Open the palette file in the palette editor">{v.paletteFile}</button>
            <button type="button" class="cb-icon-btn" aria-label="Choose another palette file" title="Choose another palette file" onClick={() => void ask('setPaletteFile', { baseVersion: version.current })}><Icon name="folder-opened" /></button>
          </div>
        )}
        <p class="cb-muted">
          {v.paletteFile !== undefined
            ? 'Changes to the palette file show here as soon as it is saved. Editing a pen colour happens in the palette editor.'
            : 'Double-click a pen to change its colour. Pens of one colour stay distinct here; a PNG round trip through the importer would merge them.'}
        </p>
      </Section>
      <Section title="Output" open={narrow ? propsOpen : true} onToggle={setPropsOpen}>
        <TextField id="sp-out" label="Output file" value={v.output} description="Relative to this document." validate={(t) => (t ? undefined : 'Enter a file name')} onCommit={(t) => void send({ op: 'setOutput', path: t })} />
        {!plus && <CheckField id="sp-emit" label="Emit palette" checked={v.emitPalette} description={v.paletteFile !== undefined ? 'Off when another document of the project already emits the shared palette (NAME_pal, NAME_PENS).' : 'NAME_pal and NAME_PENS.'} onChange={(c) => void send({ op: 'setEmitPalette', value: c })} />}
        {plus && <CheckField id="sp-packed" label="Packed (two pixels per byte)" checked={v.packed} onChange={(c) => void send({ op: 'setPacked', value: c })} />}
        {plus && (
          <Field id="sp-fmt" label="Format">
            <select id="sp-fmt" class="cb-select" value={v.plusFormat} onChange={(e) => void send({ op: 'setPlusFormat', value: (e.target as HTMLSelectElement).value as 'bas' | 'asm' | 'bin' })}>
              <option value="bas">bas (Boriel BASIC)</option><option value="asm">asm (defb lines)</option><option value="bin">bin (raw, with a .pal)</option>
            </select>
          </Field>
        )}
        <p class="cb-muted">{v.generateOnSave ? 'Written when the document is saved (cpcbuild.assets.generateOnSave).' : 'Not written on save: turn on cpcbuild.assets.generateOnSave, or use Generate.'}</p>
        <div class="cb-row">
          <button type="button" class="cb-btn" onClick={() => void generate()} aria-disabled={v.exportProblem ? 'true' : undefined} title={v.exportProblem ?? `Write ${v.output}`}>Generate</button>
          <span class="cb-muted">{v.outputState === 'current' ? 'Output is up to date' : v.outputState === 'stale' ? 'Output is out of date' : v.outputState === 'missing' ? 'Not generated yet' : ''}</span>
        </div>
      </Section>
      <Section title="Copy as" open={narrow ? propsOpen : true} onToggle={setPropsOpen}>
        <div class="sp-formats" role="radiogroup" aria-label="Copy format">
          {v.snippets.map((s) => (
            <label key={s.id}><input type="radio" name="sp-fmt" checked={s.id === (snippetOf(fmt) ? fmt : 'use')} onChange={() => setFmt(s.id)} /> {s.label}</label>
          ))}
        </div>
        {(() => {
          const s = snippetOf(fmt) ?? snippetOf('use');
          return s ? <Copyable value={s.text.length > 6000 ? s.text.slice(0, 6000) + '\n...' : s.text} label={s.label} multiline copy={(t) => ask('copy', { text: s.text.length > 6000 ? s.text : t })} /> : null;
        })()}
        <div class="cb-muted">Equivalent command</div>
        <Copyable value={v.command} label="the img2cpc.py command" copy={(t) => ask('copy', { text: t })} />
      </Section>
    </PropertyPanel>
  );

  const popCurrent = popover === null ? '' : plus ? (v.colours?.[popover - 1] ?? '000') : String(v.pens?.[popover] ?? 0);

  return (
    <div class="sp">
      <h1 class="cb-visually-hidden">{tiles ? 'Tile set' : 'Sprite'} {v.fileName}</h1>
      <div class="cb-visually-hidden" aria-live="polite">{live}</div>
      <Toolbar label={tiles ? 'Tile editor' : 'Sprite editor'} groups={groups} onEscape={() => areaRef.current?.querySelector<HTMLElement>('.cb-canvas')?.focus()} />
      {help && <Help onClose={() => setHelp(false)} />}
      {notices}
      <div class="sp-body">
        <div class="sp-left">{n > 0 || !tiles ? strip : null}</div>
        <div class="sp-center" ref={areaRef}>
          {n === 0 ? (
            <EmptyState icon={tiles ? 'table' : 'file-media'} title={tiles ? 'No tiles yet' : 'No frames yet'} text={tiles ? 'Add a tile to start drawing.' : 'Add a frame to start drawing.'} action={{ label: tiles ? 'Add tile' : 'Add frame', onClick: addItem }} />
          ) : (
            <>
              {tiles && (
                <div class="sp-t16-pick" hidden={!view16}>
                  <label>16x16 tile <select class="cb-select" value={t16} onChange={(e) => setT16(Number((e.target as HTMLSelectElement).value))}>
                    {Array.from({ length: Math.max(1, Math.ceil(n / 4)) }, (_, t) => <option key={t} value={t}>{t} (tiles {4 * t}-{4 * t + 3})</option>)}
                  </select></label>
                </div>
              )}
              <div class="sp-canvas" onKeyDownCapture={onCanvasKey as never} onContextMenu={(e) => e.preventDefault()}>
                <PixelCanvas
                  image={image}
                  zoom={zoom}
                  aw={aw}
                  grid={{ pixel: gridPixel, byteEvery: !plus && gridByte ? byteGridEvery(v.mode) : 0, tileEvery: tiles ? 8 : gridTile ? 8 : undefined }}
                  selection={sel ? { ...sel, x: sel.x + off.x, y: sel.y + off.y } : null}
                  cursor={pt}
                  label={canvasLabel}
                  bytePx={ppb}
                  onPointer={onPointer}
                  onCursor={setPt}
                  onApply={onApply}
                  onZoomWheel={(dir) => setZoom(stepZoom(zoom, dir, aw))}
                />
              </div>
            </>
          )}
        </div>
        <div class="sp-side">{props}</div>
      </div>
      <div class="sp-foot">
      <div class="sp-pens">
        <PenStrip
          label="Pens"
          slots={slots}
          left={lPen}
          right={rPen}
          groups={[{ label: '', from: -1 }]}
          compact
          caption={caption}
          onSelect={penPick}
          onActivate={(i) => {
            if (i < 0) return;
            if (v.paletteFile !== undefined) { say('info', `This palette is the shared file ${v.paletteFile}: opening it in the palette editor.`, 'palopen'); void ask('openPalette', {}); return; }
            if (!plus && i >= (v.pens?.length ?? 0)) { setPenAt(i, '0'); return; }
            setPopover(i);
          }}
        />
        <div class="cb-row" role="group" aria-label="Palette actions">
          <button type="button" class="cb-icon-btn" aria-label="Add pen" title={plus && (v.colours?.length ?? 0) >= 15 ? 'The Plus sprite palette has 15 colours' : 'Add a pen'} aria-disabled={v.paletteFile !== undefined || (plus ? (v.colours?.length ?? 0) >= 15 : (v.pens?.length ?? 0) >= [16, 4, 2][v.mode]) ? 'true' : undefined} onClick={() => v.paletteFile === undefined && addPen()}><Icon name="add" /></button>
          <button type="button" class="cb-icon-btn" aria-label="Remove the last pen" title="Remove the last pen" aria-disabled={v.paletteFile !== undefined ? 'true' : undefined} onClick={() => v.paletteFile === undefined && removePen()}><Icon name="trash" /></button>
        </div>
        {popover !== null && <ColourPopover kind={plus ? 'plus' : 'cpc'} title={`Colour of ${caption(popover).spoken}`} current={popCurrent} onPick={(val) => setPenAt(popover, val)} onClose={() => setPopover(null)} />}
        <div class="cb-muted sp-pen-detail" aria-live="off">L: {describeValue(v, lPen)}. R: {describeValue(v, rPen)}.</div>
      </div>
      <StatusLine fields={status} hint="Wheel scrolls, Ctrl+wheel zooms, Alt+click picks, ? lists the keys" />
      </div>
    </div>
  );
}

startEditor(createClient<SpriteRequests, SpriteView>(), SpriteApp);
