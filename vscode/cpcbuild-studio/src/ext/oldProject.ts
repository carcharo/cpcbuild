/**
 * oldProject.ts -- a project made with CPCBuild 0.1.x (it has Spectrum targets, so cpcbuild.json does not load) gets
 * one message per workspace that offers Convert Project to CPC BASIC. Nothing is written without the click there.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { OLD_PROJECT_CONVERT, oldProjectNotice } from '../core/project';

const SEEN_KEY = 'cpcbuild.oldProjectNotice';
const shown: string[] = [];
let answer: ((message: string, ...buttons: string[]) => Thenable<string | undefined>) | undefined;

/** The project's `name`, else its folder's. */
function projectName(file: string): string {
  try {
    const n = (JSON.parse(fs.readFileSync(file, 'utf8')) as { name?: unknown }).name;
    if (typeof n === 'string' && n) return n;
  } catch {
    /* the folder's name will do */
  }
  return path.basename(path.dirname(file));
}

/** Shows the message once per workspace (`store` is workspaceState). Returns true when it was shown. */
export async function offerOldProjectNotice(store: Pick<vscode.Memento, 'get' | 'update'>, file: string): Promise<boolean> {
  if (store.get<boolean>(SEEN_KEY)) return false;
  await store.update(SEEN_KEY, true);
  const message = oldProjectNotice(projectName(file));
  shown.push(message);
  void (answer ?? ((m, ...b) => vscode.window.showInformationMessage(m, ...b)))(message, OLD_PROJECT_CONVERT, 'Not Now').then((pick) => {
    if (pick === OLD_PROJECT_CONVERT) void vscode.commands.executeCommand('cpcbuild.convertProject', vscode.Uri.file(file));
  });
  return true;
}

/** Test hooks (reached through the extension's exports). */
export const oldProjectTestApi = {
  setUi(u: typeof answer): void {
    answer = u;
  },
  shown: (): string[] => [...shown],
  reset(): void {
    shown.length = 0;
  },
  offer: offerOldProjectNotice,
};
