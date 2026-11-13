/**
 * sfxBuild.ts -- the pure parts of building a .cpcsfx bank: the names of the files written beside it,
 * the stale check, the CONST lines added to the generated include, the Insert Asset Use text and the
 * silent song the emulator preview plays (effects only sound while a song runs).
 *
 * Naming follows games/shooter/build_assets.sh: `sfx.vt2` -> `sfx.bas` for the CPC and `sfx_zx.vt2` ->
 * `sfx_zx.bas` for the Spectrum; both define the same label (the sanitised stem), so the BASIC that
 * plays the effects is the same on both machines and only the #include differs.
 *
 * No vscode or node imports.
 */
import { sanitizeName } from './aks2bas';
import { matchesAny } from './glob';
import type { SfxDoc, SfxTarget } from './sfxDoc';

export interface SfxOutput {
  target: SfxTarget;
  /** The Vortex Tracker module written for the converter (project-relative, like the input). */
  vt2: string;
  /** The CPC BASIC include the converter writes. */
  bas: string;
}

/** The label of the bank: the file stem, made usable as a BASIC name (`sfx`). */
export function sfxBankName(rel: string): string {
  const stem = rel.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return sanitizeName(stem);
}

/** Where a bank's generated files go: beside it, `<stem>` for the CPC and `<stem>_zx` for the Spectrum. */
export function sfxOutputs(rel: string, targets: readonly SfxTarget[]): SfxOutput[] {
  const stem = rel.replace(/\.[^./\\]*$/, '');
  return [...new Set(targets)].map((target) => {
    const base = target === 'cpc' ? stem : `${stem}_zx`;
    return { target, vt2: `${base}.vt2`, bas: `${base}.bas` };
  });
}

/** The PSG targets a project's build targets need: CPC targets -> cpc, Spectrum (zx48k) targets -> spectrum. */
export function sfxTargetsOf(archs: readonly string[]): SfxTarget[] {
  const out: SfxTarget[] = [];
  if (archs.some((a) => a === 'cpc')) out.push('cpc');
  if (archs.some((a) => a !== 'cpc')) out.push('spectrum');
  return out.length ? out : ['cpc'];
}

/** Stale: some output is missing (a negative time), or the bank is newer than the oldest output. */
export function sfxStale(sourceTime: number, outputTimes: readonly number[]): boolean {
  if (!outputTimes.length || outputTimes.some((t) => t < 0)) return true;
  return sourceTime > Math.min(...outputTimes);
}

/** `SFX_JUMP`: the constant of an effect, bank and effect name in upper case. */
export function sfxConstName(bank: string, effect: string): string {
  return `${bank}_${effect}`.toUpperCase();
}

/** One `CONST <BANK>_<NAME> AS UBYTE = <n>` line per effect, n from 1 (the number SfxPlay takes). */
export function sfxConstants(doc: SfxDoc, bank: string): string[] {
  return doc.effects.map((e, i) => `CONST ${sfxConstName(bank, e.name)} AS UBYTE = ${i + 1}`);
}

/**
 * The generated include with the constants added right after its `#define` guard, where (as in the
 * include of a bank image) the BASIC after the #include can use them. Throws when the text has no guard.
 */
export function withSfxConstants(bas: string, doc: SfxDoc, bank: string): string {
  const m = /^#define __AKS_\w+__[ \t]*$/m.exec(bas);
  if (!m) throw new Error('the converted include has no #define guard to put the effect constants after');
  const at = m.index + m[0].length;
  const block = ['', "' Effect numbers for SfxPlay, from the .cpcsfx (added by CPC Game Studio):", ...sfxConstants(doc, bank)].join('\n');
  return bas.slice(0, at) + '\n' + block + bas.slice(at);
}

/** What Insert Asset Use copies when no code editor is visible: the includes, SfxInit and a SfxPlay of `effect` (library.md 9.9). */
export function sfxUseSnippet(doc: SfxDoc, bank: string, rel: string, effect = 0): string {
  const e = doc.effects[effect] ?? doc.effects[0];
  const first = e ? sfxConstName(bank, e.name) : '1';
  return (
    `#include <music/music.bas>\n#include <music/quiet.bas>    ' an empty song, for a program with no music\n#include "${rel}"\n` +
    `MusicInit(@quiet, 0)    ' effects only advance while a song plays (or start your own song instead)\n` +
    `SfxInit(@${bank})\n` +
    `SfxPlay(${first}, 2, 0)    ' effect, channel 0-2 (A, B, C), inverted volume 0 (full) to 16 (mute)\n`
  );
}

const SILENT = '... +000_ +00_ 0_ L';

