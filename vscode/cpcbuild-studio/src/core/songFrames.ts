/**
 * songFrames.ts -- the AY register state of a song for every 50 Hz tick, for the in-editor player. Pure.
 * Playback model (what the AKG player does, as far as measured in sound-s2-measurements.md):
 *   - a note restarts its instrument at frame 0 on its channel; each tick advances the frame; past the
 *     last frame the instrument jumps to its `loop` frame, or (no loop) the channel goes silent;
 *   - period = period(note + frame pitch) at the CPC clock (sfxDoc's helper, the same formula as ay.ts);
 *   - volume = max(0, frame volume - (15 - cell volume)); a note without `vol` has cell volume 15,
 *     exactly as songToVt2 writes it (V is written on every note whose volume differs from the last);
 *   - a note-off silences the channel until its next note;
 *   - the shared noise period is taken from the last channel (C, then B, then A) whose sounding frame
 *     has noise on (our choice; the player's behaviour is unmeasured), and held when none has.
 */
import { CLOCKS, period } from './sfxDoc';
import { CHANNELS, type SongDoc, type SongInstrument } from './songDoc';
import { instrumentOf } from './songInstruments';

export interface ChannelRegs {
  period: number;
  tone: boolean;
  noise: boolean;
  /** 0-15 */
  volume: number;
}

export interface TickRegs {
  a: ChannelRegs;
  b: ChannelRegs;
  c: ChannelRegs;
  noisePeriod: number;
}

export interface RowAt {
  /** Index into the song's order. */
  step: number;
  pattern: number;
  row: number;
}

export interface SongFrames {
  ticks: TickRegs[];
  /** rowAt[tick]: where in the song that tick sits. */
  rowAt: RowAt[];
  /** First tick of the loop step, or -1 when the song never reaches it (cut off by maxTicks). */
  loopTick: number;
}

export interface SongFramesOpts {
  startStep?: number;
  startRow?: number;
  /** Guard against huge songs; default 20 minutes of ticks. */
  maxTicks?: number;
}

export const DEFAULT_MAX_TICKS = 20 * 60 * 50;

interface Voice {
  inst: SongInstrument | undefined;
  note: number;
  frame: number;
  active: boolean;
  vol: number;
}

/** The row a tick belongs to; undefined when out of range. */
export function rowOfTick(f: SongFrames, tick: number): RowAt | undefined {
  return f.rowAt[tick];
}

/** The AY register state of every tick of the song, played through its order once (see the file comment). */
export function songToFrames(doc: SongDoc, opts: SongFramesOpts = {}): SongFrames {
  const maxTicks = opts.maxTicks ?? DEFAULT_MAX_TICKS;
  const order = doc.order;
  const ticks: TickRegs[] = [];
  const rowAt: RowAt[] = [];
  if (!order.length || !doc.patterns.length) return { ticks, rowAt, loopTick: -1 };
  const startStep = Math.min(order.length - 1, Math.max(0, opts.startStep ?? 0));
  const loopStep = Math.min(order.length - 1, Math.max(0, doc.loop ?? 0));
  const speed = Math.max(1, doc.speed | 0);

  // Steps to play: from the start to the end; when the loop point is before the start, also loop..end
  // once, so the loop jump lands on ticks that exist.
  const steps: number[] = [];
  for (let s = startStep; s < order.length; s++) steps.push(s);
  const loopAt = loopStep >= startStep ? loopStep - startStep : steps.length;
  if (loopStep < startStep) for (let s = loopStep; s < order.length; s++) steps.push(s);

  const voices: Voice[] = Array.from({ length: CHANNELS }, () => ({ inst: undefined, note: 0, frame: 0, active: false, vol: 15 }));
  let noisePeriod = 0;
  let loopTick = -1;
  const regsOf = (v: Voice): ChannelRegs & { noiseOn: boolean } => {
    const f = v.active && v.inst ? v.inst.frames[v.frame] : undefined;
    if (!f) return { period: 0, tone: false, noise: false, volume: 0, noiseOn: false };
    const volume = Math.max(0, f.volume - (15 - v.vol));
    return { period: period(v.note + f.pitch, CLOCKS.cpc), tone: f.tone, noise: f.noise, volume, noiseOn: f.noise };
  };
  const advance = (v: Voice): void => {
    if (!v.active || !v.inst) return;
    v.frame++;
    if (v.frame >= v.inst.frames.length) {
      const lp = v.inst.loop;
      if (lp === undefined || lp < 0 || lp >= v.inst.frames.length) v.active = false;
      else v.frame = lp;
    }
  };

  outer: for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const pi = order[step];
    const pat = doc.patterns[pi];
    if (!pat) continue;
    if (si === loopAt) loopTick = ticks.length;
    const at = pat.channels.map((ch) => new Map(ch.map((e) => [e.row, e])));
    for (let row = si === 0 ? Math.min(pat.rows - 1, Math.max(0, opts.startRow ?? 0)) : 0; row < pat.rows; row++) {
      for (let c = 0; c < CHANNELS; c++) {
        const e = at[c]?.get(row);
        if (!e) continue;
        const v = voices[c];
        if (e.note === 'off') v.active = false;
        else {
          const inst = instrumentOf(doc, e.inst);
          v.inst = inst;
          v.note = e.note;
          v.frame = 0;
          v.active = !!inst && inst.frames.length > 0;
          v.vol = Math.min(15, Math.max(0, e.vol ?? 15));
        }
      }
      for (let t = 0; t < speed; t++) {
        if (ticks.length >= maxTicks) break outer;
        const r = voices.map(regsOf);
        for (let c = 0; c < CHANNELS; c++) if (r[c].noiseOn) noisePeriod = voices[c].inst!.frames[voices[c].frame].noisePeriod;
        ticks.push({ a: strip(r[0]), b: strip(r[1]), c: strip(r[2]), noisePeriod });
        rowAt.push({ step, pattern: pi, row });
        voices.forEach(advance);
      }
    }
  }
  return { ticks, rowAt, loopTick };
}

function strip(r: ChannelRegs & { noiseOn: boolean }): ChannelRegs {
  return { period: r.period, tone: r.tone, noise: r.noise, volume: r.volume };
}
