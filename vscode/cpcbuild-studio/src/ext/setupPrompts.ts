/**
 * setupPrompts.ts -- where the setup experience is offered: the one-per-session notification at activation when no
 * compiler resolves, the "Download Tools" button on a build failure, the "Download Arkos Tools" button, the walkthrough
 * and its completion context keys. The UI is replaceable in tests (nothing in the extension host may wait for a click).
 */
import * as vscode from 'vscode';
import { DOWNLOAD_ARKOS_BUTTON, DOWNLOAD_TOOLS_BUTTON, GET_STARTED_BUTTON, NO_COMPILER_TEXT, NOT_NOW_BUTTON, Once } from '../core/setup';
import type { BuildResult } from './build';
import { readSettings, resolveCompilerFor } from './config';
import { findProjects, pickProject } from './projects';

export interface PromptUi {
  show(kind: 'info' | 'warn' | 'error', message: string, ...buttons: string[]): Thenable<string | undefined>;
}

const realUi: PromptUi = {
  show: (kind, m, ...b) => (kind === 'info' ? vscode.window.showInformationMessage(m, ...b) : kind === 'warn' ? vscode.window.showWarningMessage(m, ...b) : vscode.window.showErrorMessage(m, ...b)),
};
let ui: PromptUi = realUi;
const once = new Once();
const shown: { message: string; buttons: string[] }[] = [];

export const WALKTHROUGH_ID = 'cpcbuild.getStarted';
let extensionId = 'cpcbuild.cpcbuild-studio';
export function setStudioExtensionId(id: string): void {
  extensionId = id;
}
const openWalkthrough = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.openWalkthrough', `${extensionId}#${WALKTHROUGH_ID}`, false);

/** A real or stubbed UI; the pick is acted on in both. */
async function offer(kind: 'info' | 'warn' | 'error', message: string, buttons: string[], act: (pick: string) => Thenable<unknown> | void): Promise<void> {
  shown.push({ message, buttons });
  const pick = await ui.show(kind, message, ...buttons);
  if (pick) await act(pick);
}

/** Test hooks (reached through the extension's exports). */
export const setupTestApi = {
  setUi(u: PromptUi | undefined): void {
    ui = u ?? realUi;
  },
  reset(): void {
    once.reset();
    shown.length = 0;
  },
  shown: (): { message: string; buttons: string[] }[] => [...shown],
  /** Runs the activation check (the real activation skips it in the extension-host tests). */
  offerToolsAtActivation: (): Promise<boolean> => offerToolsAtActivation(),
  notifyBuildFailure: (res: BuildResult): Promise<void> => notifyBuildFailure(res),
  notifyArkosMissing: (message: string): Promise<void> => notifyArkosMissing(message),
};

/** One notification per session when no compiler resolves. Returns true when it was shown. */
export async function offerToolsAtActivation(): Promise<boolean> {
  const lp = pickProject(await findProjects());
  const base = lp?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const comp = resolveCompilerFor(base, readSettings(lp?.root));
  // a wrong explicit setting is reported by Build and Check Environment, not guessed over here
  if (comp.kind !== 'none' || comp.problem) return false;
  if (!once.first('activation')) return false;
  void offer('info', NO_COMPILER_TEXT, [DOWNLOAD_TOOLS_BUTTON, GET_STARTED_BUTTON, NOT_NOW_BUTTON], (p) =>
    p === DOWNLOAD_TOOLS_BUTTON ? vscode.commands.executeCommand('cpcbuild.downloadTools') : p === GET_STARTED_BUTTON ? openWalkthrough() : undefined,
  );
  return true;
}

/** A failed build whose compiler was not found gets a notification with "Download Tools" (other failures stay in the output). */
export function notifyBuildFailure(res: BuildResult): Promise<void> {
  if (res.ok || !res.compilerMissing) return Promise.resolve();
  return offer('error', `CPCBuild: ${res.message ?? 'the compiler was not found.'}`, [DOWNLOAD_TOOLS_BUTTON], () => vscode.commands.executeCommand('cpcbuild.downloadTools'));
}

/** Convert Music found no Arkos tools. */
export function notifyArkosMissing(message: string): Promise<void> {
  return offer('error', `CPCBuild: ${message}`, [DOWNLOAD_ARKOS_BUTTON], () => vscode.commands.executeCommand('cpcbuild.downloadTools', { parts: ['arkos'] }));
}

async function emuAnswers(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('cpcbuild.emu.version');
    return true;
  } catch {
    return false;
  }
}

/** Sets the context keys the walkthrough steps complete on: cpcbuild.toolsInstalled and cpcbuild.emuInstalled. */
export async function updateSetupContext(): Promise<void> {
  const lp = pickProject(await findProjects());
  const base = lp?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
  const comp = resolveCompilerFor(base, readSettings(lp?.root));
  void vscode.commands.executeCommand('setContext', 'cpcbuild.toolsInstalled', comp.kind !== 'none');
  void vscode.commands.executeCommand('setContext', 'cpcbuild.emuInstalled', await emuAnswers());
}
