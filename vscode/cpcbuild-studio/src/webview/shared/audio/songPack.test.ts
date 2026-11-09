import { describe, expect, it } from 'vitest';
import type { TickRegs } from '../../../core/songFrames';
import { packSong, SONG_STRIDE } from './songPack';

const ch = (period: number, tone: boolean, noise: boolean, volume: number) => ({ period, tone, noise, volume });

describe('packSong', () => {
  it('writes nine ints per tick: periods, noise period, mixer bits, volumes', () => {
    const ticks: TickRegs[] = [
      { a: ch(239, true, false, 15), b: ch(142, false, true, 7), c: ch(0, true, true, 0), noisePeriod: 9 },
      { a: ch(1, false, false, 0), b: ch(4095, true, false, 3), c: ch(80, false, true, 1), noisePeriod: 31 },
    ];
    const r = packSong({ ticks });
    expect(SONG_STRIDE).toBe(9);
    expect(Array.from(r)).toEqual([
      239, 142, 0, 9, 1 | 16 | 4 | 32, 15, 7, 0, 0,
      1, 4095, 80, 31, 2 | 32, 0, 3, 1, 0,
    ]);
  });
});
