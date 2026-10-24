/**
 * arkos.ts -- converting Arkos Tracker songs and effect banks to Boriel includes, with the engine
 * the settings choose:
 *
 *   builtin  the TypeScript port (src/core/aks2bas.ts): runs the Arkos tools through runTool and
 *            post-processes their output itself, no Python needed;
 *   python   tools/aks2bas.py, exactly as games/shooter/build_assets.sh runs it.
 *
 * Both write the same bytes. Also the preview program that plays a song through the real player.
 * No vscode import.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Aks2basError, bankInclude, hex06, PSG_HZ, pyInt0, sanitizeName, setPsgClock, toBoriel } from '../core/aks2bas';
import { insideRoot, PathEscapeError } from '../core/paths';
import { toolsPlatform } from '../core/tools';
import { manifest } from './toolsManifest';
import { parseAddress } from '../core/project';
import { pythonCmd, runTool, type CancelToken, type Sink } from './runTool';

export const ARKOS_MISSING =
  'The Arkos command-line tools were not found. Run "CPC Game Studio: Download Tools", or set "cpcbuild.arkos.toolsPath" (in a cpcbuild checkout: `sh tools/arkos/fetch.sh`, which on macOS also re-signs the tools, which otherwise hang).';

/** Arkos has no command-line tools for this machine's platform (Download Tools says so too). */
export const arkosUnavailableText = (platform: string): string =>
  `Arkos Tracker has no command-line tools for ${platform}, so music conversion is not available here. Convert songs on another computer, or set "cpcbuild.arkos.toolsPath".`;

/** Why the Arkos tools are missing: the platform has none (linux-arm64), or they are not installed yet. */
export function arkosMissingText(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  const key = toolsPlatform(platform, arch);
  return key && manifest.arkos.assets[key] ? ARKOS_MISSING : arkosUnavailableText(`${platform}-${arch}`);
}

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The file of an Arkos tool in `dir`: `Tool.exe` on Windows (or plain `Tool`), `Tool` elsewhere; undefined if absent. */
export function arkosToolPath(dir: string, tool: 'SongToAkg' | 'SongToSoundEffects'): string | undefined {
  const names = process.platform === 'win32' ? [`${tool}.exe`, tool] : [tool];
  return names.map((n) => path.join(dir, n)).find((p) => fs.existsSync(p));
}

export interface ArkosLookup {
  /** "cpcbuild.arkos.toolsPath": when set it is the only place looked at (a wrong one is reported, not replaced). */
  setting?: string;
  /** The SDK folder: its arkos/bin/ (or bin/). */
  sdk?: string;
  /** The managed tools folder (<globalStorage>/tools/arkos-<version>/bin). */
  managed?: string;
  /** $AT3_TOOLS. */
  env?: string;
  /** PATH directories. */
  pathDirs?: string[];
  /** A cpcbuild checkout: tools/arkos/work/bin. */
  library?: string;
  base?: string;
}

