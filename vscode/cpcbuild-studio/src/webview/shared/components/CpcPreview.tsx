/**
 * <cb-cpc-preview>: the same image as the CPC would show it in a chosen mode (pixel shape, pen limit, optional CRT lines,
 * border and real on-screen size), with an optional "compare modes" list. Pure display: the owner keeps the asset's own mode.
 * CPC colours are drawn by code from the palette; the chrome uses theme tokens only.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  FRAME, SCREEN, displaySize, fitScale, mergeNote, onScreenPixel, onScreenSize, pensLabel, reducePens, shapeLabel,
  type IndexedImage, type Reduced,
} from '../../../core/cpcPreview';
import type { RGB } from '../../../core/palette';
import type { Mode } from '../../../core/pixels';
import { rovingNext } from '../roving';
import { themeVar, useThemeVersion, withAlpha } from '../theme';
import { Pill } from './Pill';
import { SegPill } from './SegPill';
import { StatPill } from './StatPill';
import { ToggleChip } from './ToggleChip';

export interface PreviewOptions { shape: boolean; crt: boolean; onScreen: boolean }

export interface CpcPreviewProps {
  image: IndexedImage;
  /** The asset's own mode: a marker shows when mode === assetMode. */
  assetMode?: Mode;
  /** Marker text, default "asset's mode". */
  assetLabel?: string;
  mode: Mode;
  onMode(m: Mode): void;
  /** Shows a "Use mode N" pill when mode !== assetMode and the image fits the mode. */
  onUseMode?(m: Mode): void;
  /** Border colour from the owner's palette; none: no border fill. */
  border?: RGB;
  options?: Partial<PreviewOptions>;
  onOptions?(o: PreviewOptions): void;
  /** Show the CRT lines / On screen / Border controls. */
  extras?: boolean;
  compare?: 'inline' | 'popover' | 'none';
  maxWidth?: number;
  maxHeight?: number;
  /** Accessible name prefix, default "CPC preview". */
  label?: string;
  /** Replaces the built-in pen reduction (the sprite editor shows exactly what its Convert will do). Indices are into `image.palette`. */
  reduce?(mode: Mode): Reduced;
}

const MODES: Mode[] = [0, 1, 2];
const MODE_LABEL: Record<Mode, string> = { 0: 'Mode 0 · 16', 1: 'Mode 1 · 4', 2: 'Mode 2 · 2' };
/** Narrow containers (under 300 px) show "0 · 16"; the full text stays the accessible name and tooltip. */
const NARROW_AT = 300;
const rgbCss = (c: RGB): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** The reduced image as RGBA at image resolution; transparent pixels stay alpha 0. */
function toImageData(img: IndexedImage, r: Reduced): ImageData {
  const d = new ImageData(img.w, img.h);
  for (let i = 0; i < r.pixels.length; i++) {
    const c = img.palette[r.pixels[i]];
    if (!c) continue;
    d.data[i * 4] = c.rgb[0]; d.data[i * 4 + 1] = c.rgb[1]; d.data[i * 4 + 2] = c.rgb[2]; d.data[i * 4 + 3] = 255;
  }
  return d;
}

function paint(c: HTMLCanvasElement | null, img: IndexedImage, r: Reduced): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  if (c.width !== img.w || c.height !== img.h) { c.width = img.w; c.height = img.h; }
  ctx.putImageData(toImageData(img, r), 0, 0);
}

function paintCrt(c: HTMLCanvasElement | null, w: number, h: number, py: number): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  c.width = w; c.height = h;
  ctx.clearRect(0, 0, w, h);
  if (py < 2) return;
  ctx.fillStyle = 'rgb(0 0 0 / 0.25)';
  for (let y = 0; y < h; y += py) for (let r = 1; r < py; r += 2) ctx.fillRect(0, y + r, w, 1);
}

