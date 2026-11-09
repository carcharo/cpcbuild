/**
 * instLogic.ts -- the pure helpers of the instrument editor: lengths and times, usage counts, the next free
 * id, frame edits that keep the loop valid, and the loop field's text. No DOM, no Preact.
 */
import { CUSTOM_IDS, MAX_FRAMES, type SongDoc, type SongFrame, type SongInstrument } from '../../core/songDoc';
import type { InstrumentPatch } from '../../core/songOps';

/** One tick is one 50 Hz frame. */
export const TICK_MS = 20;

/** "16 ticks = 320 ms at 50 Hz". */
export function durationLabel(frames: number): string {
  return `${frames} tick${frames === 1 ? '' : 's'} = ${frames * TICK_MS} ms at 50 Hz`;
}

/** What happens after the last frame: "Plays once, then stops" or "Loops from tick 9 to tick 16" (ticks count from 1). */
export function loopSummary(inst: Pick<SongInstrument, 'frames' | 'loop'>): string {
  if (inst.loop === undefined) return 'Plays once, then stops';
  return inst.loop >= inst.frames.length - 1 ? `Holds tick ${inst.frames.length}` : `Loops from tick ${inst.loop + 1} to tick ${inst.frames.length}`;
}

/** The id a new custom instrument gets (the first free one of B-V), or undefined when all 21 are taken. */
export function nextCustomId(instruments: readonly Pick<SongInstrument, 'id'>[]): string | undefined {
  const used = new Set(instruments.map((i) => i.id));
  return [...CUSTOM_IDS].find((c) => !used.has(c));
}

/** How many notes use an instrument and in how many patterns. */
export function instrumentUsage(doc: SongDoc, id: string): { notes: number; patterns: number } {
  let notes = 0;
  let patterns = 0;
  for (const p of doc.patterns) {
    let here = 0;
    for (const ch of p.channels) for (const e of ch) if (e.note !== 'off' && e.inst === id) here++;
    notes += here;
    if (here) patterns++;
  }
  return { notes, patterns };
}

/** "used 12 times in 2 patterns" / "not used yet". */
export function usageLabel(u: { notes: number; patterns: number }): string {
  if (!u.notes) return 'not used yet';
  return `used ${u.notes} time${u.notes === 1 ? '' : 's'} in ${u.patterns} pattern${u.patterns === 1 ? '' : 's'}`;
}

/** The frames with `slice` written from `start` (the lanes send the changed run only). */
export function replaceFrames(frames: readonly SongFrame[], start: number, slice: readonly SongFrame[]): SongFrame[] {
  const out = frames.map((f) => ({ ...f }));
  slice.forEach((f, k) => {
    if (start + k < out.length) out[start + k] = { ...f };
  });
  return out;
}

/** A frame inserted after `at` (a copy of it), or undefined at the 128-frame limit. The loop start moves with its frame. */
export function insertFramePatch(inst: Pick<SongInstrument, 'frames' | 'loop'>, at: number): InstrumentPatch | undefined {
  if (inst.frames.length >= MAX_FRAMES || at < 0 || at >= inst.frames.length) return undefined;
  const frames = [...inst.frames.slice(0, at + 1), { ...inst.frames[at] }, ...inst.frames.slice(at + 1)];
  const patch: InstrumentPatch = { frames };
  if (inst.loop !== undefined && inst.loop > at) patch.loop = inst.loop + 1;
  return patch;
}

/** Frame `at` removed, or undefined when it is the only one. The loop start moves with its frame and goes when it was removed past the end. */
export function deleteFramePatch(inst: Pick<SongInstrument, 'frames' | 'loop'>, at: number): InstrumentPatch | undefined {
  if (inst.frames.length <= 1 || at < 0 || at >= inst.frames.length) return undefined;
  const frames = inst.frames.filter((_, k) => k !== at);
  const patch: InstrumentPatch = { frames };
  if (inst.loop !== undefined) {
    const l = inst.loop > at ? inst.loop - 1 : inst.loop;
    patch.loop = l >= frames.length ? null : l;
  }
  return patch;
}

/** A new length: longer repeats the last frame, shorter cuts the end (a loop that no longer fits is removed). */
export function resizePatch(inst: Pick<SongInstrument, 'frames' | 'loop'>, n: number): InstrumentPatch | undefined {
  if (!Number.isInteger(n) || n < 1 || n > MAX_FRAMES || n === inst.frames.length) return undefined;
  const last = inst.frames[inst.frames.length - 1];
  const frames = n < inst.frames.length ? inst.frames.slice(0, n) : [...inst.frames, ...Array.from({ length: n - inst.frames.length }, () => ({ ...last }))];
  const patch: InstrumentPatch = { frames };
  if (inst.loop !== undefined && inst.loop >= n) patch.loop = null;
  return patch;
}

/** The loop field's text: "" or "none" removes the loop, a number 1..length (counted from 1) sets its start. */
export function parseLoopText(text: string, length: number): { loop: number | null } | { error: string } {
  const t = text.trim().toLowerCase();
  if (t === '' || t === 'none') return { loop: null };
  const n = Number(t);
  if (!Number.isInteger(n)) return { error: 'Enter a tick number, or none' };
  if (n < 1 || n > length) return { error: `Enter a tick from 1 to ${length}, or none` };
  return { loop: n - 1 };
}

/** The loop start as the field shows it (counted from 1), "none" when there is no loop. */
export const loopText = (loop: number | undefined): string => (loop === undefined ? 'none' : String(loop + 1));

/** Why a name is refused, or undefined. */
export function instrumentNameProblem(text: string, max = 24): string | undefined {
  if (text.trim() === '') return 'Give the instrument a name';
  if (text.length > max) return `At most ${max} characters`;
  return undefined;
}