/** An empty song (the same as examples/assets/bounce_quiet.vt2) for the preview: the player must run for effects to sound. */
export function quietSongVt2(): string {
  let out = '[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=quiet\nAuthor=cpcbuild\nNoteTable=1\nChipFreq=1000000\nSpeed=8\nNoise=HEX\nPlayOrder=L0\n\n[Ornament1]\nL0\n\n';
  out += '[Sample1]\nT.. +000_ +00_ 0_ L\n\n';
  for (let n = 2; n <= 31; n++) out += `[Sample${n}]\n${SILENT}\n\n`;
  return out + '[Pattern0]\n' + Array(8).fill('....|..|--- .... ....|--- .... ....|--- .... ....').join('\n') + '\n';
}

export const SFX_GLOB = 'assets/**/*.cpcsfx';

/**
 * cpcbuild.json's text with SFX_GLOB added to "assets" when no glob there matches `rel` (project-relative),
 * so a new bank is converted on build; undefined when nothing needs to change or the file is not an object.
 */
export function withSfxGlob(projectJson: string, rel: string): string | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(projectJson);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const assets = Array.isArray(o.assets) ? o.assets.filter((a): a is string => typeof a === 'string') : [];
  if (matchesAny(assets, rel)) return undefined;
  o.assets = [...assets, SFX_GLOB];
  return JSON.stringify(o, null, 2) + '\n';
}

/** One insertion into the code: before `line` (0-based; `col` 0) or, for the call, at the cursor. */
export interface SfxEdit {
  line: number;
  col: number;
  text: string;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Insert Asset Use for a bank into code that may already use it: the includes and the init lines go once,
 * below the last top-level #include (or below the opening comment block when there is none), and only
 * what is missing; the SfxPlay of `effect` goes at the cursor. A program that already starts a song
 * (any MusicInit) gets no quiet song. `rel` is the bank's include as the code file sees it.
 */
export function sfxUseEdits(code: string, doc: SfxDoc, bank: string, rel: string, effect: number, cursor: { line: number; col: number }): SfxEdit[] {
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const has = (re: RegExp): boolean => lines.some((l) => re.test(l.replace(/'.*$/, '')));
  const base = rel.replace(/^.*\//, '');
  const head: string[] = [];
  if (!has(/^\s*#include\s*<music\/music\.bas>/i)) head.push('#include <music/music.bas>');
  const song = has(/\bMusicInit(Bank)?\s*\(/i) || has(/^\s*#include\s*<music\/quiet\.bas>/i);
  if (!song) head.push("#include <music/quiet.bas>    ' an empty song, for a program with no music");
  if (!has(new RegExp(`^\\s*#include\\s*"(?:[^"]*/)?${esc(base)}"`, 'i'))) head.push(`#include "${rel}"`);
  if (!has(/\bMusicInit(Bank)?\s*\(/i)) head.push("MusicInit(@quiet, 0)    ' effects only advance while a song plays (or start your own song instead)");
  if (!has(new RegExp(`\\bSfxInit\\s*\\(\\s*@${esc(bank)}\\s*\\)`, 'i'))) {
    head.push(`SfxInit(@${bank})`);
    head.push("' SfxPlay(effect, channel 0-2 (A, B, C), inverted volume 0 (full) to 16 (mute))");
  }
  const edits: SfxEdit[] = [];
  if (head.length) {
    let at = -1;
    lines.forEach((l, i) => { if (/^#include\b/i.test(l)) at = i; });
    if (at < 0) while (at + 1 < lines.length && /^\s*'/.test(lines[at + 1])) at++;
    edits.push({ line: at + 1, col: 0, text: head.join('\n') + '\n' });
  }
  const e = doc.effects[effect] ?? doc.effects[0];
  const n = e ? sfxConstName(bank, e.name) : '1';
  edits.push({ line: cursor.line, col: cursor.col, text: `SfxPlay(${n}, 2, 0)` });
  return edits;
}

/**
 * The line a failed build adds when zxbc reports a sound call as undeclared (the program calls SfxPlay,
 * MusicInit, ... without the music library): what is missing and how Studio adds it. Undefined otherwise.
 */
export function soundSetupHint(compilerOutput: string): string | undefined {
  const m = /Undeclared (?:function|sub) "(Sfx(?:Play|Init|Stop)|Music(?:Init|InitBank|Frame|Stop))"/i.exec(compilerOutput);
  if (!m) return undefined;
  return (
    `${m[1]} is in the sound library, which this program does not include. Open your .cpcsfx bank, put the cursor in your .bas ` +
    `and click "Insert in code": it adds #include <music/music.bas>, the bank's include, MusicInit and SfxInit (once, below your #include lines).`
  );
}
