/**
 * arkos.ts -- converting Arkos Tracker songs and effect banks to Boriel includes by running
 * tools/aks2bas.py, exactly as games/shooter/build_assets.sh does (so the output is the script's
 * own). Also the preview program that plays a song through the real player. No vscode import.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { insideRoot, PathEscapeError } from '../core/paths';
import { parseAddress } from '../core/project';
import { runTool, type CancelToken, type Sink } from './runTool';

export const ARKOS_MISSING =
  'The Arkos command-line tools were not found. Run `sh tools/arkos/fetch.sh` in the cpcbuild checkout (on macOS it also re-signs the downloaded tools, which otherwise hang), or set "cpcbuild.arkos.toolsPath".';

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The folder holding SongToAkg and SongToSoundEffects: the setting, $AT3_TOOLS, then <library>/tools/arkos/work/bin. */
export function findArkosTools(o: { setting?: string; env?: string; library?: string; base?: string }): string | undefined {
  const cands: string[] = [];
  if (o.setting?.trim()) cands.push(path.resolve(o.base ?? '.', o.setting.trim()));
  if (o.env) cands.push(o.env);
  if (o.library) cands.push(path.join(o.library, 'tools', 'arkos', 'work', 'bin'));
  return cands.find((d) => isDir(d) && fs.existsSync(path.join(d, 'SongToAkg')) && fs.existsSync(path.join(d, 'SongToSoundEffects')));
}

export interface MusicConvertOptions {
  /** BASIC label / include name (the tool prefixes its labels with it). */
  name?: string;
  /** An effect bank (`--sfx`). */
  sfx?: boolean;
  /** `--subsongs`: 1-based, comma separated. */
  subsongs?: string;
  /** `--psg`: the sound chip clock (effect banks bake it in). */
  psg?: 'cpc' | 'spectrum';
  /** `--at`: a song for a 6128 RAM bank, linked for that address. */
  at?: string;
  /** `--bin`: with `at`, also write the raw bytes here (project-relative). */
  bin?: string;
  /** Project-relative output; default: beside the input, same stem, .bas. */
  output?: string;
}

/** A label the include can use: letters, digits and underscores, not starting with a digit. */
export function songName(stemOrName: string): string {
  const s = stemOrName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9_]/g, '_');
  return !s || /^\d/.test(s) ? 'song_' + s : s;
}

export function defaultMusicOutput(inputRel: string): string {
  return inputRel.replace(/\.[^./]+$/, '') + '.bas';
}

/** The problem with these options, as the tool would say it, or undefined. */
export function checkMusicOptions(o: MusicConvertOptions): string | undefined {
  if (o.name !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(o.name)) return `"${o.name}" is not a usable name: use letters, digits and underscores, not starting with a digit.`;
  if (o.subsongs !== undefined && !/^\d+(\s*,\s*\d+)*$/.test(o.subsongs)) return `--subsongs takes numbers separated by commas, e.g. 1,3 (found "${o.subsongs}").`;
  if (o.at !== undefined) {
    if (o.sfx) return '--at is for songs, not effect banks.';
    if (parseAddress(o.at) === undefined) return `--at takes an address such as 0x4000 (found "${o.at}").`;
  }
  if (o.bin !== undefined && o.at === undefined) return '--bin goes with --at (it writes the song image for a RAM bank).';
  if (o.psg !== undefined && o.psg !== 'cpc' && o.psg !== 'spectrum') return `--psg is cpc or spectrum (found "${String(o.psg)}").`;
  return undefined;
}

/** aks2bas.py's arguments (without the script) in the documented order. */
export function aksArgv(inputRel: string, outRel: string, o: MusicConvertOptions): string[] {
  const a: string[] = [];
  if (o.sfx) a.push('--sfx');
  a.push(inputRel, outRel);
  a.push('--name', o.name ?? songName(path.basename(inputRel)));
  if (o.subsongs) a.push('--subsongs', o.subsongs.replace(/\s+/g, ''));
  if (o.psg) a.push('--psg', o.psg);
  if (o.at) a.push('--at', o.at);
  if (o.bin) a.push('--bin', o.bin);
  return a;
}

export interface MusicConvertSettings {
  pythonPath: string;
  library?: string;
  toolsDir?: string;
}

export interface MusicConvertResult {
  ok: boolean;
  output: string;
  bin?: string;
  name: string;
  argv: string[];
  error?: string;
}

/** A cancel token that fires after `ms` (the Arkos tools can hang forever when not re-signed on macOS). */
function timeoutToken(ms: number, base?: CancelToken): { token: CancelToken; clear(): void; timedOut(): boolean } {
  const listeners = new Set<() => void>();
  let fired = false;
  let timed = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    listeners.forEach((l) => l());
  };
  const t = setTimeout(() => {
    timed = true;
    fire();
  }, ms);
  const sub = base?.onCancellationRequested(fire);
  return {
    token: {
      get isCancellationRequested() {
        return fired || !!base?.isCancellationRequested;
      },
      onCancellationRequested(l) {
        listeners.add(l);
        return { dispose: () => void listeners.delete(l) };
      },
    },
    clear: () => {
      clearTimeout(t);
      sub?.dispose();
    },
    timedOut: () => timed,
  };
}

