import { describe, expect, it } from 'vitest';
import type { EmuEvent } from '../emuApi';
import { chooseTarget, chosenTarget, MAX_EMU_EVENTS, recordEmuEvent, setTargetStore, state } from './state';

describe('emu event history', () => {
  it('keeps only the last MAX_EMU_EVENTS', () => {
    state.emuEvents.length = 0;
    for (let i = 0; i < MAX_EMU_EVENTS * 3; i++) recordEmuEvent({ session: `s${i}`, event: 'resumed' } as EmuEvent);
    expect(state.emuEvents.length).toBe(MAX_EMU_EVENTS);
    expect(state.emuEvents[0].session).toBe(`s${MAX_EMU_EVENTS * 2}`);
    expect(state.emuEvents.at(-1)?.session).toBe(`s${MAX_EMU_EVENTS * 3 - 1}`);
  });
});

describe('chosen target', () => {
  it('is kept per project root in the store', async () => {
    const m = new Map<string, unknown>();
    setTargetStore({ get: <T>(k: string) => m.get(k) as T | undefined, update: async (k, v) => void m.set(k, v) });
    expect(chosenTarget('/a')).toBeUndefined();
    await chooseTarget('/a', 'main');
    await chooseTarget('/b', 'tap');
    expect(chosenTarget('/a')).toBe('main');
    expect(chosenTarget('/b')).toBe('tap');
    setTargetStore(undefined);
    expect(chosenTarget('/a')).toBeUndefined();
  });
});