/** The folder holding SongToAkg and SongToSoundEffects: the setting, the SDK, the managed tools, $AT3_TOOLS, PATH, then <library>/tools/arkos/work/bin. */
export function findArkosTools(o: ArkosLookup): string | undefined {
  const ok = (d: string): boolean => isDir(d) && !!arkosToolPath(d, 'SongToAkg') && !!arkosToolPath(d, 'SongToSoundEffects');
  if (o.setting?.trim()) {
    const d = path.resolve(o.base ?? '.', o.setting.trim());
    return ok(d) ? d : undefined;
  }
  const cands: string[] = [];
  if (o.sdk) cands.push(path.join(o.sdk, 'arkos', 'bin'), path.join(o.sdk, 'bin'));
  if (o.managed) cands.push(o.managed);
  if (o.env) cands.push(o.env);
  cands.push(...(o.pathDirs ?? []));
  if (o.library) cands.push(path.join(o.library, 'tools', 'arkos', 'work', 'bin'));
  return cands.find(ok);
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
  /** Default 'builtin'. */
  engine?: 'builtin' | 'python';
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

const TIMED_OUT = 'The Arkos tool did not finish in time. On macOS, downloaded tools hang until re-signed: run `sh tools/arkos/fetch.sh` again, or `codesign --force --sign - <tool>` on SongToAkg and SongToSoundEffects.';
const CANCELLED = '\0cancelled';

/** What the Python tool prints last (Studio shows that line): the message's final non-blank line. */
const lastLine = (msg: string): string => msg.trim().split('\n').pop() as string;

/**
 * The builtin engine: aks2bas.py's steps in TypeScript (same order, same messages). Returns the error text
 * (the tool's last line), CANCELLED, or undefined on success. Never throws.
 */
async function convertBuiltin(
  root: string,
  inputRel: string,
  output: string,
  name: string,
  o: MusicConvertOptions,
  toolsDir: string,
  token: CancelToken,
  sink?: Sink,
): Promise<string | undefined> {
  const safeName = sanitizeName(name);
  const abs = (p: string): string => path.resolve(root, p);
  let adr = 0;
  if (o.at) {
    adr = pyInt0(o.at);
    if (Number.isNaN(adr)) return `aks2bas.py: error: --at ${o.at}: not a number`;
    if (adr < 0x4000 || adr > 0x7fff) return 'aks2bas.py: error: --at must be inside the bank window, 0x4000-0x7FFF';
  }
  const td = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-aks-'));
  try {
    /** Runs one Arkos tool; undefined on success. */
    const run = async (tool: 'SongToAkg' | 'SongToSoundEffects', args: string[]): Promise<string | undefined> => {
      const exe = arkosToolPath(toolsDir, tool);
      if (!exe) return `aks2bas: ${tool} not found (run tools/arkos/fetch.sh or set AT3_TOOLS)`;
      const r = await runTool([exe], args, { cwd: root, token, sink });
      if (r.cancelled) return CANCELLED;
      if (r.error) return `${r.error}. Run \`sh tools/arkos/fetch.sh\` or set "cpcbuild.arkos.toolsPath".`;
      if (r.code !== 0) return lastLine(`aks2bas: ${tool} failed (${r.code}):\n${r.stdout}${r.stderr}`);
      return undefined;
    };
    let input = inputRel;
    if (o.psg) {
      const patched = path.join(td, 'in.aks');
      try {
        fs.writeFileSync(patched, setPsgClock(fs.readFileSync(abs(inputRel)), PSG_HZ[o.psg]));
      } catch (e) {
        if (e instanceof Aks2basError) return `aks2bas: ${inputRel}: ${e.message}`;
        throw e;
      }
      input = patched;
    }
    const subs = o.subsongs ? ['-s', o.subsongs.replace(/\s+/g, '')] : [];
    if (o.at) {
      const tmp = path.join(td, 'out.bin');
      const err = await run('SongToAkg', [...subs, '--exportAsBinary', '--encodingAddress', '0x' + adr.toString(16), input, tmp]);
      if (err) return err;
      const data = fs.readFileSync(tmp);
      if (adr + data.length > 0x8000) return `aks2bas: the song (${data.length} bytes) doesn't fit between ${hex06(adr)} and 0x7FFF`;
      if (o.bin) fs.writeFileSync(abs(o.bin), data);
      fs.writeFileSync(abs(output), bankInclude(data, safeName, adr), 'utf8');
      return undefined;
    }
    const prefix = safeName + '_';
    const tmp = path.join(td, 'out.asm');
    const err = o.sfx
      ? await run('SongToSoundEffects', ['--labelPrefix', prefix, input, tmp])
      : await run('SongToAkg', [...subs, '--labelPrefix', prefix, input, tmp]);
    if (err) return err;
    try {
      fs.writeFileSync(abs(output), toBoriel(fs.readFileSync(tmp, 'utf8'), safeName, '', o.sfx ? 'sfx' : 'song'), 'utf8');
    } catch (e) {
      // the Python tool dies with an uncaught ValueError here; its last line is what Studio showed
      if (e instanceof Aks2basError) return `ValueError: ${e.message}`;
      throw e;
    }
    return undefined;
  } finally {
    fs.rmSync(td, { recursive: true, force: true });
  }
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
  if (!s.toolsDir) return (res.error = arkosMissingText()), res;
  res.argv = aksArgv(inputRel, output, { ...o, name });
  fs.mkdirSync(path.dirname(path.resolve(root, output)), { recursive: true });
  const to = timeoutToken(extra.timeoutMs ?? 120000, extra.token);
  const python = s.engine === 'python';
  try {
    if (python) {
      const script = s.library ? path.join(s.library, 'tools', 'aks2bas.py') : '';
      if (!script || !fs.existsSync(script)) {
        res.error = 'tools/aks2bas.py was not found. Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/), or set "cpcbuild.assets.engine" to "builtin".';
        return res;
      }
      const t = await runTool(pythonCmd(s.pythonPath), [script, ...res.argv], {
        cwd: root, token: to.token, sink: extra.sink, env: { ...process.env, AT3_TOOLS: s.toolsDir },
      });
      if (to.timedOut()) res.error = TIMED_OUT;
      else if (t.cancelled) res.error = 'cancelled';
      else if (t.error) res.error = `${t.error}. Set "cpcbuild.python.path" to a Python 3, or set "cpcbuild.assets.engine" to "builtin".`;
      else if (t.code !== 0) res.error = (t.stderr.trim() || `aks2bas.py exited with ${t.code}`).split('\n').pop() as string;
      else res.ok = true;
    } else {
      const err = await convertBuiltin(root, inputRel, output, name, o, s.toolsDir, to.token, extra.sink);
      if (to.timedOut()) res.error = TIMED_OUT;
      else if (err === CANCELLED) res.error = 'cancelled';
      else if (err) res.error = err;
      else res.ok = true;
    }
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
    `' CPCBuild music preview. Generated by "CPC Game Studio: Play Music"; do not edit.\n` +
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