/** Converts a song or effect bank. Runs from the project root with project-relative paths, as build_assets.sh does. */
export async function convertMusic(
  root: string,
  inputRel: string,
  o: MusicConvertOptions,
  s: MusicConvertSettings,
  extra: { sink?: Sink; token?: CancelToken; timeoutMs?: number } = {},
): Promise<MusicConvertResult> {
  const name = o.name ?? songName(path.basename(inputRel));
  const output = (o.output ?? defaultMusicOutput(inputRel)).split(path.sep).join('/');
  const res: MusicConvertResult = { ok: false, output, name, argv: [], bin: o.bin };
  const bad = checkMusicOptions({ ...o, name });
  if (bad) return (res.error = bad), res;
  try {
    for (const p of [inputRel, output, ...(o.bin ? [o.bin] : [])]) insideRoot(root, p);
  } catch (e) {
    if (e instanceof PathEscapeError) return (res.error = e.message), res;
    throw e;
  }
  if (!fs.existsSync(path.resolve(root, inputRel))) return (res.error = `${inputRel}: not found`), res;
  const script = s.library ? path.join(s.library, 'tools', 'aks2bas.py') : '';
  if (!script || !fs.existsSync(script)) {
    res.error = 'tools/aks2bas.py was not found. Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/).';
    return res;
  }
  if (!s.toolsDir) return (res.error = ARKOS_MISSING), res;
  res.argv = aksArgv(inputRel, output, { ...o, name });
  fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
  const to = timeoutToken(extra.timeoutMs ?? 120000, extra.token);
  try {
    const t = await runTool([s.pythonPath], [script, ...res.argv], {
      cwd: root, token: to.token, sink: extra.sink, env: { ...process.env, AT3_TOOLS: s.toolsDir },
    });
    if (to.timedOut()) res.error = 'The Arkos tool did not finish in time. On macOS, downloaded tools hang until re-signed: run `sh tools/arkos/fetch.sh` again, or `codesign --force --sign - <tool>` on SongToAkg and SongToSoundEffects.';
    else if (t.cancelled) res.error = 'cancelled';
    else if (t.error) res.error = `${t.error}. Set "cpcbuild.python.path" to a Python 3.`;
    else if (t.code !== 0) res.error = (t.stderr.trim() || `aks2bas.py exited with ${t.code}`).split('\n').pop() as string;
    else res.ok = true;
  } finally {
    to.clear();
  }
  return res;
}

/** The label a converted include defines (`@NAME` for MusicInit), from its header comment; undefined if it is not one. */
export function songLabelOf(text: string): string | undefined {
  const m = /pass @(\w+) to (?:MusicInit|SfxInit)|^\s*' (\w+)\.bas -- Arkos/m.exec(text);
  return m ? (m[1] ?? m[2]) : undefined;
}

export interface PreviewPlan {
  kind: 'song' | 'sfx';
  name: string;
  subsong: number;
  /** Effect to play over and over (sfx banks), 1-based. */
  effect: number;
}

/** The BASIC program that plays the song (or effects) through the library's real player until ESC. */
export function previewProgram(p: PreviewPlan, includeFile: string): string {
  const head =
    `' CPCBuild music preview. Generated by "CPCBuild: Play Music"; do not edit.\n` +
    '#include <cpc.bas>\n#include <cpcbuild/display.bas>\n#include <cpcbuild/keyboard.bas>\n#include <music/music.bas>\n' +
    `#include "${includeFile}"\n\nCLS\nPRINT "CPCBuild music preview"\n`;
  if (p.kind === 'song') {
    return (
      head +
      `PRINT "song ${p.name}, subsong ${p.subsong}"\nPRINT "ESC stops"\nMusicInit(@${p.name}, ${p.subsong})\n` +
      'DO\n  WaitRetrace(1)\n  ScanKeys()\nLOOP UNTIL KeyDown(KEY_ESC)\nMusicStop()\n'
    );
  }
  return (
    head +
    `PRINT "effects ${p.name}, effect ${p.effect} every 2 seconds"\nPRINT "ESC stops"\nSfxInit(@${p.name})\n` +
    'DIM i AS UBYTE\nDIM q AS UBYTE\nq = 0\nDO\n  SfxPlay(' + p.effect + ', 0, 0)\n  FOR i = 1 TO 100\n    WaitRetrace(1)\n    ScanKeys()\n    IF KeyDown(KEY_ESC) THEN\n      q = 1\n      EXIT FOR\n    END IF\n  NEXT i\nLOOP UNTIL q\nSfxStop(0)\n'
  );
}
