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
import { CLOCKS, MAX_EFFECTS, MAX_FRAMES, SfxDoc, SfxEffect, SfxFrame, nameProblem, period } from './sfxDoc';
import { CHANNELS, MAX_SONG_INSTRUMENTS, MAX_SONG_ORNAMENTS, SongDoc, SongEvent, SongInstrument, describeSongError, songNoteName, usedInstrumentIds, validateSong } from './songDoc';
import { instrumentOf } from './songInstruments';

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
export function vt2Problems(doc: SfxDoc): string[] {
  const out: string[] = [];
  const clock = CLOCKS.cpc;
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

/** The .vt2 text of a bank (at the CPC's PSG clock). Throws Vt2Error with the first problem. */
export function sfxToVt2(doc: SfxDoc, bank = 'sfx'): string {
  const problems = vt2Problems(doc);
  if (problems.length) throw new Vt2Error(problems[0]);
  const clock = CLOCKS.cpc;
  let out = header(bank, clock) + '[Ornament1]\nL0\n\n';
  doc.effects.forEach((e, i) => {
    out += `[Sample${i + 1}]\n${[...sampleLines(e, clock), END_LINE].join('\n')}\n\n`;
  });
  for (let n = doc.effects.length + 1; n <= SAMPLES; n++) out += `[Sample${n}]\n${END_LINE}\n\n`;
  const rows = doc.effects.map((_, i) => `....|..|C-4 ${i + 1}F0F ....|--- .... ....|--- .... ....`);
  return out + '[Pattern0]\n' + rows.join('\n') + '\n';
}

// ------------------------------------------------------------------------- songs (.cpcsong)
//
// The rules are those measured with SongToAkg 3.7 (cpcbuild-dev/docs/sound-s2-measurements.md, "Rules for songToVt2").

/** Cell digit of a sample: 1-9, then J..V for 10-22 (the converter reads a letter as letter - 'A' + 1). */
export function sampleDigit(n: number): string {
  return n <= 9 ? String(n) : String.fromCharCode(65 + n - 1);
}

interface SongPlan {
  /** Instruments in sample order (sample 1 first). */
  instruments: SongInstrument[];
  /** Instrument id -> ornament number 1-15 (absent: none). */
  ornamentOf: Map<string, number>;
  /** Ornament definitions in number order: the values and the `L` position. */
  ornaments: { values: number[]; loop: number }[];
}

function ornamentKey(i: SongInstrument): { values: number[]; loop: number } | undefined {
  const values = i.frames.map((f) => f.pitch);
  if (!values.some((v) => v !== 0)) return undefined;
  return { values, loop: i.loop ?? values.length - 1 };
}

/** Sample and ornament numbers of a valid song (first use order). Instruments / ornaments beyond the limits are still listed. */
function planSong(doc: SongDoc): SongPlan {
  const instruments = usedInstrumentIds(doc).map((id) => instrumentOf(doc, id)).filter((i): i is SongInstrument => !!i);
  const ornamentOf = new Map<string, number>();
  const ornaments: SongPlan['ornaments'] = [];
  const byKey = new Map<string, number>();
  for (const i of instruments) {
    const o = ornamentKey(i);
    if (!o) continue;
    const key = `${o.values.join(',')}|${o.loop}`;
    let n = byKey.get(key);
    if (n === undefined) {
      ornaments.push(o);
      n = ornaments.length;
      byKey.set(key, n);
    }
    ornamentOf.set(i.id, n);
  }
  return { instruments, ornamentOf, ornaments };
}

/** Problems that stop the song writer, first one first: the document's own errors, then the converter's limits (22 instruments, 15 ornaments). Never throws. */
export function songProblems(doc: unknown): string[] {
  const errs = validateSong(doc);
  if (errs.length) return errs.map(describeSongError);
  const plan = planSong(doc as SongDoc);
  const out: string[] = [];
  if (plan.instruments.length > MAX_SONG_INSTRUMENTS) {
    out.push(`the song uses ${plan.instruments.length} different instruments, but the converter reaches ${MAX_SONG_INSTRUMENTS}: ${plan.instruments.slice(MAX_SONG_INSTRUMENTS).map((i) => `${i.id} (${i.name})`).join(', ')} would be left out`);
  }
  if (plan.ornaments.length > MAX_SONG_ORNAMENTS) {
    out.push(`the song uses ${plan.ornaments.length} different pitch shapes (instruments that change pitch while they play, such as Chord, Bell or Kick), but the converter reaches ${MAX_SONG_ORNAMENTS}`);
  }
  return out;
}

const hex1 = (v: number): string => v.toString(16).toUpperCase();

function songSampleLines(i: SongInstrument): string[] {
  const lines = i.frames.map((f, k) => `${f.tone ? 'T' : '.'}${f.noise ? 'N' : '.'}. +000_ +${hex(f.noise ? f.noisePeriod : 0, 2)}_ ${hex1(f.volume)}_${i.loop === k ? ' L' : ''}`);
  if (i.loop === undefined) lines.push(END_LINE);
  return lines;
}

function ornamentLine(o: { values: number[]; loop: number }): string {
  return o.values.map((v, k) => `${k === o.loop ? 'L' : ''}${v}`).join(',');
}

function songCell(e: SongEvent | undefined, plan: SongPlan, vol: { cur: number | undefined }): string {
  if (!e) return '... .... ....';
  if (e.note === 'off') return 'R-- .... ....';
  const sample = plan.instruments.findIndex((i) => i.id === e.inst) + 1;
  const orn = plan.ornamentOf.get(e.inst ?? '') ?? 0;
  const v = e.vol ?? 15;
  const vd = v === vol.cur ? '.' : hex1(v);
  vol.cur = v;
  return `${songNoteName(e.note)} ${sampleDigit(sample)}F${hex1(orn)}${vd} ....`;
}

/**
 * The .vt2 text of a song for the converter. Throws Vt2Error with the first problem (see songProblems).
 * `title` goes in the header (line breaks removed).
 */
export function songToVt2(doc: SongDoc, title = 'song'): string {
  const problems = songProblems(doc);
  if (problems.length) throw new Vt2Error(problems[0]);
  const plan = planSong(doc);
  const order = doc.order.map((p, k) => `${k === (doc.loop ?? 0) ? 'L' : ''}${p}`).join(',');
  let out = `[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=${title.replace(/[\r\n]+/g, ' ')}\nAuthor=cpcbuild\nNoteTable=1\nChipFreq=1000000\nSpeed=${doc.speed}\nNoise=HEX\nPlayOrder=${order}\n\n`;
  out += plan.ornaments.length ? '' : '[Ornament1]\nL0\n\n';
  plan.ornaments.forEach((o, k) => {
    out += `[Ornament${k + 1}]\n${ornamentLine(o)}\n\n`;
  });
  for (let n = 1; n <= SAMPLES; n++) {
    const i = plan.instruments[n - 1];
    out += `[Sample${n}]\n${i ? songSampleLines(i).join('\n') : END_LINE}\n\n`;
  }
  doc.patterns.forEach((p, pi) => {
    const vols = Array.from({ length: CHANNELS }, () => ({ cur: undefined as number | undefined }));
    const at = p.channels.map((ch) => new Map(ch.map((e) => [e.row, e])));
    const rows: string[] = [];
    for (let r = 0; r < p.rows; r++) rows.push('....|..|' + at.map((m, c) => songCell(m.get(r), plan, vols[c])).join('|'));
    out += `[Pattern${pi}]\n${rows.join('\n')}\n\n`;
  });
  return out.replace(/\n+$/, '\n');
}
