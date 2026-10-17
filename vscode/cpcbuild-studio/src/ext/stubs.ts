/** stubs.ts -- commands whose features come in later steps: they say so instead of failing. */
import * as vscode from 'vscode';

export const STUB_COMMANDS: Record<string, string> = {
  'cpcbuild.music.openTracker': 'Opening the Arkos Tracker',
};

export function registerStubs(reg: (id: string, fn: (...a: any[]) => unknown) => void): void {
  for (const [id, what] of Object.entries(STUB_COMMANDS)) {
    reg(id, () => {
      void vscode.window.showInformationMessage(`CPCBuild: ${what} is coming soon.`);
      return { comingSoon: id };
    });
  }
}

