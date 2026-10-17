/** doctor.ts -- "CPCBuild: Check Environment" (spec 2.5). */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { absFrom, fileExists, readSettings, resolveLibrary, resolveMkcpr, resolveMkdsk, Settings } from './config';
import { findCap32, findCpcec, findRvm } from './run';
import { runTool, Sink } from './runTool';
import { findArkosTools } from './arkos';
import { findTiled } from './tmxViewer';

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

export async function checkEnvironment(projectDir: string | undefined, sink: Sink, settings?: Settings): Promise<DoctorItem[]> {
  const base = projectDir ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const s = settings ?? readSettings(projectDir);
  const items: DoctorItem[] = [];
  const add = (i: DoctorItem): void => void items.push(i);

  // compiler
  const cwd = s.zxbcCwd ? absFrom(base, s.zxbcCwd) : base;
  const z = await runTool(s.zxbcCommand, ['--version'], { cwd, quiet: true });
  const zOut = (z.stdout + z.stderr).trim().split('\n')[0];
  add({
    id: 'zxbc', label: 'zxbc (Boriel BASIC compiler, cpc arch)', ok: z.code === 0,
    detail: z.code === 0 ? `${s.zxbcCommand.join(' ')}: ${zOut}` : z.error ?? `exited ${z.code}: ${zOut}`,
    fix: 'Set "cpcbuild.zxbc.command" (the fork: ["poetry","run","zxbc"]) and "cpcbuild.zxbc.cwd" (your zxbasic checkout, branch cpc-arch).',
  });
  const py = await runTool([s.pythonPath], ['--version'], { quiet: true });
  const pyOut = (py.stdout + py.stderr).trim();
  add({
    id: 'python', label: 'Python 3', ok: py.code === 0 && /Python 3/.test(pyOut),
    detail: py.code === 0 ? `${s.pythonPath}: ${pyOut}` : py.error ?? `exited ${py.code}`,
    fix: 'Install Python 3 or set "cpcbuild.python.path".',
  });
  const lib = resolveLibrary(base, s);
  add({
    id: 'library', label: 'cpcbuild library (lib/)', ok: !!lib, detail: lib ? path.join(lib, 'lib') : 'not found',
    fix: 'Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/).',
  });
  add({
    id: 'tools', label: 'cpcbuild tools/ (mkcpr.py)', ok: !!resolveMkcpr(lib), detail: resolveMkcpr(lib) ?? 'not found',
    fix: 'Point "cpcbuild.library.path" at a full cpcbuild checkout.',
  });
  const mkdsk = resolveMkdsk(s, base, lib);
  add({
    id: 'mkdsk', label: 'mkdsk.py (zxbasic tools/cpc/)', ok: !!mkdsk, detail: mkdsk ?? 'not found',
    fix: 'Set "cpcbuild.zxbc.cwd" to your zxbasic checkout (it holds tools/cpc/mkdsk.py).',
  });

  // emulator
  const emu = s.emulator;
  if (emu === 'emu') {
    const cmds = await vscode.commands.getCommands(true);
    const has = cmds.includes('cpcbuild.emu.open');
    add({
      id: 'emulator', label: 'Emulator: cpcbuild-emu extension', ok: has, optional: true,
      detail: has ? 'cpcbuild.emu.open is registered' : 'not installed (Run falls back to an external emulator)',
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
  const arkos = findArkosTools({ setting: s.arkosToolsPath, env: process.env.AT3_TOOLS, library: lib, base });
  add({ id: 'arkos', label: 'Arkos command-line tools', ok: !!arkos, optional: true, detail: arkos || 'not found', fix: 'Run `sh tools/arkos/fetch.sh` in the cpcbuild checkout (on macOS it also re-signs the downloaded tools, which otherwise hang), or set "cpcbuild.arkos.toolsPath".' });
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
