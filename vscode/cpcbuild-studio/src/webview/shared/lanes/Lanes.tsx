/**
 * Lanes.tsx -- the lanes of the sound-effects editor and of the tracker's instrument editor on one time
 * axis: the pitch curve, the volume bars and the mixer / noise lane (tone on-off strip, noise on-off strip,
 * noise period bars). The pitch lane shows absolute notes (effects) or whole-semitone offsets (instruments,
 * `pitchMode="offset"`). With `onLoop` a loop band sits under the ruler: its start marker drags, L sets the
 * loop at the cursor frame and Shift+L clears it. `readOnly` shows the lanes without editing them.
 * Mouse: click or drag sets values; in Line mode (or with Shift held in Draw mode) a click draws a
 * straight line from the last point; points
 * snap to semitones unless Alt is held. Keyboard (each canvas takes focus): Left / Right move the
 * frame cursor, Up / Down change the value there, T and N toggle tone and noise, Insert and Delete
 * add and remove a frame. The pure maths is in curve.ts.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOCKS, noteName, period } from '../../../core/sfxDoc';
import { themeVar, useThemeVersion, withAlpha } from '../theme';
import * as C from './curve';
import './lanes.css';

type SfxFrame = C.LaneFrame;

export const AXIS_W = 88;
const PITCH_H = 220;
const VOL_H = 96;
const ROW_H = 22; // the tone row and the noise row
const ROW_GAP = 4;
const NOISE_Y = ROW_H + ROW_GAP;
const PERIOD_Y = NOISE_Y + ROW_H + ROW_GAP;
const PERIOD_H = 64;
const NOISE_H = PERIOD_Y + PERIOD_H;
const TONE_H = ROW_H;
const RULER_H = 16;
const PAD_R = 16;
const LOOP_H = 20;

type Kind = 'pitch' | 'volume' | 'noise';

interface Gesture {
  lane: C.Lane;
  base: SfxFrame[];
  anchor: { i: number; v: number } | null;
  prev: { i: number; v: number };
  flag: boolean;
}

export interface LanesProps {
  /** The committed frames of the selected effect or instrument. */
  frames: SfxFrame[];
  /** What the frames belong to, for the canvases' accessible names. */
  name: string;
  /** 'note' (default): absolute notes; 'offset': whole semitones from the played note. */
  pitchMode?: C.PitchMode;
  /** The lanes are shown but cannot be edited (a built-in instrument). */
  readOnly?: boolean;
  /** The loop start frame (instruments); undefined or null = no loop. Shown when `onLoop` is given. */
  loop?: number | null;
  /** Set (a frame) or clear (null) the loop start. Resolves when the host has answered; never rejects. */
  onLoop?(at: number | null): void;
  cellW: number;
  range: { lo: number; hi: number };
  /** Line mode: a click or drag draws a straight line from the last point (Shift flips the mode while held). */
  mode: C.DrawMode;
  cursor: number;
  playFrame: number | null;
  onCursor(i: number): void;
  /** Replace `frames` from `start` (one undo step). Resolves when the host has answered; never rejects. */
  onCommit(start: number, frames: SfxFrame[], label: string): Promise<void>;
  onInsertFrame?(at: number): void;
  onDeleteFrame?(at: number): void;
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

