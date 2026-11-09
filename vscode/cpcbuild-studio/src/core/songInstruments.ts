/**
 * songInstruments.ts -- the ten built-in instruments of the tracker (ids 1-9 and A).
 *
 * Our own designs, deterministic and easy to change: each is a list of 50 Hz frames (pitch offset in
 * semitones from the played note, tone/noise mixer, noise period, volume) and an optional loop frame.
 * Sound design is reviewed by ear later; edit the number lists below.
 */
import type { SongDoc, SongFrame, SongInstrument } from './songDoc';

const f = (volume: number, pitch = 0, noise?: number): SongFrame => ({ pitch, tone: true, noise: noise !== undefined, noisePeriod: noise ?? 0, volume });
/** Noise only (no tone). */
const n = (volume: number, period: number): SongFrame => ({ pitch: 0, tone: false, noise: true, noisePeriod: period, volume });
const vols = (list: number[], pitch = 0): SongFrame[] => list.map((v) => f(v, pitch));

export const BUILTINS: readonly SongInstrument[] = [
  {
    // a click of noise, then a long decay to silence
    id: '1',
    name: 'Piano',
    colour: 'blue',
    description: 'A soft key press that fades away',
    frames: [f(15, 0, 6), ...vols([15, 14, 13, 12, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1])],
  },
  {
    // quick swell to a steady held level
    id: '2',
    name: 'Organ',
    colour: 'orange',
    description: 'A steady held note, like a church organ',
    frames: vols([7, 11, 13, 13]),
    loop: 3,
  },
  {
    // slow swell, then a gentle two-step shimmer
    id: '3',
    name: 'Strings',
    colour: 'lilac',
    description: 'A slow, smooth swell that keeps going',
    frames: vols([2, 4, 6, 8, 10, 12, 13, 12]),
    loop: 6,
  },
  {
    // bright octave strike, then a long ring that dies away
    id: '4',
    name: 'Bell',
    colour: 'teal',
    description: 'A bright ping that rings out',
    frames: [f(15, 12), f(14, 12), f(13, 7), ...vols([13, 12, 12, 11, 11, 10, 10, 9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1])],
  },
  {
    // root, third, fifth, over and over
    id: '5',
    name: 'Chord',
    colour: 'gold',
    description: 'Three notes of a major chord, played very fast',
    frames: [f(15, 0), f(13, 4), f(13, 7), f(12, 0), f(12, 4), f(12, 7)],
    loop: 3,
  },
  {
    // punchy start, held on a lower level
    id: '6',
    name: 'Bass',
    colour: 'green',
    description: 'A solid, punchy low note',
    frames: vols([15, 15, 14, 13, 12, 12]),
    loop: 5,
  },
  {
    // tone dropping fast with a burst of noise
    id: '7',
    name: 'Kick',
    colour: 'red',
    description: 'A drum thump: the pitch falls fast',
    frames: [f(15, 12, 14), f(15, 6, 10), f(14, 0), f(12, -6), f(10, -12), f(7, -18), f(4, -24), f(2, -30)],
  },
  {
    // noise with a quick tone blip at the start
    id: '8',
    name: 'Snare',
    colour: 'white',
    description: 'A crack of noise with a short blip',
    frames: [f(15, 12, 6), n(14, 6), n(12, 7), n(10, 8), n(8, 9), n(6, 10), n(4, 11), n(2, 12), n(1, 12)],
  },
  {
    // very short, high noise
    id: '9',
    name: 'Hi-hat',
    colour: 'pink',
    description: 'A short, hissy tick',
    frames: [n(10, 1), n(6, 1), n(3, 2), n(1, 2)],
  },
  {
    // fast falling tone, quieter as it goes
    id: 'A',
    name: 'Zap',
    colour: 'violet',
    description: 'A laser-style sweep from high to low',
    frames: [f(15, 24), f(15, 21), f(14, 18), f(14, 15), f(13, 12), f(12, 9), f(11, 6), f(10, 3), f(9, 0), f(8, -3), f(7, -6), f(6, -9), f(5, -12), f(3, -15), f(2, -18), f(1, -21)],
  },
];

/** The instrument with this id (a built-in, else one of the song's); undefined when there is none. */
export function instrumentOf(doc: Pick<SongDoc, 'instruments'>, id: unknown): SongInstrument | undefined {
  return BUILTINS.find((b) => b.id === id) ?? (Array.isArray(doc.instruments) ? doc.instruments.find((i) => i.id === id) : undefined);
}
