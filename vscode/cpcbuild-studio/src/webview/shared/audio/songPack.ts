/**
 * songPack.ts -- packs songToFrames output for the worklet's `playSong` message. Pure.
 * Nine ints per tick: periodA, periodB, periodC, noisePeriod, mixer bits (tone A, B, C = 1, 2, 4;
 * noise A, B, C = 8, 16, 32), volumeA, volumeB, volumeC, 0 (spare).
 */
import type { ChannelRegs, SongFrames } from '../../../core/songFrames';

export const SONG_STRIDE = 9;

const tone = (r: ChannelRegs, bit: number): number => (r.tone ? bit : 0);
const noise = (r: ChannelRegs, bit: number): number => (r.noise ? bit : 0);

export function packSong(frames: Pick<SongFrames, 'ticks'>): Int32Array {
  const out = new Int32Array(frames.ticks.length * SONG_STRIDE);
  frames.ticks.forEach((t, i) => {
    const o = i * SONG_STRIDE;
    out[o] = t.a.period;
    out[o + 1] = t.b.period;
    out[o + 2] = t.c.period;
    out[o + 3] = t.noisePeriod;
    out[o + 4] = tone(t.a, 1) | tone(t.b, 2) | tone(t.c, 4) | noise(t.a, 8) | noise(t.b, 16) | noise(t.c, 32);
    out[o + 5] = t.a.volume;
    out[o + 6] = t.b.volume;
    out[o + 7] = t.c.volume;
  });
  return out;
}