export function Lanes(p: LanesProps) {
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
  const cvL = useRef<HTMLCanvasElement>(null);
  const axL = useRef<HTMLCanvasElement>(null);
  const [loopDraft, setLoopDraft] = useState<number | null | undefined>(undefined);
  const loopDragging = useRef(false);
  const offset = p.pitchMode === 'offset';
  const ro = p.readOnly === true;
  const hasLoop = p.onLoop !== undefined;
  const loopNow = loopDraft !== undefined ? loopDraft : p.loop;
  const loopAt = hasLoop && loopNow !== null && loopNow !== undefined && loopNow < n ? loopNow : -1;
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
      bg: themeVar('--vscode-sideBar-background', themeVar('--vscode-editor-background', '#1e1e1e')),
      cell: themeVar('--vscode-editor-background', '#1e1e1e'),
      fg: themeVar('--vscode-editor-foreground', '#cccccc'),
      desc: themeVar('--vscode-descriptionForeground', '#9d9d9d'),
      pitch: themeVar('--vscode-charts-blue', '#3794ff'),
      vol: themeVar('--vscode-charts-green', '#89d185'),
      noise: themeVar('--vscode-charts-orange', '#d18616'),
      play: themeVar('--cb-playhead', themeVar('--vscode-charts-green', '#89d185')),
      focus: themeVar('--vscode-focusBorder', '#007fd4'),
    };
    const fam = themeVar('--vscode-editor-font-family', 'monospace');
    const size = parseFloat(themeVar('--vscode-editor-font-size', '13')) || 13;
    const font = `${Math.max(10, Math.round(size * 0.9))}px ${fam}`;
    const fontStrong = `600 ${font}`;
    const rulerFont = `${Math.max(9, Math.round(size * 0.78))}px ${fam}`;
    const rulerStrong = `600 ${rulerFont}`;
    const grid = withAlpha(col.fg, 0.12);
    const grid2 = withAlpha(col.fg, 0.28);
    const cellFill = withAlpha(col.fg, 0.05);
    const dashed = withAlpha(col.fg, 0.4);
    const cursorFill = withAlpha(col.focus, 0.2);
    const playFill = withAlpha(col.play, 0.16);
    const loopFill = withAlpha(col.play, 0.1);
    const inset = cellW > 3 ? 1 : 0;
    const barW = Math.max(1, cellW - 2 * inset);

    const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]): void => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
    };
    /** The lane background (rounded cells, or one strip when the cells are too narrow), then the cursor and the playhead column. */
    const base = (ctx: CanvasRenderingContext2D, h: number): void => {
      ctx.clearRect(0, 0, plotW, h);
      ctx.fillStyle = cellFill;
      if (cellW >= 6) {
        for (let i = 0; i < n; i++) {
          rr(ctx, i * cellW + 0.5, 0, cellW - 1, h, 6);
          ctx.fill();
        }
      } else {
        rr(ctx, 0, 0, n * cellW, h, 6);
        ctx.fill();
      }
      if (loopAt >= 0) {
        ctx.fillStyle = loopFill;
        rr(ctx, loopAt * cellW, 0, (n - loopAt) * cellW, h, 6);
        ctx.fill();
      }
      if (p.cursor < n) {
        ctx.fillStyle = cursorFill;
        rr(ctx, p.cursor * cellW, 0, cellW, h, Math.min(6, cellW / 2));
        ctx.fill();
      }
      if (p.playFrame !== null && p.playFrame < n) {
        ctx.fillStyle = playFill;
        ctx.fillRect(p.playFrame * cellW, 0, cellW, h);
        ctx.strokeStyle = col.play;
        ctx.lineWidth = 1;
        ctx.strokeRect(p.playFrame * cellW + 0.5, 0.5, Math.max(0, cellW - 1), h - 1);
      }
    };
    const axisBase = (ctx: CanvasRenderingContext2D | null, h: number): CanvasRenderingContext2D | null => {
      if (!ctx) return null;
      ctx.clearRect(0, 0, AXIS_W, h);
      ctx.font = font;
      ctx.fillStyle = col.desc;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      return ctx;
    };
    const name = (ax: CanvasRenderingContext2D, text: string, y: number): void => {
      ax.save();
      ax.font = fontStrong;
      ax.fillStyle = col.fg;
      ax.textAlign = 'left';
      ax.fillText(text, 8, y);
      ax.restore();
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
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(n * cellW, y);
          ctx.stroke();
        }
        const bh = cellW >= 6 ? 8 : 5;
        ctx.lineWidth = 1;
        ctx.strokeStyle = col.pitch;
        ctx.fillStyle = col.pitch;
        for (let i = 0; i < n; i++) {
          const f = shown[i];
          const y = C.pitchToY(f.pitch, PITCH_H, range.lo, range.hi);
          if (i > 0) {
            ctx.globalAlpha = 0.35;
            ctx.beginPath();
            ctx.moveTo(i * cellW + 0.5, C.pitchToY(shown[i - 1].pitch, PITCH_H, range.lo, range.hi));
            ctx.lineTo(i * cellW + 0.5, y);
            ctx.stroke();
          }
          ctx.globalAlpha = f.volume === 0 || !f.tone ? 0.3 : 1;
          const x = i * cellW + (cellW >= 8 ? 3 : inset);
          const w = Math.max(1, cellW - 2 * (cellW >= 8 ? 3 : inset));
          rr(ctx, x, Math.min(PITCH_H - bh, Math.max(0, y - bh / 2)), w, bh, Math.min(4, w / 2));
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      const ax = axisBase(prep(axP.current, AXIS_W, PITCH_H), PITCH_H);
      if (ax) {
        const px = PITCH_H / (range.hi - range.lo);
        for (let m = Math.ceil(range.lo); m <= range.hi; m++) {
          const c = m % 12;
          if (offset) {
            if (!(c === 0 || px >= 11 || (px >= 5 && m % 4 === 0))) continue;
          } else if (!(c === 0 || (px >= 11) || (px >= 5 && (c === 4 || c === 7)))) continue;
          ax.fillText(offset ? C.offsetLabel(m) : noteName(m), AXIS_W - 6, C.pitchToY(m, PITCH_H, range.lo, range.hi));
        }
        name(ax, offset ? 'Pitch +/-' : 'Pitch', 10);
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
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(n * cellW, y);
          ctx.stroke();
        }
        ctx.fillStyle = col.vol;
        for (let i = 0; i < n; i++) {
          const h = Math.max(1, (shown[i].volume / 15) * VOL_H);
          rr(ctx, i * cellW + inset, VOL_H - h, barW, h, [Math.min(5, barW / 2, h), Math.min(5, barW / 2, h), 0, 0]);
          ctx.fill();
        }
      }
      const ax = axisBase(prep(axV.current, AXIS_W, VOL_H), VOL_H);
      if (ax) {
        ax.fillText('15', AXIS_W - 6, 7);
        ax.fillText('8', AXIS_W - 6, VOL_H / 2);
        ax.fillText('0', AXIS_W - 6, VOL_H - 7);
        name(ax, 'Volume', 10);
      }
    }
    // tone row, noise row and noise period lane
    {
      const ctx = prep(cvN.current, plotW, NOISE_H);
      if (ctx) {
        base(ctx, NOISE_H);
        // the gaps between the rows show the panel, not the cells
        ctx.clearRect(0, TONE_H, plotW, ROW_GAP);
        ctx.clearRect(0, NOISE_Y + ROW_H, plotW, PERIOD_Y - NOISE_Y - ROW_H);
        const row = (i: number, y: number, on: boolean, colour: string): void => {
          const x = i * cellW + inset;
          const pill = Math.min(ROW_H / 2, barW / 2);
          if (on) {
            ctx.fillStyle = colour;
            rr(ctx, x, y + 1, barW, ROW_H - 2, pill);
            ctx.fill();
          } else if (cellW > 3) {
            ctx.strokeStyle = dashed;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 2]);
            rr(ctx, x + 0.5, y + 1.5, Math.max(1, barW - 1), ROW_H - 3, pill);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        };
        for (let i = 0; i < n; i++) {
          const f = shown[i];
          row(i, 0, f.tone, col.pitch);
          row(i, NOISE_Y, f.noise, col.noise);
          const h = Math.max(1, (f.noisePeriod / 31) * PERIOD_H);
          ctx.fillStyle = col.noise;
          ctx.globalAlpha = f.noise ? 1 : 0.25;
          rr(ctx, i * cellW + inset, PERIOD_Y + PERIOD_H - h, barW, h, [Math.min(4, barW / 2, h), Math.min(4, barW / 2, h), 0, 0]);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
      const ax = axisBase(prep(axN.current, AXIS_W, NOISE_H), NOISE_H);
      if (ax) {
        name(ax, 'Tone', ROW_H / 2);
        name(ax, 'Noise', NOISE_Y + ROW_H / 2);
        name(ax, 'Noise pitch', PERIOD_Y + 8);
        ax.fillText('31', AXIS_W - 6, PERIOD_Y + 24); // below the lane name, never beside it
        ax.fillText('0', AXIS_W - 6, NOISE_H - 6);
      }
    }
    // ruler: every frame labelled when there is room, else every 2nd, 4th, 8th...; multiples of 4 are stronger
    {
      const ctx = prep(cvR.current, plotW, RULER_H);
      if (ctx) {
        ctx.clearRect(0, 0, plotW, RULER_H);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const step = [1, 2, 4, 8, 16, 32, 64].find((s) => s * cellW >= 26) ?? 64;
        for (let i = step - 1; i < n; i += step) {
          const strong = (i + 1) % 4 === 0;
          ctx.font = strong ? rulerStrong : rulerFont;
          ctx.fillStyle = strong ? col.fg : col.desc;
          ctx.fillText(String(i + 1), i * cellW + cellW / 2, RULER_H / 2 + 1);
        }
      }
      const ax = axisBase(prep(axR.current, AXIS_W, RULER_H), RULER_H);
      if (ax) name(ax, 'Frame', RULER_H / 2 + 1);
    }
    // loop band: tinted from the loop start to the end, a handle on the start; a dashed hint when there is no loop
    if (hasLoop) {
      const ctx = prep(cvL.current, plotW, LOOP_H);
      if (ctx) {
        ctx.clearRect(0, 0, plotW, LOOP_H);
        ctx.textBaseline = 'middle';
        ctx.font = fontStrong;
        if (loopAt >= 0) {
          const x0 = loopAt * cellW;
          const w = (n - loopAt) * cellW;
          ctx.fillStyle = withAlpha(col.play, 0.22);
          rr(ctx, x0, 0, w, LOOP_H, 6);
          ctx.fill();
          ctx.fillStyle = col.play;
          rr(ctx, x0, 0, Math.min(w, 12), LOOP_H, 6);
          ctx.fill();
          ctx.fillStyle = col.bg;
          ctx.textAlign = 'center';
          ctx.fillText('<', x0 + Math.min(w, 12) / 2, LOOP_H / 2 + 1);
          ctx.fillStyle = col.fg;
          ctx.textAlign = 'left';
          const label = `Loop from frame ${loopAt + 1}`;
          if (w >= 150) ctx.fillText(label, x0 + 18, LOOP_H / 2 + 1);
          else if (w >= 56) ctx.fillText(String(loopAt + 1), x0 + 18, LOOP_H / 2 + 1);
        } else {
          ctx.strokeStyle = dashed;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 2]);
          rr(ctx, 0.5, 0.5, Math.max(1, n * cellW - 1), LOOP_H - 1, 6);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = col.desc;
          ctx.textAlign = 'left';
          ctx.font = font;
          if (n * cellW >= 190) ctx.fillText('No loop: plays once and stops. Click to set one.', 10, LOOP_H / 2 + 1);
          else if (n * cellW >= 80) ctx.fillText('No loop', 10, LOOP_H / 2 + 1);
        }
      }
      const ax = axisBase(prep(axL.current, AXIS_W, LOOP_H), LOOP_H);
      if (ax) name(ax, 'Loop', LOOP_H / 2 + 1);
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
  const roundFor = (lane: C.Lane, alt: boolean) => (v: number): number => (lane === 'pitch' ? (offset ? C.clamp(Math.round(v), -C.MAX_OFFSET, C.MAX_OFFSET) + 0 : C.snapPitch(v, alt)) : lane === 'volume' ? C.clamp(Math.round(v), 0, 15) : C.clamp(Math.round(v), 0, 31));

  /** Frame index and (for numeric lanes) the lane value under the pointer. */
  const sample = (kind: Kind, lane: C.Lane | null, e: PointerEvent, cv: HTMLCanvasElement): { lane: C.Lane; i: number; v: number } => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const i = C.xToFrame(x, cellW, current().length);
    if (kind === 'pitch') return { lane: 'pitch', i, v: offset ? C.yToOffset(y, PITCH_H, range.lo, range.hi) : C.snapPitch(C.yToPitch(y, PITCH_H, range.lo, range.hi), e.altKey) };
    if (kind === 'volume') return { lane: 'volume', i, v: C.yToLevel(y, VOL_H, 15) };
    const ln: C.Lane = lane ?? (y < NOISE_Y - ROW_GAP / 2 ? 'tone' : y < PERIOD_Y - ROW_GAP / 2 ? 'noise' : 'period');
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
    if (ro) return;
    if (s.lane === 'tone' || s.lane === 'noise') {
      const flag = !base[s.i][s.lane];
      gesture.current = { lane: s.lane, base, anchor: null, prev: { i: s.i, v: 0 }, flag };
      setBoth(C.paintFlags(base, s.lane, s.i, s.i, flag));
      return;
    }
    const anchor = C.drawsLine(p.mode, e.shiftKey) ? last.current[s.lane] ?? null : null;
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
    if (ro && (k === 'ArrowUp' || k === 'ArrowDown' || k === 't' || k === 'T' || k === 'n' || k === 'N' || k === 'Insert' || k === 'Delete' || k === 'l' || k === 'L')) return;
    if (hasLoop && !e.altKey && (k === 'l' || k === 'L')) {
      e.preventDefault();
      p.onLoop?.(e.shiftKey ? null : c);
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (e.altKey && kind !== 'pitch') return;
      e.preventDefault();
      const lane = kind === 'pitch' ? 'pitch' : kind === 'volume' ? 'volume' : 'period';
      const nf = C.nudge(frames[c], lane, k === 'ArrowUp' ? 1 : -1, e.shiftKey, e.altKey, offset ? 'offset' : 'note');
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
    if (k === 'Insert' && p.onInsertFrame) {
      e.preventDefault();
      p.onInsertFrame(c);
    } else if (k === 'Delete' && p.onDeleteFrame) {
      e.preventDefault();
      p.onDeleteFrame(c);
    }
  };

  // ----------------------------------------------------------- loop band
  const loopSample = (e: PointerEvent): number => C.xToFrame(e.clientX - (e.currentTarget as HTMLCanvasElement).getBoundingClientRect().left, cellW, current().length);
  const loopDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const cv = e.currentTarget as HTMLCanvasElement;
    cv.focus();
    if (ro) return;
    cv.setPointerCapture(e.pointerId);
    loopDragging.current = true;
    setLoopDraft(loopSample(e));
  };
  const loopMove = (e: PointerEvent): void => {
    if (loopDragging.current) setLoopDraft(loopSample(e));
  };
  const loopUp = (e: PointerEvent): void => {
    if (!loopDragging.current) return;
    loopDragging.current = false;
    (e.currentTarget as HTMLCanvasElement).releasePointerCapture?.(e.pointerId);
    const at = loopSample(e);
    p.onCursor(at);
    setLoopDraft(undefined);
    if (at !== p.loop) p.onLoop?.(at);
  };
  const loopCancel = (): void => {
    loopDragging.current = false;
    setLoopDraft(undefined);
  };
  const loopKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || ro) return;
    const k = e.key;
    const count = current().length;
    if (k === 'Escape' && loopDragging.current) {
      e.preventDefault();
      e.stopPropagation();
      loopCancel();
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      p.onLoop?.(C.moveLoop(loopAt < 0 ? null : loopAt, k === 'ArrowLeft' ? -1 : 1, p.cursor, count));
    } else if (k === 'Home' || k === 'End') {
      e.preventDefault();
      p.onLoop?.(k === 'Home' ? 0 : count - 1);
    } else if (k === 'Delete' || k === 'Backspace' || ((k === 'l' || k === 'L') && e.shiftKey)) {
      e.preventDefault();
      p.onLoop?.(null);
    } else if (k === 'l' || k === 'L') {
      e.preventDefault();
      p.onLoop?.(Math.min(p.cursor, count - 1));
    }
  };

  // -------------------------------------------------------------- labels
  const c = Math.min(p.cursor, n - 1);
  const f = shown[c];
  const clock = CLOCKS.cpc;
  const where = `${p.name}, frame ${c + 1} of ${n}${loopAt >= 0 && c >= loopAt ? ', in the loop' : ''}`;
  const loopKeys = hasLoop && !ro ? ' L sets the loop start here, Shift+L removes the loop.' : '';
  const roNote = ro ? ' Read-only: make a copy to edit.' : '';
  const labels = {
    pitch: offset
      ? `Pitch offset curve, ${where}: ${C.offsetLabel(f.pitch)} semitones from the played note. Left and Right move between frames, Up and Down change the pitch by a semitone, Shift an octave.${loopKeys}${roNote}`
      : `Pitch curve, ${where}: ${noteName(f.pitch)} (${f.pitch.toFixed(2)}), tone period ${period(f.pitch, clock)}. Left and Right move between frames, Up and Down change the pitch, Shift an octave, Alt a tenth of a semitone.`,
    volume: `Volume bars, ${where}: volume ${f.volume} of 15. Left and Right move between frames, Up and Down change the volume, Shift by 4.${loopKeys}${roNote}`,
    noise: `Tone, noise and noise period, ${where}: tone ${f.tone ? 'on' : 'off'}, noise ${f.noise ? 'on' : 'off'}, noise period ${f.noisePeriod}. T toggles tone, N toggles noise, Up and Down change the noise period.${loopKeys}${roNote}`,
  };
  const props = (kind: Kind, cv: preact.RefObject<HTMLCanvasElement | null>) => ({
    ref: cv,
    tabIndex: 0,
    role: 'application' as const,
    'aria-label': labels[kind],
    class: ro ? 'ln-canvas ln-disabled' : 'ln-canvas',
    onPointerDown: down(kind) as never,
    onPointerMove: move(kind) as never,
    onPointerUp: up as never,
    onPointerCancel: cancel,
    onKeyDown: key(kind) as never,
  });

  return (
    <div class="ln-panel">
      <div class="ln-axes" style={{ width: `${AXIS_W}px` }} aria-hidden="true">
        <canvas ref={axR} />
        {hasLoop && <canvas ref={axL} />}
        <canvas ref={axP} />
        <canvas ref={axV} />
        <canvas ref={axN} />
      </div>
      <div class="ln-scroll" ref={scroll}>
        <canvas ref={cvR} aria-hidden="true" />
        {hasLoop && (
          <canvas
            ref={cvL}
            tabIndex={0}
            role="slider"
            class={ro ? 'ln-canvas ln-loop ln-disabled' : 'ln-canvas ln-loop'}
            aria-label={`Loop start, ${p.name}`}
            aria-valuemin={1}
            aria-valuemax={n}
            aria-valuenow={loopAt >= 0 ? loopAt + 1 : undefined}
            aria-valuetext={loopAt >= 0 ? `Loop starts at frame ${loopAt + 1} and runs to frame ${n}` : 'No loop: plays once and stops'}
            aria-description={ro ? 'Read-only: make a copy to edit.' : 'Left and Right move the start, L sets it at the cursor frame, Shift+L or Delete removes the loop.'}
            onPointerDown={loopDown as never}
            onPointerMove={loopMove as never}
            onPointerUp={loopUp as never}
            onPointerCancel={loopCancel}
            onKeyDown={loopKey as never}
          />
        )}
        <canvas {...props('pitch', cvP)} />
        <canvas {...props('volume', cvV)} />
        <canvas {...props('noise', cvN)} />
      </div>
    </div>
  );
}
