/** Pure helpers for the emulator page chrome (no DOM, no vscode): testable under plain node. */

/** The keycaps that leave the keyboard trap: Windows keeps Ctrl+Shift+Esc for Task Manager. */
export function leaveKeys(platform: string): string[] {
  return ['Ctrl', 'Shift', platform === 'win32' ? 'F6' : 'Esc'];
}

/** "Ctrl+Shift+Esc" */
export const leaveKeyText = (platform: string): string => leaveKeys(platform).join('+');

export interface RunInfo {
  paused: boolean;
  suspended: boolean;
  pc: number;
  program?: string;
}
export interface RunLabel {
  text: string;
  tone: 'none' | 'ok' | 'warn';
}

const hex4 = (n: number): string => '&' + n.toString(16).toUpperCase().padStart(4, '0');

/** The run-state chip: the dot is drawn separately, the text always says the state. */
export function runLabel(s: RunInfo | undefined): RunLabel {
  if (!s) return { text: 'No program loaded', tone: 'none' };
  if (s.paused) return { text: `Paused at ${hex4(s.pc)}`, tone: 'warn' };
  if (s.suspended) return { text: 'Suspended', tone: 'warn' };
  return { text: s.program ? `Running · ${s.program}` : 'Running', tone: 'ok' };
}

/**
 * The size of the CPC canvas inside `availW` x `availH` pixels of room (the stage minus the frame's padding and border).
 * Integer scale when that wastes under 15 percent (crisp pixels), else fill.
 */
export function fitSize(availW: number, availH: number, W: number, H: number): { width: number; height: number } | undefined {
  if (availW <= 0 || availH <= 0) return undefined;
  let s = Math.min(availW / W, availH / H);
  if (s >= 1 && Math.floor(s) / s >= 0.85) s = Math.floor(s);
  return { width: Math.floor(W * s), height: Math.floor(H * s) };
}
