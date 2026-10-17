import { describe, expect, it } from 'vitest';
import type { EmuEvent } from '../emuApi';
import { MAX_EMU_EVENTS, recordEmuEvent, state } from './state';

describe('emu event history', () => {
  it('keeps only the last MAX_EMU_EVENTS', () => {
    state.emuEvents.length = 0;
    for (let i = 0; i < MAX_EMU_EVENTS * 3; i++) recordEmuEvent({ session: `s${i}`, event: 'resumed' } as EmuEvent);
    expect(state.emuEvents.length).toBe(MAX_EMU_EVENTS);
    expect(state.emuEvents[0].session).toBe(`s${MAX_EMU_EVENTS * 2}`);
    expect(state.emuEvents.at(-1)?.session).toBe(`s${MAX_EMU_EVENTS * 3 - 1}`);
  });
});
