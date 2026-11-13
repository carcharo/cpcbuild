/**
 * setupPrompts.ts -- where the setup experience is offered: the "Download Arkos Tools" button, the walkthrough
 * and its completion context key. (The compiler is part of the extension, so there is no compiler to offer.) The UI is replaceable in tests (nothing in the extension host may wait for a click).
 */
import * as vscode from 'vscode';
import { DOWNLOAD_ARKOS_BUTTON, Once } from '../core/setup';
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
  notifyArkosMissing: (message: string): Promise<void> => notifyArkosMissing(message),
};

/** Convert Music found no Arkos tools. */
export function notifyArkosMissing(message: string): Promise<void> {
  return offer('error', `CPC Game Studio: ${message}`, [DOWNLOAD_ARKOS_BUTTON], () => vscode.commands.executeCommand('cpcbuild.downloadTools', { parts: ['arkos'] }));
}

async function emuAnswers(): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('cpcbuild.emu.version');
    return true;
  } catch {
    return false;
  }
}

/** Sets the context key the walkthrough step completes on: cpcbuild.emuInstalled. */
export async function updateSetupContext(): Promise<void> {
  void vscode.commands.executeCommand('setContext', 'cpcbuild.emuInstalled', await emuAnswers());
}
