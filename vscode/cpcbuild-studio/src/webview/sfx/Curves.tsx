/**
 * Curves.tsx -- the three lanes of the sound-effects editor on one time axis: the pitch curve, the
 * volume bars and the mixer / noise lane (tone on-off strip, noise on-off strip, noise period bars).
 * Mouse: click or drag sets values; Shift+drag draws a straight line from the last point; points
 * snap to semitones unless Alt is held. Keyboard (each canvas takes focus): Left / Right move the
 * frame cursor, Up / Down change the value there, T and N toggle tone and noise, Insert and Delete
 * add and remove a frame. The pure maths is in curve.ts.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOCKS, SfxFrame, SfxTarget, noteName, period } from '../../core/sfxDoc';
import { themeVar, useThemeVersion, withAlpha } from '../shared/theme';
import * as C from './curve';

export const AXIS_W = 48;
const PITCH_H = 220;
const VOL_H = 96;
const STRIP_H = 16;
const PERIOD_H = 64;
const PERIOD_Y = 36; // tone strip 0-16, noise strip 18-34, period bars from 36
const NOISE_H = PERIOD_Y + PERIOD_H;
const RULER_H = 18;
const PAD_R = 16;

type Kind = 'pitch' | 'volume' | 'noise';

interface Gesture {
  lane: C.Lane;
  base: SfxFrame[];
  anchor: { i: number; v: number } | null;
  prev: { i: number; v: number };
  flag: boolean;
}

export interface CurvesProps {
  /** The committed frames of the selected effect. */
  frames: SfxFrame[];
  effectName: string;
  cellW: number;
  range: { lo: number; hi: number };
  target: SfxTarget;
  cursor: number;
  playFrame: number | null;
  onCursor(i: number): void;
  /** Replace `frames` from `start` (one undo step). Resolves when the host has answered; never rejects. */
  onCommit(start: number, frames: SfxFrame[], label: string): Promise<void>;
  onInsertFrame(at: number): void;
  onDeleteFrame(at: number): void;
}

