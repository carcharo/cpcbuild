/**
 * songDemo.ts -- the short song "CPC Game Studio: New Song" starts a file with: one pattern, a melody on
 * channel B (Piano), a bass line on C (Bass) and a Hi-hat on A every beat. Pure.
 */
import { DEFAULT_RPB, SONG_FORMAT, SONG_VERSION, type SongDoc, type SongEvent } from './songDoc';

const note = (row: number, n: number, inst: string): SongEvent => ({ row, note: n, inst });

export function demoSong(): SongDoc {
  const hat: SongEvent[] = [];
  for (let row = 0; row < 32; row += 4) hat.push(note(row, 60, '9'));
  const melody = [[0, 72], [2, 76], [4, 79], [8, 77], [10, 74], [12, 76], [16, 72], [18, 76], [20, 79], [24, 84], [28, 79]].map(([r, n]) => note(r, n, '1'));
  const bass = [[0, 36], [8, 41], [16, 43], [24, 36]].map(([r, n]) => note(r, n, '6'));
  return {
    format: SONG_FORMAT,
    version: SONG_VERSION,
    speed: 6,
    rowsPerBeat: DEFAULT_RPB,
    patterns: [{ rows: 32, channels: [hat, melody, bass] }],
    order: [0],
    loop: 0,
    instruments: [],
  };
}
