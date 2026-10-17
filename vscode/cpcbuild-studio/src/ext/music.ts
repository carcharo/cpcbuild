/**
 * music.ts -- the Arkos commands (spec 5.2): Convert Music (.aks / .vt2 -> the include the music
 * library uses), Play Music (a tiny program around the real player, built, packaged as a .dsk and
 * run in the emulator) and Stop Music (reset the emulator session, or end the external emulator).
 *
 * The conversion is tools/aks2bas.py itself (arkos.ts), so its output is the script's. The preview
 * goes through the same build pipeline as a user target (build.ts) and the same emulator contract
 * as Run (run.ts), so it plays through the real AKG player and AY emulation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Project, Target } from '../core/project';
import type { EmuError } from '../emuApi';
import { ARKOS_MISSING, convertMusic, findArkosTools, MusicConvertOptions, previewProgram, songLabelOf, songName, PreviewPlan } from './arkos';
import { buildTarget } from './build';
import { channelSink, getChannel, tee } from './channel';
import { absFrom, readSettings, resolveLibrary, Settings } from './config';
import { projectRootOf } from './importer';
import { runInEmulator } from './run';

const MUSIC_EXTS = /\.(aks|vt2)$/i;
const posix = (p: string): string => p.split(path.sep).join('/');

function toolsFor(root: string, s: Settings, override?: string): { library?: string; toolsDir?: string } {
  const library = resolveLibrary(root, s);
  return { library, toolsDir: findArkosTools({ setting: override ?? s.arkosToolsPath, env: process.env.AT3_TOOLS, library, base: root }) };
}

function activeMusicUri(bas = false): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input as { uri?: vscode.Uri } | undefined;
  const ok = (u?: vscode.Uri): u is vscode.Uri => !!u && (MUSIC_EXTS.test(u.path) || (bas && /\.bas$/i.test(u.path)));
  if (ok(input?.uri)) return input?.uri;
  const ed = vscode.window.activeTextEditor?.document.uri;
  return ok(ed) ? ed : undefined;
}

export interface MusicCommandArgs extends MusicConvertOptions {
  uri?: vscode.Uri | string;
  /** Never ask or show messages (tests, scripts). */
  quiet?: boolean;
  /** Arkos tools folder, instead of the setting (tests). */
  toolsPath?: string;
}

const toUri = (v: vscode.Uri | string | undefined): vscode.Uri | undefined => (typeof v === 'string' ? vscode.Uri.file(v) : v);

async function pickMusicFile(arg: vscode.Uri | MusicCommandArgs | undefined, quiet: boolean, bas: boolean): Promise<vscode.Uri | undefined> {
  const given = arg instanceof vscode.Uri ? arg : toUri(arg?.uri);
  if (given) return given;
  const active = activeMusicUri(bas);
  if (active || quiet) return active;
  const found = await vscode.workspace.findFiles('**/*.{aks,vt2}', '**/node_modules/**', 100);
  if (!found.length) {
    void vscode.window.showInformationMessage('CPCBuild: no .aks or .vt2 song in this workspace.');
    return undefined;
  }
  if (found.length === 1) return found[0];
  const pick = await vscode.window.showQuickPick(found.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })), { title: 'CPCBuild: song' });
  return pick?.uri;
}

export interface MusicConvertOutcome {
  ok: boolean;
  /** Project-relative output. */
  output: string;
  name: string;
  argv: string[];
  error?: string;
}