function paintScreen(c: HTMLCanvasElement | null, img: IndexedImage, r: Reduced, mode: Mode, cssW: number, cssH: number, border: RGB | undefined, crt: boolean): void {
  const ctx = c?.getContext('2d');
  if (!c || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(cssW * dpr); c.height = Math.round(cssH * dpr);
  const f = (cssW / FRAME.w) * dpr;
  ctx.fillStyle = border ? rgbCss(border) : themeVar('--vscode-editor-background', '#1e1e1e');
  ctx.fillRect(0, 0, c.width, c.height);
  const dx = FRAME.displayX * f, dy = FRAME.displayY * f;
  ctx.fillStyle = themeVar('--vscode-editor-background', '#1e1e1e');
  ctx.fillRect(dx, dy, FRAME.displayW * f, FRAME.displayH * f);
  const off = document.createElement('canvas');
  off.width = img.w; off.height = img.h;
  off.getContext('2d')?.putImageData(toImageData(img, r), 0, 0);
  const p = onScreenPixel(mode);
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.beginPath(); ctx.rect(dx, dy, FRAME.displayW * f, FRAME.displayH * f); ctx.clip();
  ctx.drawImage(off, dx, dy, img.w * p.w * f, img.h * p.h * f);
  if (crt) {
    ctx.fillStyle = 'rgb(0 0 0 / 0.25)';
    for (let y = 0; y < FRAME.displayH; y += 2) ctx.fillRect(dx, dy + (y + 1) * f, FRAME.displayW * f, Math.max(1, f));
  }
  ctx.restore();
  ctx.strokeStyle = withAlpha(themeVar('--vscode-editor-foreground', '#cccccc'), 0.6);
  ctx.lineWidth = Math.max(1, dpr);
  ctx.setLineDash([4 * dpr, 3 * dpr]);
  ctx.strokeRect(dx + 0.5, dy + 0.5, FRAME.displayW * f - 1, FRAME.displayH * f - 1);
}

/** One small canvas (compare rows). */
function Thumb({ image, reduced, mode, border }: { image: IndexedImage; reduced: Reduced; mode: Mode; border?: RGB }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const s = fitScale(image, mode, 200, 112);
  const d = displaySize(image, mode, s);
  useEffect(() => paint(ref.current, image, reduced), [image, reduced]);
  return (
    <span class="cb-prev-thumb" style={border ? { background: rgbCss(border) } : undefined} aria-hidden="true">
      <canvas ref={ref} class="cb-prev-canvas" width={image.w} height={image.h} style={{ width: `${d.w}px`, height: `${d.h}px` }} />
    </span>
  );
}

function CompareList({ image, reduced, mode, onMode, border, label }: { image: IndexedImage; reduced: Record<Mode, Reduced>; mode: Mode; onMode(m: Mode): void; border?: RGB; label: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | undefined>();
  const tabbable = focused ?? mode;
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const n = rovingNext(3, i, e.key);
    if (n === undefined) return;
    e.preventDefault();
    onMode(MODES[n]);
    root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <div class="cb-prev-compare" role="radiogroup" aria-label={label} ref={root}>
      {MODES.map((m, i) => {
        const r = reduced[m];
        return (
          <button
            key={m}
            type="button"
            role="radio"
            class="cb-prev-row"
            aria-checked={m === mode}
            tabIndex={i === tabbable ? 0 : -1}
            data-testid={`cpc-compare-${m}`}
            onFocus={() => setFocused(i)}
            onBlur={() => setFocused(undefined)}
            onClick={() => onMode(m)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <Thumb image={image} reduced={r} mode={m} border={border} />
            <span class="cb-prev-rowtext">
              <span class="cb-prev-name">Mode {m}</span>
              <span class="cb-prev-spec">{SCREEN[m].w} × {SCREEN[m].h} · {r.limit} pens · pixels {shapeLabel(m).replace(/ /g, '')}</span>
              <StatPill state={r.fits ? 'ok' : 'warn'}>{mergeNote(r)}</StatPill>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function ComparePopover(p: { image: IndexedImage; reduced: Record<Mode, Reduced>; mode: Mode; onMode(m: Mode): void; border?: RGB }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const close = (restore: boolean): void => {
    setOpen(false);
    if (restore) wrap.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
  };
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('.cb-prev-row[aria-checked="true"]')?.focus();
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div
      class="cb-menu-wrap"
      ref={wrap}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
        else if (open && e.key === 'Tab') close(false);
      }}
    >
      <Pill label="Compare modes" size="sm" aria={{ 'aria-haspopup': 'dialog', 'aria-expanded': open }} onClick={() => setOpen(!open)} />
      {open && (
        <div class="cb-menu cb-prev-pop" role="dialog" aria-label="Compare modes">
          <CompareList image={p.image} reduced={p.reduced} mode={p.mode} onMode={p.onMode} border={p.border} label="Compare modes" />
        </div>
      )}
    </div>
  );
}

export function CpcPreview(p: CpcPreviewProps) {
  const label = p.label ?? 'CPC preview';
  const extras = !!p.extras;
  const compare = p.compare ?? 'none';
  const maxW = p.maxWidth ?? 360, maxH = p.maxHeight ?? 240;
  const theme = useThemeVersion();
  const rootRef = useRef<HTMLDivElement>(null);
  const [short, setShort] = useState(false);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const m = (): void => setShort(el.clientWidth < NARROW_AT);
    m();
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [own, setOwn] = useState<PreviewOptions>({ shape: true, crt: false, onScreen: false });
  const [borderOn, setBorderOn] = useState(true);
  const opts: PreviewOptions = { ...own, ...p.options };
  const setOpts = (o: Partial<PreviewOptions>): void => {
    const next = { ...opts, ...o };
    setOwn(next);
    p.onOptions?.(next);
  };
  const shape = opts.shape;
  const crt = extras && opts.crt;
  const onScreen = extras && opts.onScreen;
  const border = p.border && (!extras || borderOn) ? p.border : undefined;

  const reduced = useMemo(() => ({ 0: (p.reduce ?? ((m) => reducePens(p.image, m)))(0), 1: (p.reduce ?? ((m) => reducePens(p.image, m)))(1), 2: (p.reduce ?? ((m) => reducePens(p.image, m)))(2) }) as Record<Mode, Reduced>, [p.image, p.reduce]);
  const r = reduced[p.mode];
  const size = onScreenSize(p.image, p.mode);
  // pixel shape off: square pixels (mode 1 geometry)
  const geo = shape ? p.mode : 1;
  const scale = fitScale(p.image, geo, maxW, maxH);
  const d = displaySize(p.image, geo, scale);
  const f = Math.min(maxW / FRAME.w, maxH / FRAME.h);
  const frameW = Math.round(FRAME.w * f), frameH = Math.round(FRAME.h * f);

  const main = useRef<HTMLCanvasElement>(null);
  const crtRef = useRef<HTMLCanvasElement>(null);
  const screen = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (onScreen) paintScreen(screen.current, p.image, r, p.mode, frameW, frameH, border, crt);
    else {
      paint(main.current, p.image, r);
      if (crt) paintCrt(crtRef.current, d.w, d.h, d.py);
    }
  }, [p.image, r, p.mode, onScreen, crt, border?.[0], border?.[1], border?.[2], d.w, d.h, d.py, frameW, frameH, theme]);

  const alt = `${label} in mode ${p.mode}: pixels ${shapeLabel(p.mode)}, ${pensLabel(r)}, ${mergeNote(r)}`;
  const isAsset = p.assetMode !== undefined && p.mode === p.assetMode;
  const canUse = !!p.onUseMode && p.assetMode !== undefined && p.mode !== p.assetMode && r.fits;
  const canvasStyle = { width: `${d.w}px`, height: `${d.h}px` };
  return (
    <div class="cb-prev" role="group" aria-label={label} ref={rootRef}>
      <div class="cb-prev-head">
        <span class="cb-label">Preview as</span>
        <SegPill label="Preview mode" testId="cpc-mode" value={p.mode} onChange={(m) => p.onMode(m as Mode)} options={MODES.map((m) => (short ? { value: m, label: MODE_LABEL[m].slice(5), title: MODE_LABEL[m], ariaLabel: MODE_LABEL[m] } : { value: m, label: MODE_LABEL[m] }))} />
        <span class="cb-prev-spacer" />
        <ToggleChip label="CPC pixel shape" pressed={shape} onChange={(v) => setOpts({ shape: v })} />
        {extras && <ToggleChip label="CRT lines" pressed={opts.crt} onChange={(v) => setOpts({ crt: v })} />}
        {extras && <ToggleChip label="On screen" pressed={opts.onScreen} onChange={(v) => setOpts({ onScreen: v })} />}
        {extras && p.border && <ToggleChip label="Border" pressed={borderOn} onChange={setBorderOn} />}
        {compare === 'popover' && <ComparePopover image={p.image} reduced={reduced} mode={p.mode} onMode={p.onMode} border={border} />}
      </div>
      <div class="cb-prev-well">
        {onScreen ? (
          <canvas ref={screen} class="cb-prev-canvas cb-prev-frame" role="img" aria-label={`${alt}; shown at its size on the screen`} style={{ width: `${frameW}px`, height: `${frameH}px` }} />
        ) : (
          <div class="cb-prev-border" style={border ? { background: rgbCss(border) } : undefined} data-bordered={border ? 'true' : undefined}>
            <div class={`cb-prev-img${border ? '' : ' cb-canvas-stack'}`} style={canvasStyle}>
              <canvas ref={main} class="cb-prev-canvas" role="img" aria-label={alt} width={p.image.w} height={p.image.h} style={canvasStyle} />
              {crt && <canvas ref={crtRef} class="cb-prev-crt" aria-hidden="true" style={canvasStyle} />}
            </div>
          </div>
        )}
      </div>
      <div class="cb-prev-readouts">
        <StatPill>{SCREEN[p.mode].w} × {SCREEN[p.mode].h} screen</StatPill>
        <StatPill>pixels {shapeLabel(p.mode)}</StatPill>
        <StatPill>{pensLabel(r)}</StatPill>
        {r.fits ? <StatPill state="ok">fits this mode</StatPill> : <StatPill state="warn">{mergeNote(r)}</StatPill>}
        {onScreen && !size.fits && <StatPill state="warn">too big for the screen</StatPill>}
        {isAsset && <StatPill state="ok">{p.assetLabel ?? "asset's mode"}</StatPill>}
        {canUse && <Pill size="sm" variant="primary" label={`Use mode ${p.mode}`} onClick={() => p.onUseMode?.(p.mode)} />}
      </div>
      <p class="cb-muted cb-prev-note">Preview only: the asset keeps its own mode until you convert it.</p>
      {compare === 'inline' && <CompareList image={p.image} reduced={reduced} mode={p.mode} onMode={p.onMode} border={border} label="Compare modes" />}
    </div>
  );
}
