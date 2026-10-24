/**
 * emuInstall.ts -- "CPC Game Studio: Install Emulator": the CPC Game Studio Emulator extension from the release of Studio's own
 * version. A local cpcbuild checkout's .vsix comes first (as before); else the .vsix is downloaded to global storage
 * and installed with workbench.extensions.installExtension; if the download fails the releases page opens.
 * Shared by the missing-emulator warning (emuMissing.ts) and walkthrough step 2.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { emuVsixName, emuVsixUrl, RELEASES_PAGE } from '../core/setup';
import { getChannel } from './channel';
import { download, proxyFor } from './download';
import { findLocalVsix } from './emuMissing';

export interface InstallEmuArgs {
  /** The cpcbuild checkout to look for a built .vsix in. */
  library?: string;
  /** Studio's version (default: this extension's package.json). */
  version?: string;
  /** Replaces https://github.com/carcharo/cpcbuild/releases (tests serve the file from a local HTTP server). */
  releasesBase?: string;
  /** Folder for the download (default: <globalStorage>/emulator). */
  dir?: string;
  /** Replaces the install command (tests). */
  install?(file: vscode.Uri): Thenable<unknown>;
  /** Replaces opening the releases page (tests). */
  open?(url: string): Thenable<unknown>;
  /** Never show messages or progress. */
  quiet?: boolean;
}

export interface InstallEmuResult {
  ok: boolean;
  how: 'local' | 'download' | 'fallback';
  message: string;
  file?: string;
}

let studioVersion = '0.0.0';
let storage: string | undefined;
export function setEmuInstallContext(version: string, storageDir: string | undefined): void {
  studioVersion = version;
  storage = storageDir;
}

/** Defaults that tests set through the extension's exports (the module is bundled, so they cannot import it). */
let testDefaults: InstallEmuArgs = {};
export const emuInstallTestApi = {
  setDefaults(a: InstallEmuArgs | undefined): void {
    testDefaults = a ?? {};
  },
  install: (a?: InstallEmuArgs): Promise<InstallEmuResult> => installEmulator(a),
};

let running: Promise<InstallEmuResult> | undefined;

export function installEmulator(arg?: InstallEmuArgs | unknown): Promise<InstallEmuResult> {
  const a: InstallEmuArgs = arg && typeof arg === 'object' && !('scheme' in arg) ? (arg as InstallEmuArgs) : {};
  if (running) return running;
  running = run({ ...testDefaults, ...a }).finally(() => (running = undefined));
  return running;
}

async function run(a: InstallEmuArgs): Promise<InstallEmuResult> {
  const out = getChannel();
  const say = (m: string): void => out.appendLine(m);
  const show = (kind: 'info' | 'error', m: string): void => {
    if (a.quiet) return;
    void (kind === 'info' ? vscode.window.showInformationMessage(m) : vscode.window.showErrorMessage(m));
  };
  const vsix = findLocalVsix(a.library);
  if (vsix) {
    if (!a.quiet) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(vsix));
    const message = `CPC Game Studio: the emulator package is ${vsix}. Install it with "Extensions: Install from VSIX..." from the Extensions view menu.`;
    say(message);
    show('info', message);
    return { ok: true, how: 'local', message, file: vsix };
  }
  const version = a.version ?? studioVersion;
  const url = emuVsixUrl(version, a.releasesBase);
  const open = a.open ?? ((u: string) => vscode.env.openExternal(vscode.Uri.parse(u)));
  const fallback = async (error: string): Promise<InstallEmuResult> => {
    const message = `CPC Game Studio: could not download CPC Game Studio Emulator ${version}: ${error}. Opening the releases page; download ${emuVsixName(version)} there and use "Extensions: Install from VSIX...".`;
    say(message);
    show('error', message);
    if (!a.quiet || a.open) await open(RELEASES_PAGE);
    return { ok: false, how: 'fallback', message };
  };
  const dir = a.dir ?? (storage ? path.join(storage, 'emulator') : undefined);
  if (!dir) return fallback('Studio has no storage folder');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, emuVsixName(version));
  say(`Downloading ${url}`);
  try {
    const proxy = proxyFor(url, vscode.workspace.getConfiguration('http').get<string>('proxy'));
    const work = (onProgress: (r: number, t: number | undefined) => void, token?: vscode.CancellationToken) => download({ url, dest, proxy, token, onProgress });
    if (a.quiet) await work(() => undefined);
    else {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `CPC Game Studio: downloading CPC Game Studio Emulator ${version}`, cancellable: true }, (progress, token) => {
        let last = 0;
        return work((r, t) => {
          const pct = t ? Math.floor((r / t) * 100) : 0;
          progress.report({ increment: pct - last });
          last = pct;
        }, token);
      });
    }
  } catch (e) {
    return fallback((e as Error).message);
  }
  try {
    await (a.install ?? ((f: vscode.Uri) => vscode.commands.executeCommand('workbench.extensions.installExtension', f)))(vscode.Uri.file(dest));
  } catch (e) {
    const message = `CPC Game Studio: the downloaded emulator package could not be installed: ${(e as Error).message}. It is at ${dest}; use "Extensions: Install from VSIX...".`;
    say(message);
    show('error', message);
    return { ok: false, how: 'download', message, file: dest };
  }
  const message = 'CPC Game Studio: CPC Game Studio Emulator installed. Run the program again.';
  say(message);
  show('info', message);
  return { ok: true, how: 'download', message, file: dest };
}
