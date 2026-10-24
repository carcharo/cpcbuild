/** doctor.ts -- "CPCBuild: Check Environment" (spec 2.5). */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { absFrom, compilerCommand, manifest, readSettings, resolveArkos, resolveCompilerFor, resolveLibrary, resolveMkcpr, resolveMkdsk, Settings } from './config';
import { findCap32, findCpcec, findRvm } from './run';
import { pythonCmd, runTool, Sink } from './runTool';
import { describeCompiler } from './toolpaths';
import { compilerHint, DOWNLOAD_HINT, poetryAdvice, runZxbc } from './zxbcCommand';
import { arkosUnavailableText } from './arkos';
import { assetForKey, toolsPlatform } from '../core/tools';
import { findTiled } from './tmxViewer';
import { isTrusted, restrictedText } from './trust';

export interface DoctorItem {
  id: string;
  label: string;
  ok: boolean;
  /** Where it was found, or what is wrong. */
  detail: string;
  /** What to do when missing. */
  fix?: string;
  /** A missing optional item is not a problem. */
  optional?: boolean;
}

/** True when cpcbuild-emu answers (its commands load it on demand, so asking is the test; "not found" = not installed). */
async function emuInstalled(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('cpcbuild.emu.version');
    return true;
  } catch {
    return false;
  }
}

