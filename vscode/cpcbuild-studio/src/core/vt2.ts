/**
 * vt2.ts -- a sound-effects bank as an Arkos / Vortex Tracker II text module (.vt2).
 *
 * Pure TypeScript. SongToSoundEffects reads the module and stores, per frame, the absolute tone
 * period (the pattern note's period plus the sample line's offset), noise period, mixer and
 * volume. Every effect is a sample played at C-4, so offset = period(pitch) - period(C-4) at the
 * target's PSG clock. The format and its limits are those measured with Arkos Tracker 3.7 (see
 * examples/assets/make_bounce_aks.py, which writes the same layout).
 *
 * Shared by the sound-effects editor (S1) and the music tools.
 */
import { CLOCKS, MAX_EFFECTS, MAX_FRAMES, SfxDoc, SfxEffect, SfxFrame, SfxTarget, nameProblem, period } from './sfxDoc';

export const BASE_NOTE = 60; // C-4: the pattern note every effect is played at
const MAX_OFFSET = 0xfff;
const SAMPLES = 31; // the importer wants all of them to exist

export class Vt2Error extends Error {}

const hex = (v: number, digits: number): string => v.toString(16).toUpperCase().padStart(digits, '0');

/** One sample line of a frame, e.g. `T.. +0A3_ +00_ F_`. Throws Vt2Error when the offset does not fit. */
export function frameLine(f: SfxFrame, clock: number, where = 'frame'): string {
  const off = period(f.pitch, clock) - period(BASE_NOTE, clock);
  if (!Number.isFinite(off) || Math.abs(off) > MAX_OFFSET) throw new Vt2Error(`${where}: tone offset ${off} does not fit +-${MAX_OFFSET.toString(16).toUpperCase()}`);
  return `${f.tone ? 'T' : '.'}${f.noise ? 'N' : '.'}. ${off < 0 ? '-' : '+'}${hex(Math.abs(off), 3)}_ +${hex(f.noisePeriod, 2)}_ ${hex(f.volume, 1)}_`;
}

const END_LINE = '... +000_ +00_ 0_ L';

function sampleLines(e: SfxEffect, clock: number): string[] {
  return e.frames.map((f, i) => frameLine(f, clock, `effect "${e.name}", frame ${i + 1}`));
}

/** Problems that stop the writer, first one first; empty when the bank can be written. */
export function vt2Problems(doc: SfxDoc, target: SfxTarget): string[] {
  const out: string[] = [];
  const clock = CLOCKS[target];
  if (doc.effects.length < 1 || doc.effects.length > MAX_EFFECTS) out.push(`a bank has 1-${MAX_EFFECTS} effects, not ${doc.effects.length}`);
  const names = new Map<string, number>();
  const bodies: (string[] | undefined)[] = [];
  doc.effects.forEach((e, i) => {
    const np = nameProblem(e.name);
    if (np) out.push(`effect ${i + 1}: ${np}`);
    else {
      const key = e.name.toLowerCase();
      const first = names.get(key);
      if (first !== undefined) out.push(`effects "${doc.effects[first].name}" and "${e.name}" have the same name`);
      else names.set(key, i);
    }
    if (e.frames.length < 1 || e.frames.length > MAX_FRAMES) out.push(`effect "${e.name}": ${e.frames.length} frames, but an effect has 1-${MAX_FRAMES}`);
    try {
      bodies.push(sampleLines(e, clock));
    } catch (err) {
      out.push((err as Error).message);
      bodies.push(undefined);
    }
  });
  // the importer merges identical samples, which would shift every later index
  const seen = new Map<string, number>();
  bodies.forEach((b, i) => {
    if (!b) return;
    const key = b.join('\n');
    const first = seen.get(key);
    if (first !== undefined) out.push(`effects "${doc.effects[first].name}" and "${doc.effects[i].name}" are identical; the converter would merge them`);
    else seen.set(key, i);
  });
  return out;
}

function header(title: string, clock: number): string {
  return `[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=${title}\nAuthor=cpcbuild\nNoteTable=1\nChipFreq=${clock}\nSpeed=6\nNoise=HEX\nPlayOrder=L0\n\n`;
}

/** The .vt2 text of a bank for a target's PSG clock. Throws Vt2Error with the first problem. */
export function sfxToVt2(doc: SfxDoc, target: SfxTarget, bank = 'sfx'): string {
  const problems = vt2Problems(doc, target);
  if (problems.length) throw new Vt2Error(problems[0]);
  const clock = CLOCKS[target];
  let out = header(bank, clock) + '[Ornament1]\nL0\n\n';
  doc.effects.forEach((e, i) => {
    out += `[Sample${i + 1}]\n${[...sampleLines(e, clock), END_LINE].join('\n')}\n\n`;
  });
  for (let n = doc.effects.length + 1; n <= SAMPLES; n++) out += `[Sample${n}]\n${END_LINE}\n\n`;
  const rows = doc.effects.map((_, i) => `....|..|C-4 ${i + 1}F0F ....|--- .... ....|--- .... ....`);
  return out + '[Pattern0]\n' + rows.join('\n') + '\n';
}
