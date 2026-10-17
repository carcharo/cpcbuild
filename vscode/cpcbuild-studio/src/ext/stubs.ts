/** stubs.ts -- commands whose features come in later steps: they say so instead of failing. */
import * as vscode from 'vscode';

export const STUB_COMMANDS: Record<string, string> = {
  'cpcbuild.tmx.generate': 'Converting a .tmx map',
  'cpcbuild.openInTiled': 'Opening a map in Tiled',
  'cpcbuild.music.convert': 'Converting music',
  'cpcbuild.music.play': 'Playing music',
  'cpcbuild.music.stop': 'Stopping music',
  'cpcbuild.music.openTracker': 'Opening the Arkos Tracker',
  'cpcbuild.symbols.refresh': 'The symbols view',
  'cpcbuild.watch.add': 'Watch entries',
  'cpcbuild.watch.remove': 'Watch entries',
  'cpcbuild.memory.show': 'The memory view',
  'cpcbuild.debug.pause': 'Debugging through the emulator',
  'cpcbuild.debug.resume': 'Debugging through the emulator',
  'cpcbuild.debug.step': 'Debugging through the emulator',
  'cpcbuild.debug.toggleBreakpoint': 'Debugging through the emulator',
};

export function registerStubs(reg: (id: string, fn: (...a: any[]) => unknown) => void): void {
  for (const [id, what] of Object.entries(STUB_COMMANDS)) {
    reg(id, () => {
      void vscode.window.showInformationMessage(`CPCBuild: ${what} is coming soon.`);
      return { comingSoon: id };
    });
  }
}