/** CPCBuild: Convert Music. Never throws; returns the outcome. */
export async function musicConvertCommand(arg?: vscode.Uri | MusicCommandArgs): Promise<MusicConvertOutcome | undefined> {
  const a: MusicCommandArgs = arg instanceof vscode.Uri || !arg ? {} : arg;
  const quiet = a.quiet === true;
  const uri = await pickMusicFile(arg, quiet, false);
  if (!uri) return undefined;
  const root = projectRootOf(uri.fsPath);
  const s = readSettings(root);
  const opts: MusicConvertOptions = { name: a.name, sfx: a.sfx, subsongs: a.subsongs, psg: a.psg, at: a.at, bin: a.bin, output: a.output };
  if (opts.sfx === undefined && !quiet) {
    const pick = await vscode.window.showQuickPick(
      [{ label: 'Song', description: 'SongToAkg: MusicInit(@name, 0)', sfx: false }, { label: 'Sound effects bank', description: 'SongToSoundEffects: SfxInit(@name)', sfx: true }],
      { title: `CPCBuild: convert ${path.basename(uri.fsPath)} as...` },
    );
    if (!pick) return undefined;
    opts.sfx = pick.sfx;
  }
  const t = toolsFor(root, s, a.toolsPath);
  const inputRel = posix(path.relative(root, uri.fsPath));
  const sink = tee(channelSink);
  const r = await convertMusic(root, inputRel, opts, { pythonPath: s.pythonPath, library: t.library, toolsDir: t.toolsDir }, { sink });
  if (r.ok) {
    getChannel().appendLine(`${inputRel} -> ${r.output}`);
    if (!quiet) {
      const snippet = opts.sfx ? `#include "${path.basename(r.output)}"\nSfxInit(@${r.name})` : `#include <music/music.bas>\n#include "${path.basename(r.output)}"\nMusicInit(@${r.name}, 0)`;
      void vscode.window.showInformationMessage(`CPCBuild: wrote ${r.output}`, 'Copy usage', 'Open').then((c) => {
        if (c === 'Copy usage') void vscode.env.clipboard.writeText(snippet);
        else if (c === 'Open') void vscode.window.showTextDocument(vscode.Uri.file(path.resolve(root, r.output)));
      });
    }
  } else {
    getChannel().appendLine(`Convert Music failed: ${r.error}`);
    if (!quiet) void vscode.window.showErrorMessage(`CPCBuild: ${r.error}`);
  }
  return { ok: r.ok, output: r.output, name: r.name, argv: r.argv, error: r.error };
}

// ------------------------------------------------------------------ play / stop

interface Playing {
  dsk: string;
  used?: string;
  session?: string;
  pid?: number;
}
let current: Playing | undefined;

export interface MusicPlayArgs extends MusicCommandArgs {
  /** 0-based, as MusicInit takes it. */
  subsong?: number;
  /** Effect to play repeatedly (1-based) when the input is an effect bank. */
  effect?: number;
}

export interface MusicPlayOutcome {
  ok: boolean;
  error?: string;
  dsk?: string;
  /** The program that was built (project-relative). */
  program?: string;
  used?: string;
  session?: string;
  plan?: PreviewPlan;
}

/** The disc target of the preview: a CPC 464 program (spec 5.2). */
function previewTarget(): Target {
  return { id: 'preview', arch: 'cpc', main: 'preview.bas', model: '464', defines: [], bare: false, ownFont: false, package: 'dsk', disc: 'PREVIEW' };
}

