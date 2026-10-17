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