function prep(cv: HTMLCanvasElement | null, w: number, h: number): CanvasRenderingContext2D | null {
  if (!cv) return null;
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const ctx = cv.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function Curves(p: CurvesProps) {
  const { cellW, range } = p;
  const [draft, setDraft] = useState<SfxFrame[] | null>(null);
  const draftRef = useRef<SfxFrame[] | null>(null);
  const pending = useRef(0);
  const gesture = useRef<Gesture | null>(null);
  const last = useRef<Partial<Record<C.Lane, { i: number; v: number }>>>({});
  const theme = useThemeVersion();
  const shown = draft ?? p.frames;
  const n = shown.length;
  const plotW = n * cellW + PAD_R;
  const cvP = useRef<HTMLCanvasElement>(null);
  const cvV = useRef<HTMLCanvasElement>(null);
  const cvN = useRef<HTMLCanvasElement>(null);
  const axP = useRef<HTMLCanvasElement>(null);
  const axV = useRef<HTMLCanvasElement>(null);
  const axN = useRef<HTMLCanvasElement>(null);
  const axR = useRef<HTMLCanvasElement>(null);
  const cvR = useRef<HTMLCanvasElement>(null);
  const scroll = useRef<HTMLDivElement>(null);

  const setBoth = (d: SfxFrame[] | null): void => {
    draftRef.current = d;
    setDraft(d);
  };
  const current = (): SfxFrame[] => draftRef.current ?? p.frames;

  /** Sends frames[start..end] of `next` to the host; the draft stays on screen until the last pending edit is answered. */
  const commit = (next: SfxFrame[], start: number, end: number, label: string): void => {
    setBoth(next);
    pending.current++;
    void p.onCommit(start, next.slice(start, end + 1), label).finally(() => {
      if (--pending.current === 0) setBoth(null);
    });
  };

  // ------------------------------------------------------------- drawing
  useEffect(() => {
    const col = {
      bg: themeVar('--vscode-editor-background', '#1e1e1e'),
      fg: themeVar('--vscode-editor-foreground', '#cccccc'),
      desc: themeVar('--vscode-descriptionForeground', '#9d9d9d'),
      pitch: themeVar('--vscode-charts-blue', '#3794ff'),
      vol: themeVar('--vscode-charts-green', '#89d185'),
      noise: themeVar('--vscode-charts-orange', '#d18616'),
      play: themeVar('--vscode-charts-red', '#f14c4c'),
      focus: themeVar('--vscode-focusBorder', '#007fd4'),
      border: themeVar('--vscode-panel-border', '#80808059'),
    };
    const font = `11px ${themeVar('--vscode-editor-font-family', 'monospace')}`;
    const grid = withAlpha(col.fg, 0.12);
    const grid2 = withAlpha(col.fg, 0.28);
    const cursorFill = withAlpha(col.focus, 0.2);
    const playFill = withAlpha(col.play, 0.3);

    const base = (ctx: CanvasRenderingContext2D, h: number): void => {
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, plotW, h);
      if (p.cursor < n) {
        ctx.fillStyle = cursorFill;
        ctx.fillRect(p.cursor * cellW, 0, cellW, h);
      }
      if (p.playFrame !== null && p.playFrame < n) {
        ctx.fillStyle = playFill;
        ctx.fillRect(p.playFrame * cellW, 0, cellW, h);
      }
      ctx.strokeStyle = col.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(0.5, 0.5, n * cellW, h - 1);
    };
    const axisBase = (ctx: CanvasRenderingContext2D | null, h: number): CanvasRenderingContext2D | null => {
      if (!ctx) return null;
      ctx.fillStyle = col.bg;
      ctx.fillRect(0, 0, AXIS_W, h);
      ctx.font = font;
      ctx.fillStyle = col.desc;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      return ctx;
    };

    // pitch
    {
      const ctx = prep(cvP.current, plotW, PITCH_H);
      if (ctx) {
        base(ctx, PITCH_H);
        const px = PITCH_H / (range.hi - range.lo);
        for (let m = Math.ceil(range.lo); m <= range.hi; m++) {
          if (px < 5 && m % 12 !== 0) continue;
          const y = Math.round(C.pitchToY(m, PITCH_H, range.lo, range.hi)) + 0.5;
          ctx.strokeStyle = m % 12 === 0 ? grid2 : grid;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(n * cellW, y);
          ctx.stroke();
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = col.pitch;
        for (let i = 0; i < n; i++) {
          const f = shown[i];
          const y = C.pitchToY(f.pitch, PITCH_H, range.lo, range.hi);
          ctx.globalAlpha = f.volume === 0 || !f.tone ? 0.3 : 1;
          ctx.beginPath();
          ctx.moveTo(i * cellW + 1, y);
          ctx.lineTo((i + 1) * cellW - 1, y);
          ctx.stroke();
          if (i > 0) {
            ctx.globalAlpha = 0.45;
            ctx.beginPath();
            ctx.moveTo(i * cellW, C.pitchToY(shown[i - 1].pitch, PITCH_H, range.lo, range.hi));
            ctx.lineTo(i * cellW, y);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
      const ax = axisBase(prep(axP.current, AXIS_W, PITCH_H), PITCH_H);
      if (ax) {
        const px = PITCH_H / (range.hi - range.lo);
        for (let m = Math.ceil(range.lo); m <= range.hi; m++) {
          const c = m % 12;
          if (!(c === 0 || (px >= 11) || (px >= 5 && (c === 4 || c === 7)))) continue;
          ax.fillText(noteName(m), AXIS_W - 4, C.pitchToY(m, PITCH_H, range.lo, range.hi));
        }
      }
    }
    // volume
    {
      const ctx = prep(cvV.current, plotW, VOL_H);
      if (ctx) {
        base(ctx, VOL_H);
        for (const v of [5, 10]) {
          const y = Math.round(C.levelToY(v, VOL_H, 15)) + 0.5;
          ctx.strokeStyle = grid;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(n * cellW, y);
          ctx.stroke();
        }
        ctx.fillStyle = col.vol;
        for (let i = 0; i < n; i++) {
          const v = shown[i].volume;
          const h = Math.max(1, (v / 15) * VOL_H);
          ctx.fillRect(i * cellW + (cellW > 3 ? 1 : 0), VOL_H - h, Math.max(1, cellW - (cellW > 3 ? 1 : 0)), h);
        }
      }
      const ax = axisBase(prep(axV.current, AXIS_W, VOL_H), VOL_H);
      if (ax) {
        ax.fillText('15', AXIS_W - 4, 7);
        ax.fillText('8', AXIS_W - 4, VOL_H / 2);
        ax.fillText('0', AXIS_W - 4, VOL_H - 7);
        ax.textAlign = 'left';
        ax.fillText('vol', 2, VOL_H / 2 - 12);
      }
    }
    // mixer and noise
    {
      const ctx = prep(cvN.current, plotW, NOISE_H);
      if (ctx) {
        base(ctx, NOISE_H);
        for (let i = 0; i < n; i++) {
          const f = shown[i];
          const x = i * cellW + (cellW > 3 ? 1 : 0);
          const w = Math.max(1, cellW - (cellW > 3 ? 1 : 0));
          ctx.fillStyle = col.pitch;
          ctx.globalAlpha = f.tone ? 1 : 0.12;
          ctx.fillRect(x, 1, w, STRIP_H - 2);
          ctx.fillStyle = col.noise;
          ctx.globalAlpha = f.noise ? 1 : 0.12;
          ctx.fillRect(x, STRIP_H + 3, w, STRIP_H - 2);
          const h = Math.max(1, (f.noisePeriod / 31) * PERIOD_H);
          ctx.globalAlpha = f.noise ? 1 : 0.25;
          ctx.fillRect(x, PERIOD_Y + PERIOD_H - h, w, h);
        }
        ctx.globalAlpha = 1;
      }
      const ax = axisBase(prep(axN.current, AXIS_W, NOISE_H), NOISE_H);
      if (ax) {
        ax.fillText('tone', AXIS_W - 4, STRIP_H / 2);
        ax.fillText('noise', AXIS_W - 4, STRIP_H + 2 + STRIP_H / 2);
        ax.fillText('31', AXIS_W - 4, PERIOD_Y + 6);
        ax.fillText('0', AXIS_W - 4, NOISE_H - 6);
      }
    }
    // ruler
    {
      const ctx = prep(cvR.current, plotW, RULER_H);
      if (ctx) {
        ctx.fillStyle = col.bg;
        ctx.fillRect(0, 0, plotW, RULER_H);
        ctx.font = font;
        ctx.fillStyle = col.desc;
        ctx.strokeStyle = grid2;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const step = [1, 2, 5, 10, 25, 50].find((s) => s * cellW >= 34) ?? 50;
        for (let i = 0; i < n; i += step) {
          ctx.beginPath();
          ctx.moveTo(i * cellW + 0.5, 0);
          ctx.lineTo(i * cellW + 0.5, 4);
          ctx.stroke();
          ctx.fillText(String(i + 1), i * cellW + 2, RULER_H / 2 + 2);
        }
      }
      const ax = axisBase(prep(axR.current, AXIS_W, RULER_H), RULER_H);
      ax?.fillText('frame', AXIS_W - 4, RULER_H / 2 + 2);
    }
  });
  // (no dependency list: every render redraws; a redraw is a few hundred rectangles)
  void theme;

  // keep the cursor frame in view
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const x0 = p.cursor * cellW;
    if (x0 < el.scrollLeft) el.scrollLeft = x0 - 8;
    else if (x0 + cellW > el.scrollLeft + el.clientWidth) el.scrollLeft = x0 + cellW - el.clientWidth + PAD_R;
  }, [p.cursor, cellW]);

  // ------------------------------------------------------------- pointer
  const roundFor = (lane: C.Lane, alt: boolean) => (v: number): number => (lane === 'pitch' ? C.snapPitch(v, alt) : lane === 'volume' ? C.clamp(Math.round(v), 0, 15) : C.clamp(Math.round(v), 0, 31));

  /** Frame index and (for numeric lanes) the lane value under the pointer. */
  const sample = (kind: Kind, lane: C.Lane | null, e: PointerEvent, cv: HTMLCanvasElement): { lane: C.Lane; i: number; v: number } => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const i = C.xToFrame(x, cellW, current().length);
    if (kind === 'pitch') return { lane: 'pitch', i, v: C.snapPitch(C.yToPitch(y, PITCH_H, range.lo, range.hi), e.altKey) };
    if (kind === 'volume') return { lane: 'volume', i, v: C.yToLevel(y, VOL_H, 15) };
    const ln: C.Lane = lane ?? (y < STRIP_H + 1 ? 'tone' : y < PERIOD_Y - 1 ? 'noise' : 'period');
    return { lane: ln, i, v: ln === 'period' ? C.yToLevel(y - PERIOD_Y, PERIOD_H, 31) : 0 };
  };

  const down = (kind: Kind) => (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const cv = e.currentTarget as HTMLCanvasElement;
    cv.setPointerCapture(e.pointerId);
    cv.focus();
    const s = sample(kind, null, e, cv);
    const base = current();
    p.onCursor(s.i);
    if (s.lane === 'tone' || s.lane === 'noise') {
      const flag = !base[s.i][s.lane];
      gesture.current = { lane: s.lane, base, anchor: null, prev: { i: s.i, v: 0 }, flag };
      setBoth(C.paintFlags(base, s.lane, s.i, s.i, flag));
      return;
    }
    const anchor = e.shiftKey ? last.current[s.lane] ?? null : null;
    gesture.current = { lane: s.lane, base, anchor, prev: { i: s.i, v: s.v }, flag: false };
    const round = roundFor(s.lane, e.altKey);
    setBoth(anchor ? C.paintLine(base, s.lane, anchor.i, anchor.v, s.i, s.v, round) : C.paintLine(base, s.lane, s.i, s.v, s.i, s.v, round));
  };

  const move = (kind: Kind) => (e: PointerEvent): void => {
    const g = gesture.current;
    if (!g) return;
    const cv = e.currentTarget as HTMLCanvasElement;
    const s = sample(kind, g.lane, e, cv);
    if (s.i !== p.cursor) p.onCursor(s.i);
    if (g.lane === 'tone' || g.lane === 'noise') {
      setBoth(C.paintFlags(current(), g.lane, g.prev.i, s.i, g.flag));
      g.prev = { i: s.i, v: 0 };
      return;
    }
    const round = roundFor(g.lane, e.altKey);
    if (g.anchor) setBoth(C.paintLine(g.base, g.lane, g.anchor.i, g.anchor.v, s.i, s.v, round));
    else setBoth(C.paintLine(current(), g.lane, g.prev.i, g.prev.v, s.i, s.v, round));
    g.prev = { i: s.i, v: s.v };
  };

  const up = (e: PointerEvent): void => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    const next = current();
    const r = C.changedRange(g.base, next);
    if (g.lane !== 'tone' && g.lane !== 'noise') last.current[g.lane] = { i: g.prev.i, v: g.prev.v };
    if (!r) {
      if (pending.current === 0) setBoth(null);
      return;
    }
    const label = g.lane === 'pitch' ? 'Draw pitch' : g.lane === 'volume' ? 'Draw volume' : g.lane === 'period' ? 'Draw noise period' : g.lane === 'tone' ? 'Draw tone' : 'Draw noise';
    commit(next, r.start, r.end, label);
  };

  const cancel = (): void => {
    gesture.current = null;
    if (pending.current === 0) setBoth(null);
  };

  // ------------------------------------------------------------ keyboard
  const key = (kind: Kind) => (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey) return;
    const frames = current();
    const c = Math.min(p.cursor, frames.length - 1);
    const k = e.key;
    if (k === 'Escape' && gesture.current) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
      return;
    }
    const go = (i: number): void => {
      e.preventDefault();
      p.onCursor(C.clamp(i, 0, frames.length - 1));
    };
    if (k === 'ArrowLeft') return go(c - (e.shiftKey ? 10 : 1));
    if (k === 'ArrowRight') return go(c + (e.shiftKey ? 10 : 1));
    if (k === 'Home') return go(0);
    if (k === 'End') return go(frames.length - 1);
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (e.altKey && kind !== 'pitch') return;
      e.preventDefault();
      const lane = kind === 'pitch' ? 'pitch' : kind === 'volume' ? 'volume' : 'period';
      const nf = C.nudge(frames[c], lane, k === 'ArrowUp' ? 1 : -1, e.shiftKey, e.altKey);
      const next = frames.slice();
      next[c] = nf;
      if (C.changedRange(frames, next)) commit(next, c, c, lane === 'pitch' ? 'Change pitch' : lane === 'volume' ? 'Change volume' : 'Change noise period');
      return;
    }
    if (!e.altKey && !e.shiftKey && (k === 't' || k === 'T' || k === 'n' || k === 'N')) {
      e.preventDefault();
      const lane = k.toLowerCase() === 't' ? 'tone' : 'noise';
      const next = frames.slice();
      next[c] = C.setLane(frames[c], lane, !frames[c][lane]);
      commit(next, c, c, lane === 'tone' ? 'Toggle tone' : 'Toggle noise');
      return;
    }
    if (k === 'Insert') {
      e.preventDefault();
      p.onInsertFrame(c);
    } else if (k === 'Delete') {
      e.preventDefault();
      p.onDeleteFrame(c);
    }
  };

  // -------------------------------------------------------------- labels
  const c = Math.min(p.cursor, n - 1);
  const f = shown[c];
  const clock = CLOCKS[p.target];
  const where = `${p.effectName}, frame ${c + 1} of ${n}`;
  const labels = {
    pitch: `Pitch curve, ${where}: ${noteName(f.pitch)} (${f.pitch.toFixed(2)}), tone period ${period(f.pitch, clock)}. Left and Right move between frames, Up and Down change the pitch, Shift an octave, Alt a tenth of a semitone.`,
    volume: `Volume bars, ${where}: volume ${f.volume} of 15. Left and Right move between frames, Up and Down change the volume, Shift by 4.`,
    noise: `Tone, noise and noise period, ${where}: tone ${f.tone ? 'on' : 'off'}, noise ${f.noise ? 'on' : 'off'}, noise period ${f.noisePeriod}. T toggles tone, N toggles noise, Up and Down change the noise period.`,
  };
  const props = (kind: Kind, cv: preact.RefObject<HTMLCanvasElement | null>) => ({
    ref: cv,
    tabIndex: 0,
    role: 'application' as const,
    'aria-label': labels[kind],
    class: 'sx-canvas',
    onPointerDown: down(kind) as never,
    onPointerMove: move(kind) as never,
    onPointerUp: up as never,
    onPointerCancel: cancel,
    onKeyDown: key(kind) as never,
  });

  return (
    <div class="sx-lanes">
      <div class="sx-axes" style={{ width: `${AXIS_W}px` }} aria-hidden="true">
        <canvas ref={axP} />
        <canvas ref={axV} />
        <canvas ref={axN} />
        <canvas ref={axR} />
      </div>
      <div class="sx-scroll" ref={scroll}>
        <canvas {...props('pitch', cvP)} />
        <canvas {...props('volume', cvV)} />
        <canvas {...props('noise', cvN)} />
        <canvas ref={cvR} aria-hidden="true" />
      </div>
    </div>
  );
}
