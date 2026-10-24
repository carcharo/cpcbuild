/**
 * run.ts -- starting the program in the selected emulator (spec 4.6).
 * `emu` goes through the cpcbuild-emu commands (design section 2) and falls
 * back to an external emulator when they are missing; the others are
 * external programs started with a visible window, as tools/cpcrun.py does.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { EmuError, EmuModel, EmuOpenResult, EmuVersion } from '../emuApi';
import { EMU_API_VERSION } from '../emuApi';
import type { RunInfo } from './build';
import { fileExists, readSettings, resolveLibrary, Settings } from './config';
import { ExternalChoice, notifyEmuMissing } from './emuMissing';
import { cap32Config } from './cap32cfg';
import { launchDetached, Sink } from './runTool';
import { cap32Candidates, cpcecCandidates } from './toolpaths';
import { isTrusted, notifyUntrusted, restrictedText } from './trust';

const MODEL_NUM: Record<EmuModel, number> = { '464': 0, '664': 1, '6128': 2, plus: 3 };

export interface LaunchPlan {
  command: string[];
  args: string[];
  note?: string;
}

/** Splits a command template into words (quotes group; no shell is involved). */
export function splitCommand(text: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

export function expandTemplate(tpl: string, run: RunInfo): string[] {
  const vars: Record<string, string> = {
    dsk: run.kind === 'dsk' ? run.file : '',
    cpr: run.kind === 'cpr' ? run.file : '',
    bin: run.file.replace(/\.(dsk|cpr)$/i, '.bin'),
    model: run.model,
  };
  return splitCommand(tpl).map((w) => w.replace(/\$\{(\w+)\}/g, (_, k: string) => vars[k] ?? ''));
}

/** Caprice32 arguments for a program or cartridge (the model options of cpcrun.py / run.sh, minus the headless ones). */
export function cap32Args(run: RunInfo, autorun: string, cfg?: string): string[] {
  const a: string[] = [];
  if (cfg) a.push('-c', cfg);
  a.push('-O', `system.model=${MODEL_NUM[run.model]}`);
  if (run.model === '464' || run.model === '664') a.push('-O', 'system.ram_size=64');
  else a.push('-O', 'system.ram_size=128');
  if (run.model === 'plus') a.push('-O', 'system.boot_time=42');
  else a.push('-O', 'rom.slot07=amsdos.rom');
  if (run.kind === 'dsk') {
    if (run.model === 'plus') a.push('-a', 'CPC_F1', '-a', 'CAP32_DELAY'); // the system cartridge's menu: f1 = BASIC
    a.push('-a', autorun.replace(/\$\{name\}/g, run.name ?? ''));
  }
  a.push(run.file);
  return a;
}

export function cpcecArgs(run: RunInfo): string[] {
  const a = [`-m${MODEL_NUM[run.model]}`];
  if (run.kind === 'dsk') a.push('-x'); // discs on, the 464 included
  if (run.model === '464' || run.model === '664') a.push('-k0'); // 64 KB
  a.push(run.file);
  return a;
}

function firstExisting(...cands: (string | undefined)[]): string | undefined {
  return cands.find((c): c is string => !!c && fileExists(c));
}

export function findCap32(s: Settings, library?: string): string | undefined {
  return firstExisting(s.caprice32Path, process.env.CAP32, ...cap32Candidates(library));
}

export function findCpcec(s: Settings, library?: string): string | undefined {
  return firstExisting(s.cpcecPath, process.env.CPCEC, ...cpcecCandidates(library));
}

/** Retro Virtual Machine: the setting, else /Applications on macOS. Windows and Linux: the setting only (no install location is known). */
export function findRvm(s: Settings): string | undefined {
  if (s.rvmPath) return fileExists(s.rvmPath) ? s.rvmPath : undefined;
  if (process.platform !== 'darwin') return undefined;
  try {
    const dir = '/Applications';
    const hit = fs.readdirSync(dir).find((n) => /^Retro Virtual Machine.*\.app$/i.test(n));
    return hit ? path.join(dir, hit) : undefined;
  } catch {
    return undefined;
  }
}

/** Where Studio may keep files of its own (ExtensionContext.globalStorageUri), set at activation. */
let storageDir: string | undefined;
export function setStorageDir(dir: string | undefined): void {
  storageDir = dir;
}

export interface RunOutcome {
  ok: boolean;
  /** Which emulator was actually used. */
  used?: string;
  message?: string;
  /** The cpcbuild-emu session (used === 'emu'). */
  session?: string;
  /** The external emulator's process id (so "Stop Music" can end it). */
  pid?: number;
  /** True while that process (the one we started) is still running. */
  alive?: () => boolean;
}

/** The doctor's best external emulator: the first of Caprice32, CPCEC, Retro Virtual Machine that is installed. */
export function bestExternalEmulator(s: Settings, library?: string): ExternalChoice | undefined {
  return findCap32(s, library) ? 'caprice32' : findCpcec(s, library) ? 'cpcec' : findRvm(s) ? 'rvm' : undefined;
}

/** Called with the session id after Run opened (or reused) a cpcbuild-emu session (the debug controls re-apply breakpoints). */
let sessionOpened: ((session: string) => Promise<void>) | undefined;
export function onSessionOpened(fn: ((session: string) => Promise<void>) | undefined): void {
  sessionOpened = fn;
}

/** True when the error says the command does not exist (the emulator extension is not installed). */
export const isCommandNotFound = (e: unknown): boolean => /command '.*' not found/i.test(e instanceof Error ? e.message : String(e));

async function viaEmuExtension(run: RunInfo, sink: Sink): Promise<RunOutcome & { fallbackWhy?: string }> {
  // cpcbuild-emu activates on its commands (onCommand), so it may not be loaded yet: ask, and treat "command not found" as missing
  let v: EmuVersion | EmuError | undefined;
  try {
    v = await vscode.commands.executeCommand<EmuVersion | EmuError>('cpcbuild.emu.version');
  } catch (e) {
    if (isCommandNotFound(e)) return { ok: false, fallbackWhy: 'the CPCBuild Emulator extension (cpcbuild-emu) is not installed, so its commands are missing' };
    return { ok: false, fallbackWhy: `cpcbuild.emu.version failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!v || 'error' in v) return { ok: false, fallbackWhy: `cpcbuild.emu.version failed${v && 'error' in v ? `: ${v.error}` : ''}` };
  if (v.api !== EMU_API_VERSION) return { ok: false, fallbackWhy: `cpcbuild-emu speaks API ${v.api}, Studio needs API ${EMU_API_VERSION}` };
  sink.line(`cpcbuild-emu API ${v.api} (CPCEC ${v.cpcec})`);
  const r = await vscode.commands.executeCommand<EmuOpenResult | EmuError>('cpcbuild.emu.open', {
    file: run.file, kind: run.kind, model: run.model, run: run.name, reuse: true, focus: true,
  });
  if (!r || 'error' in r) return { ok: false, fallbackWhy: `cpcbuild.emu.open failed${r && 'error' in r ? `: ${r.error}` : ''}` };
  sink.line(`emulator session ${r.session}`);
  try {
    await sessionOpened?.(r.session);
  } catch {
    /* the debug controls must never fail a Run */
  }
  return { ok: true, used: 'emu', session: r.session };
}

/** Launches `run` in the emulator the settings choose. Never throws. */
export async function runInEmulator(root: string, run: RunInfo, sink: Sink, settings: Settings = readSettings(root), libraryHint?: string | null): Promise<RunOutcome> {
  const s = settings;
  const library = resolveLibrary(root, s, libraryHint);
  let choice = s.emulator;
  if (choice === 'emu') {
    const r = await viaEmuExtension(run, sink);
    if (r.ok) return r;
    const external = bestExternalEmulator(s, library);
    sink.line(`Run: ${r.fallbackWhy}. Falling back to an external emulator (set "cpcbuild.run.emulator" to hide this).`, true);
    // one warning per session, not one per Run (emuMissing.ts)
    void notifyEmuMissing({ why: r.fallbackWhy ?? 'the emulator extension is unavailable', external, library });
    choice = external ?? 'caprice32';
  }
  // the emulator extension only plays the file it is given; every other emulator is a program named by settings
  if (!isTrusted()) {
    notifyUntrusted('Run in an external emulator');
    return { ok: false, message: restrictedText('Running in an external emulator') + ' The CPCBuild Emulator extension still runs in Restricted Mode.' };
  }
  switch (choice) {
    case 'caprice32': {
      const bin = findCap32(s, library);
      if (!bin) return { ok: false, message: 'Caprice32 was not found. Run `make cap32` in the cpcbuild checkout, or set "cpcbuild.run.caprice32Path".' };
      if (!bin.includes(`${path.sep}tools${path.sep}caprice32${path.sep}work`)) {
        sink.line('Run: this is not the patched Caprice32 of `make cap32` (the stock one mishandles the Plus ASIC); Plus programs may misbehave.', true);
      }
      const r = await launchDetached([bin], cap32Args(run, s.autorunCommand, cap32Config(bin, storageDir)), { cwd: path.dirname(bin), sink });
      return r.ok ? { ok: true, used: 'caprice32', pid: r.pid, alive: r.alive } : { ok: false, message: `could not start Caprice32: ${r.error}` };
    }
    case 'cpcec': {
      const bin = findCpcec(s, library);
      if (!bin) return { ok: false, message: 'CPCEC was not found. Run `make cpcec` in the cpcbuild checkout, or set "cpcbuild.run.cpcecPath".' };
      const r = await launchDetached([bin], cpcecArgs(run), { sink });
      return r.ok ? { ok: true, used: 'cpcec', pid: r.pid, alive: r.alive } : { ok: false, message: `could not start CPCEC: ${r.error}` };
    }
    case 'rvm': {
      const app = findRvm(s);
      if (!app) return { ok: false, message: `Retro Virtual Machine was not found${process.platform === 'darwin' ? ' in /Applications' : ' (it is only looked for on macOS)'}. Install it, or set "cpcbuild.run.rvmPath".` };
      const r = process.platform === 'darwin' ? await launchDetached(['open'], ['-a', app, run.file], { sink }) : await launchDetached([app], [run.file], { sink });
      return r.ok ? { ok: true, used: 'rvm', pid: r.pid, alive: r.alive } : { ok: false, message: `could not start Retro Virtual Machine: ${r.error}` };
    }
    case 'custom': {
      if (!s.customCommand.trim()) return { ok: false, message: 'No custom command. Set "cpcbuild.run.customCommand" (use ${dsk}, ${cpr}, ${bin}, ${model}).' };
      const words = expandTemplate(s.customCommand, run);
      const r = await launchDetached([words[0]], words.slice(1), { sink });
      return r.ok ? { ok: true, used: 'custom', pid: r.pid, alive: r.alive } : { ok: false, message: `could not start "${words[0]}": ${r.error}` };
    }
    default:
      return { ok: false, message: `unknown emulator "${choice}"` };
  }
}
