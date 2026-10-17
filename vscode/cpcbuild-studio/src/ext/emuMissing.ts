/**
 * emuMissing.ts -- what to say when the CPCBuild Emulator extension is not installed but the
 * emulator setting asks for it: one warning per session (never one per Run), with two ways out.
 * No warning at all when the setting already names an external emulator (run.ts never gets here then).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export const INSTALL_BUTTON = 'Install CPCBuild Emulator';
export const EXTERNAL_BUTTON = 'Use external emulator';
export const EMU_EXTENSION_ID = 'cpcbuild.cpcbuild-emu';

export type ExternalChoice = 'caprice32' | 'cpcec' | 'rvm';

/** How the warning is shown: replaceable in tests (nothing in the extension host may wait for a click). */
export interface WarnUi {
  warn(message: string, ...buttons: string[]): Thenable<string | undefined>;
}

const realUi: WarnUi = { warn: (m, ...b) => vscode.window.showWarningMessage(m, ...b) };
let ui: WarnUi = realUi;
let warned = false;
let shownCount = 0;

/** Test hooks (reached through the extension's exports; the module is bundled, so tests cannot import it). */
export const emuMissingTestApi = {
  setUi(u: WarnUi | undefined): void {
    ui = u ?? realUi;
  },
  reset(): void {
    warned = false;
    shownCount = 0;
  },
  shown: (): number => shownCount,
};

/** The newest cpcbuild-emu .vsix of a local cpcbuild checkout, if there is one. */
export function findLocalVsix(library: string | undefined): string | undefined {
  if (!library) return undefined;
  const dir = path.join(library, 'vscode', 'cpcbuild-emu');
  try {
    const f = fs.readdirSync(dir).filter((n) => /^cpcbuild-emu-.*\.vsix$/.test(n)).sort().pop();
    return f ? path.join(dir, f) : undefined;
  } catch {
    return undefined;
  }
}

export interface MissingContext {
  /** Why the extension cannot be used ("... is not installed, so its commands are missing"). */
  why: string;
  /** The best external emulator the doctor can find, if any. */
  external?: ExternalChoice;
  library?: string;
}

async function setEmulator(choice: ExternalChoice): Promise<void> {
  const target = vscode.workspace.workspaceFolders ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('cpcbuild').update('run.emulator', choice, target);
}

/** Shows the warning the first time in a session; later calls do nothing. Resolves when the user has answered (or at once on repeats). */
export async function notifyEmuMissing(c: MissingContext): Promise<void> {
  if (warned) return;
  warned = true;
  shownCount++;
  const used = c.external ? ` Running in ${c.external} this time.` : '';
  const buttons = [INSTALL_BUTTON, ...(c.external ? [EXTERNAL_BUTTON] : [])];
  const pick = await ui.warn(`CPCBuild: ${c.why}.${used} CPCBuild Emulator runs the program in an editor tab and adds the debugger.`, ...buttons);
  if (pick === INSTALL_BUTTON) {
    const vsix = findLocalVsix(c.library);
    if (vsix) {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(vsix));
      void vscode.window.showInformationMessage(`CPCBuild: the emulator package is ${vsix}. Install it with "Extensions: Install from VSIX..." from the Extensions view menu.`);
    } else {
      await vscode.commands.executeCommand('workbench.extensions.search', `@id:${EMU_EXTENSION_ID}`);
    }
  } else if (pick === EXTERNAL_BUTTON && c.external) {
    await setEmulator(c.external);
  }
}