export async function checkEnvironment(projectDir: string | undefined, sink: Sink, settings?: Settings): Promise<DoctorItem[]> {
  const base = projectDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const s = settings ?? readSettings(projectDir);
  const items: DoctorItem[] = [];
  const add = (i: DoctorItem): void => void items.push(i);

  // compiler and Python: running them starts programs named by settings, so not in Restricted Mode
  const trusted = isTrusted();
  const cwd = s.zxbcCwd ? absFrom(base, s.zxbcCwd) : base;
  const comp = resolveCompilerFor(base, s);
  // Python is optional now: the compiler tools bring their own mkdsk, cartridges and music are built in. It is
  // needed with the python engine, or with a zxbasic checkout (zxbc.cwd, or `poetry run zxbc`).
  const pyNeeded = s.assetsEngine === 'python' || !!s.zxbcCwd || comp.kind === 'poetry';
  if (trusted) {
    const z = await runZxbc(compilerCommand(comp, s), ['--version'], { cwd, quiet: true });
    const zOut = (z.stdout + z.stderr).trim().split('\n')[0];
    const where = comp.kind === 'none' ? '' : `${describeCompiler(comp)}; `;
    add({
      id: 'zxbc', label: 'zxbc (Boriel BASIC compiler, cpc arch)', ok: z.code === 0,
      detail: z.code === 0 ? `${where}${z.used.join(' ')}${z.fellBack ? ' (fallback: the default "zxbc" was not found)' : ''}: ${zOut}` : comp.kind === 'none' && comp.problem ? comp.problem : z.error ?? `exited ${z.code}: ${zOut}`,
      fix: s.zxbcCwd ? `${DOWNLOAD_HINT} Or, with a zxbasic checkout: ${poetryAdvice(s.zxbcCommand, cwd)}` : compilerHint('zxbc could not be run', s.zxbcCommand),
    });
    const py = await runTool(pythonCmd(s.pythonPath), ['--version'], { quiet: true });
    const pyOut = (py.stdout + py.stderr).trim();
    add({
      id: 'python', label: 'Python 3', ok: py.code === 0 && /Python 3/.test(pyOut), optional: !pyNeeded,
      detail: py.code === 0 ? `${s.pythonPath}: ${pyOut}` : py.error ?? `exited ${py.code}`,
      fix: pyNeeded ? 'Install Python 3 or set "cpcbuild.python.path".' : 'Only needed with the python engine or a zxbasic checkout.',
    });
  } else {
    for (const [id, label] of [['zxbc', 'zxbc (Boriel BASIC compiler, cpc arch)'], ['python', 'Python 3']] as const) {
      add({ id, label, ok: false, optional: true, detail: `not run: ${restrictedText('Checking it')}`, fix: 'Trust the workspace ("Manage Workspace Trust"), then run the check again.' });
    }
  }
  const lib = resolveLibrary(base, s);
  add({
    id: 'library', label: 'cpcbuild library (lib/)', ok: !!lib, detail: lib ? path.join(lib, 'lib') : 'not found',
    fix: 'Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/).',
  });
  add(s.assetsEngine === 'python'
    ? {
      id: 'tools', label: 'cpcbuild tools/ (mkcpr.py)', ok: !!resolveMkcpr(lib), detail: resolveMkcpr(lib) ?? 'not found',
      fix: 'Point "cpcbuild.library.path" at a full cpcbuild checkout, or set "cpcbuild.assets.engine" to "builtin".',
    }
    : { id: 'tools', label: 'Cartridge packaging (mkcpr)', ok: true, detail: 'built in' });
  const mkdsk = resolveMkdsk(s, base, lib, comp);
  add({
    id: 'mkdsk', label: 'mkdsk (disc images)', ok: !!mkdsk, detail: mkdsk?.join(' ') ?? 'not found',
    fix: `${DOWNLOAD_HINT} Or set "cpcbuild.zxbc.cwd" to your zxbasic checkout (it holds tools/cpc/mkdsk.py).`,
  });

  // emulator
  const emu = s.emulator;
  if (emu === 'emu') {
    const has = await emuInstalled();
    add({
      id: 'emulator', label: 'Emulator: cpcbuild-emu extension', ok: has, optional: true,
      detail: has ? 'cpcbuild.emu.version answers' : 'not installed (Run falls back to an external emulator)',
      fix: 'Install the CPCBuild Emulator extension, or set "cpcbuild.run.emulator" to caprice32, cpcec or rvm.',
    });
  } else if (emu === 'caprice32' || emu === 'cpcec' || emu === 'rvm') {
    const found = emu === 'caprice32' ? findCap32(s, lib) : emu === 'cpcec' ? findCpcec(s, lib) : findRvm(s);
    add({
      id: 'emulator', label: `Emulator: ${emu}`, ok: !!found, detail: found ?? 'not found',
      fix: emu === 'caprice32' ? 'Run `make cap32` in the cpcbuild checkout, or set "cpcbuild.run.caprice32Path".'
        : emu === 'cpcec' ? 'Run `make cpcec` in the cpcbuild checkout, or set "cpcbuild.run.cpcecPath".'
        : 'Install Retro Virtual Machine or set "cpcbuild.run.rvmPath".',
    });
  } else {
    add({ id: 'emulator', label: 'Emulator: custom command', ok: !!s.customCommand.trim(), detail: s.customCommand || 'empty', fix: 'Set "cpcbuild.run.customCommand".' });
  }

  // optional tools
  const arkos = resolveArkos(base, s, lib);
  const plat = toolsPlatform(process.platform, process.arch);
  const noAsset = !plat || !assetForKey(manifest.arkos, plat);
  add({
    id: 'arkos', label: 'Arkos command-line tools', ok: !!arkos, optional: true, detail: arkos || 'not found',
    fix: !noAsset ? `${DOWNLOAD_HINT} Or set "cpcbuild.arkos.toolsPath" (in a cpcbuild checkout: \`sh tools/arkos/fetch.sh\`).` : arkosUnavailableText(`${process.platform}-${process.arch}`),
  });
  const tiled = findTiled(s.tiledPath);
  add({ id: 'tiled', label: 'Tiled map editor', ok: !!tiled, optional: true, detail: tiled ?? 'not found', fix: 'Install Tiled (mapeditor.org) for "Open in Tiled".' });

  sink.line('CPCBuild environment check');
  for (const i of items) {
    sink.line(`  [${i.ok ? 'ok' : i.optional ? 'optional' : 'MISSING'}] ${i.label}: ${i.detail}`);
    if (!i.ok && i.fix) sink.line(`        fix: ${i.fix}`);
  }
  return items;
}

export async function doctorCommand(projectDir: string | undefined, sink: Sink, channelShow: () => void): Promise<DoctorItem[]> {
  const items = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CPCBuild: checking the environment' }, () => checkEnvironment(projectDir, sink));
  channelShow();
  const bad = items.filter((i) => !i.ok && !i.optional);
  if (bad.length === 0) {
    void vscode.window.showInformationMessage('CPCBuild: the environment looks fine (details in the CPCBuild output).');
  } else {
    const first = bad[0];
    void vscode.window.showWarningMessage(`CPCBuild: ${bad.length} missing: ${bad.map((b) => b.label).join(', ')}. ${first.fix ?? ''}`, 'Open Settings').then((c) => {
      if (c) void vscode.commands.executeCommand('workbench.action.openSettings', 'cpcbuild');
    });
  }
  return items;
}
