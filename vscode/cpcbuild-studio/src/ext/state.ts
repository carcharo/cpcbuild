import type { BuildResult } from './build';
import type { EmuEvent } from '../emuApi';

/** The most emulator events kept for the extension-host tests' `emuEvents()`; older ones are dropped. */
export const MAX_EMU_EVENTS = 100;

export const state: {
  lastBuild?: BuildResult;
  emuEvents: EmuEvent[];
} = { emuEvents: [] };

/** Remembers an emulator event, keeping only the last MAX_EMU_EVENTS (a long session must not grow without bound). */
export function recordEmuEvent(ev: EmuEvent): void {
  state.emuEvents.push(ev);
  if (state.emuEvents.length > MAX_EMU_EVENTS) state.emuEvents.splice(0, state.emuEvents.length - MAX_EMU_EVENTS);
}

/** The part of vscode.Memento the target choice needs (so this file stays unit-testable). */
export interface TargetStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

let targetStore: TargetStore | undefined;
const targetKey = (root: string): string => `cpcbuild.target:${root}`;

/** Where "Select Target" keeps its choice: workspaceState, so nothing is written into the project folder. */
export function setTargetStore(store: TargetStore | undefined): void {
  targetStore = store;
}

/** The target picked with "Select Target" for the project in `root`, if any. */
export function chosenTarget(root: string): string | undefined {
  return targetStore?.get<string>(targetKey(root)) || undefined;
}

export function chooseTarget(root: string, id: string): PromiseLike<void> {
  return targetStore ? targetStore.update(targetKey(root), id) : Promise.resolve();
}
