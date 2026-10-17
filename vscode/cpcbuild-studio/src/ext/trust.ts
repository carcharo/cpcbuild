/**
 * trust.ts -- Workspace Trust. In Restricted Mode the editors and viewers still open, but nothing that
 * starts a program or writes generated files runs: build, run, regenerate / generate-on-save, music,
 * Open in Tiled and the tool checks of Check Environment. The settings that name programs and paths
 * are also listed in package.json "restrictedConfigurations", so they read as their defaults.
 */
import * as vscode from 'vscode';

let override: boolean | undefined;
let blocked = 0;
let lastShown = 0;

/** Test hooks (reached through the extension's exports). */
export const trustTestApi = {
  /** Pretend the workspace is (un)trusted; undefined = the real state. */
  set(v: boolean | undefined): void {
    override = v;
    lastShown = 0;
  },
  blocked: (): number => blocked,
  reset(): void {
    blocked = 0;
    lastShown = 0;
  },
};

export function isTrusted(): boolean {
  return override ?? vscode.workspace.isTrusted;
}

/** The sentence for a refused action. */
export function restrictedText(what: string): string {
  return `${what} is disabled in Restricted Mode, because it runs programs named by this workspace's settings and project files. Trust the workspace to enable it.`;
}

/** Tells the user (once every few seconds, never waiting for an answer) and counts the refusal. */
export function notifyUntrusted(what: string): void {
  blocked++;
  const now = Date.now();
  if (now - lastShown < 4000) return;
  lastShown = now;
  void vscode.window.showWarningMessage(`CPCBuild: ${restrictedText(what)}`, 'Manage Workspace Trust').then((c) => {
    if (c) void vscode.commands.executeCommand('workbench.trust.manage');
  });
}

/** True when allowed; otherwise shows the one clear message and returns false. */
export function requireTrust(what: string): boolean {
  if (isTrusted()) return true;
  notifyUntrusted(what);
  return false;
}