/** CPCBuild: Play Music. */
export async function musicPlayCommand(arg?: vscode.Uri | MusicPlayArgs): Promise<MusicPlayOutcome | undefined> {
  const a: MusicPlayArgs = arg instanceof vscode.Uri || !arg ? {} : arg;
  const quiet = a.quiet === true;
  const uri = await pickMusicFile(arg, quiet, true);
  if (!uri) return undefined;
  const fail = (error: string): MusicPlayOutcome => {
    getChannel().appendLine(`Play Music failed: ${error}`);
    if (!quiet) void vscode.window.showErrorMessage(`CPCBuild: ${error}`);
    return { ok: false, error };
  };
  const root = projectRootOf(uri.fsPath);
  const s = readSettings(root);
  const library = resolveLibrary(root, s);
  if (!library) return fail('the cpcbuild library was not found. Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/).');
  const sink = tee(channelSink);
  const dir = path.join(absFrom(root, s.outputDir), '.preview');
  fs.mkdirSync(dir, { recursive: true });
  const file = uri.fsPath;

  // 1. the include: convert a song, or take a converted one
  let plan: PreviewPlan;
  let includeFile: string;
  if (/\.bas$/i.test(file)) {
    const text = fs.readFileSync(file, 'utf8');
    const label = songLabelOf(text);
    if (!label) return fail(`${path.basename(file)} is not a converted song or effect bank (made by "CPCBuild: Convert Music"); choose an .aks or .vt2 file.`);
    includeFile = path.basename(file);
    fs.copyFileSync(file, path.join(dir, includeFile));
    plan = { kind: /SfxInit/.test(text.slice(0, 400)) ? 'sfx' : 'song', name: label, subsong: a.subsong ?? 0, effect: a.effect ?? 1 };
  } else {
    const name = a.name ?? songName(path.basename(file));
    const t = toolsFor(root, s, a.toolsPath);
    if (!t.toolsDir) return fail(ARKOS_MISSING);
    includeFile = `${name}.bas`;
    const outRel = posix(path.relative(root, path.join(dir, includeFile)));
    const c = await convertMusic(root, posix(path.relative(root, file)), { name, sfx: a.sfx, subsongs: a.subsongs, psg: a.psg, output: outRel }, { pythonPath: s.pythonPath, library, toolsDir: t.toolsDir }, { sink });
    if (!c.ok) return fail(c.error ?? 'conversion failed');
    plan = { kind: a.sfx ? 'sfx' : 'song', name, subsong: a.subsong ?? 0, effect: a.effect ?? 1 };
  }

  // 2. the program, built like a user target
  fs.writeFileSync(path.join(dir, 'preview.bas'), previewProgram(plan, includeFile));
  const project: Project = { version: 1, name: 'music preview', library: null, targets: [previewTarget()], assets: [] };
  const bs: Settings = { ...s, libraryPath: library, zxbcCwd: s.zxbcCwd ? absFrom(root, s.zxbcCwd) : root, outputDir: '.', regenerateBeforeBuild: false };
  const b = await buildTarget(dir, project, project.targets[0], sink, undefined, bs);
  if (!b.ok || !b.run) return fail(`the preview program did not build: ${b.message ?? 'unknown error'}`);

  // 3. play
  await stopCurrent(false);
  const out = await runInEmulator(root, b.run, sink, s, library);
  if (!out.ok) return fail(out.message ?? 'the emulator could not be started');
  current = { dsk: b.run.file, used: out.used, session: out.session, pid: out.pid };
  if (!quiet) void vscode.window.showInformationMessage(`CPCBuild: playing ${plan.name} (${out.used}). ESC or "CPCBuild: Stop Music" ends it.`);
  return { ok: true, dsk: b.run.file, program: posix(path.relative(root, path.join(dir, 'preview.bas'))), used: out.used, session: out.session, plan };
}

export interface MusicStopOutcome {
  stopped: boolean;
  how?: 'reset' | 'killed' | 'nothing-to-stop';
  error?: string;
}

async function stopCurrent(report: boolean): Promise<MusicStopOutcome> {
  const c = current;
  current = undefined;
  if (!c) return { stopped: false, how: 'nothing-to-stop' };
  if (c.session) {
    const cmds = await vscode.commands.getCommands(true);
    if (cmds.includes('cpcbuild.emu.reset')) {
      const r = await vscode.commands.executeCommand<unknown | EmuError>('cpcbuild.emu.reset', { session: c.session });
      if (r && typeof r === 'object' && 'error' in r) {
        if (report) void vscode.window.showWarningMessage(`CPCBuild: could not reset the emulator: ${(r as EmuError).error}`);
        return { stopped: false, error: (r as EmuError).error };
      }
      return { stopped: true, how: 'reset' };
    }
  }
  if (c.pid) {
    for (const target of [-c.pid, c.pid]) {
      try {
        process.kill(target, 'SIGTERM');
        return { stopped: true, how: 'killed' };
      } catch {
        /* already gone, or not a group leader: try the next */
      }
    }
  }
  return { stopped: true, how: 'killed' };
}

/** CPCBuild: Stop Music. */
export async function musicStopCommand(): Promise<MusicStopOutcome> {
  const r = await stopCurrent(true);
  if (r.how === 'nothing-to-stop') void vscode.window.showInformationMessage('CPCBuild: no music preview is playing.');
  return r;
}

/** Test hook: what the last Play started. */
export function currentPreview(): Readonly<Playing> | undefined {
  return current;
}
