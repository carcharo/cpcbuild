/** doctor.ts -- "CPC Game Studio: Check Environment" (spec 2.5). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { VERSION } from '@cpcbuild/cpcbas';
import { bundledLibrary, manifest, readSettings, resolveArkos, resolveLibrary, Settings } from './config';
import { findCap32, findCpcec, findRvm } from './run';
import { isMacPythonStub, pythonCmd, runTool, Sink } from './runTool';
import { arkosUnavailableText } from './arkos';
import { assetForKey, toolsPlatform } from '../core/tools';
import { findTiled } from './tmxViewer';
import { isTrusted, restrictedText } from './trust';

const DOWNLOAD_HINT = 'Run "CPC Game Studio: Download Tools".';

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

  // the compiler is part of the extension: it needs nothing installed
  const bundled = bundledLibrary();
  const libOk = !!bundled && fs.existsSync(path.join(bundled, 'lib', 'runtime'));
  add({ id: 'compiler', label: 'cpcbas (CPC BASIC compiler)', ok: true, detail: `${VERSION}, built in (it runs inside the extension)` });
  add({
    id: 'library', label: 'BASIC library (lib/)', ok: libOk, detail: libOk ? path.join(bundled as string, 'lib') : 'not found',
    fix: 'The extension is damaged: install CPC Game Studio again.',
  });

  // Python runs only the python image engine: not in Restricted Mode
  const trusted = isTrusted();
  const pyNeeded = s.assetsEngine === 'python';
  if (trusted) {
    // never run macOS's placeholder python3: it pops Apple's "install the developer tools" dialog at a newcomer
    const stub = isMacPythonStub(s.pythonPath);
    const py = stub ? { code: null, stdout: '', stderr: '', error: 'not installed (macOS offers to install its developer tools for it; CPC Game Studio does not need them)' } : await runTool(pythonCmd(s.pythonPath), ['--version'], { quiet: true });
    const pyOut = (py.stdout + py.stderr).trim();
    add({
      id: 'python', label: 'Python 3', ok: py.code === 0 && /Python 3/.test(pyOut), optional: !pyNeeded,
      detail: py.code === 0 ? `${s.pythonPath}: ${pyOut}` : py.error ?? `exited ${py.code}`,
      fix: pyNeeded ? 'Install Python 3 or set "cpcbuild.python.path".' : 'Only needed with the python image engine.',
    });
  } else {
    add({ id: 'python', label: 'Python 3', ok: false, optional: true, detail: `not run: ${restrictedText('Checking it')}`, fix: 'Trust the workspace ("Manage Workspace Trust"), then run the check again.' });
  }
  const lib = resolveLibrary(base, s);
  add(s.assetsEngine === 'python'
    ? {
      id: 'tools', label: 'cpcbuild tools/ (img2cpc.py)', ok: !!lib, detail: lib ? path.join(lib, 'tools') : 'not found',
      fix: 'Point "cpcbuild.library.path" at a full cpcbuild checkout, or set "cpcbuild.assets.engine" to "builtin".',
    }
    : { id: 'tools', label: 'Image and cartridge tools', ok: true, detail: 'built in' });

  // emulator
  const emu = s.emulator;
  if (emu === 'emu') {
    const has = await emuInstalled();
    add({
      id: 'emulator', label: 'Emulator: cpcbuild-emu extension', ok: has, optional: true,
      detail: has ? 'cpcbuild.emu.version answers' : 'not installed (Run falls back to an external emulator)',
      fix: 'Install the CPC Game Studio Emulator extension, or set "cpcbuild.run.emulator" to caprice32, cpcec or rvm.',
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

  sink.line('CPC Game Studio environment check');
  for (const i of items) {
    sink.line(`  [${i.ok ? 'ok' : i.optional ? 'optional' : 'MISSING'}] ${i.label}: ${i.detail}`);
    if (!i.ok && i.fix) sink.line(`        fix: ${i.fix}`);
  }
  return items;
}

export async function doctorCommand(projectDir: string | undefined, sink: Sink, channelShow: () => void): Promise<DoctorItem[]> {
  const items = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'CPC Game Studio: checking the environment' }, () => checkEnvironment(projectDir, sink));
  channelShow();
  const bad = items.filter((i) => !i.ok && !i.optional);
  if (bad.length === 0) {
    void vscode.window.showInformationMessage('CPC Game Studio: the environment looks fine (details in the CPC Game Studio output).');
  } else {
    const first = bad[0];
    void vscode.window.showWarningMessage(`CPC Game Studio: ${bad.length} missing: ${bad.map((b) => b.label).join(', ')}. ${first.fix ?? ''}`, 'Open Settings').then((c) => {
      if (c) void vscode.commands.executeCommand('workbench.action.openSettings', 'cpcbuild');
    });
  }
  return items;
}
