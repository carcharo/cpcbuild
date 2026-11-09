import { describe, expect, it } from 'vitest';
import { BUILTINS, instrumentOf } from './songInstruments';
import {
  INSTRUMENT_COLOURS,
  SongDoc,
  bpmLabel,
  bpmOf,
  describeSongError,
  newSong,
  parseSong,
  serialiseSong,
  songNoteName,
  speedForBpm,
  usedInstrumentIds,
  validateSong,
} from './songDoc';

const text = (doc: unknown): string => JSON.stringify(doc, null, 2) + '\n';
const good = (): SongDoc => ({
  format: 'cpcsong',
  version: 1,
  speed: 6,
  rowsPerBeat: 4,
  patterns: [{ rows: 32, channels: [[{ row: 0, note: 72, inst: '1', vol: 15 }, { row: 28, note: 'off' }], [], []] }],
  order: [0, 0],
  loop: 1,
  instruments: [{ id: 'B', name: 'Pluck', colour: 'peach', description: 'Short bright pluck', frames: [{ pitch: 0, tone: true, noise: false, noisePeriod: 0, volume: 15 }], loop: 0 }],
});
const paths = (d: unknown): string[] => validateSong(d).map((e) => e.path);

describe('song document: tempo helpers', () => {
  it('bpm = 3000 / (speed * rowsPerBeat)', () => {
    expect(bpmOf(6, 4)).toBe(125);
    expect(bpmOf(4, 4)).toBe(187.5);
    expect(bpmOf(7, 4)).toBeCloseTo(107.14, 2);
    expect(bpmOf(6)).toBe(125);
  });
  it('labels have one decimal only when not whole', () => {
    expect(bpmLabel(125)).toBe('125');
    expect(bpmLabel(187.5)).toBe('187.5');
    expect(bpmLabel(bpmOf(7, 4))).toBe('107.1');
  });
  it('speedForBpm picks the nearest reachable speed, ties to the slower one', () => {
    expect(speedForBpm(125, 4)).toBe(6);
    expect(speedForBpm(1000, 4)).toBe(3);
    expect(speedForBpm(1, 4)).toBe(15);
    // 6 -> 125, 5 -> 150: 137.5 is exactly between them
    expect(speedForBpm(137.5, 4)).toBe(6);
    expect(speedForBpm(137.5, 4, 3, 15)).toBe(6);
    expect(speedForBpm(60, 2, 1, 255)).toBe(25);
  });
  it('note names: 60 is C-4, 24 is C-1', () => {
    expect(songNoteName(60)).toBe('C-4');
    expect(songNoteName(24)).toBe('C-1');
    expect(songNoteName(107)).toBe('B-7');
    expect(songNoteName(61)).toBe('C#4');
  });
});

describe('song document: round trip', () => {
  it('serialiseSong(parseSong(t)) is t byte for byte, with unknown keys kept', () => {
    const d = { ...good(), extra: { keep: [1, 2] } } as SongDoc;
    d.patterns[0].channels[0][0] = { ...d.patterns[0].channels[0][0], tag: 'x' } as never;
    const t = text(d);
    const r = parseSong(t);
    expect(r.errors).toEqual([]);
    expect(serialiseSong(r.doc as SongDoc)).toBe(t);
    expect(t.endsWith('}\n')).toBe(true);
  });
  it('newSong is valid', () => {
    expect(validateSong(newSong())).toEqual([]);
    expect(validateSong(good())).toEqual([]);
  });
  it('rowsPerBeat and loop may be absent', () => {
    const d = good() as Partial<SongDoc>;
    delete d.rowsPerBeat;
    delete d.loop;
    expect(validateSong(d)).toEqual([]);
  });
  it('bad JSON and non-objects never throw', () => {
    expect(parseSong('{').doc).toBeNull();
    expect(parseSong('{').errors[0].message).toMatch(/^not valid JSON/);
    for (const v of [null, 5, 'x', [], undefined, { format: 'cpcsong' }, { patterns: 'x', order: {}, instruments: 3 }, { format: 'cpcsong', version: 1, patterns: [null, { rows: 'a', channels: 4 }, { rows: 4, channels: [[null], [5], {}] }], order: [0], instruments: [null] }]) {
      expect(() => validateSong(v)).not.toThrow();
      expect(validateSong(v).length).toBeGreaterThan(0);
    }
  });
});

describe('song document: validation names the field', () => {
  const mut = (f: (d: SongDoc) => void): SongDoc => {
    const d = structuredClone(good());
    f(d);
    return d;
  };
  it('header', () => {
    expect(paths(mut((d) => (d.speed = 0)))).toEqual(['speed']);
    expect(paths(mut((d) => (d.speed = 256)))).toEqual(['speed']);
    expect(paths(mut((d) => (d.speed = 2.5)))).toEqual(['speed']);
    expect(paths(mut((d) => (d.rowsPerBeat = 17)))).toEqual(['rowsPerBeat']);
    expect(paths(mut((d) => (d.version = 2)))).toEqual(['version']);
    expect(paths(mut((d) => (d.loop = 2)))).toEqual(['loop']);
  });
  it('patterns and order', () => {
    expect(paths(mut((d) => (d.patterns = [])))).toContain('patterns');
    expect(paths(mut((d) => (d.patterns = Array.from({ length: 17 }, () => structuredClone(good().patterns[0])))))).toContain('patterns');
    expect(paths(mut((d) => (d.patterns[0].rows = 129)))).toContain('patterns[0].rows');
    expect(paths(mut((d) => (d.patterns[0].channels = [[], []])))).toEqual(['patterns[0].channels']);
    expect(paths(mut((d) => (d.order = [], (d.loop = 0))))).toEqual(['order']);
    expect(paths(mut((d) => (d.order = [0, 1])))).toEqual(['order[1]']);
    expect(paths(mut((d) => (d.order = Array(257).fill(0), (d.loop = 0))))).toEqual(['order']);
  });
  it('events', () => {
    expect(paths(mut((d) => (d.patterns[0].channels[0][1].row = 32)))).toEqual(['patterns[0].channels[0][1].row']);
    expect(paths(mut((d) => (d.patterns[0].channels[0][1].row = 0)))).toEqual(['patterns[0].channels[0][1].row']);
    expect(paths(mut((d) => d.patterns[0].channels[0].reverse()))).toEqual(['patterns[0].channels[0][1].row']);
    expect(paths(mut((d) => (d.patterns[0].channels[0][0].note = 23)))).toEqual(['patterns[0].channels[0][0].note']);
    expect(paths(mut((d) => (d.patterns[0].channels[0][0].note = 108)))).toEqual(['patterns[0].channels[0][0].note']);
    expect(paths(mut((d) => (d.patterns[0].channels[0][0].vol = 16)))).toEqual(['patterns[0].channels[0][0].vol']);
    expect(paths(mut((d) => delete d.patterns[0].channels[0][0].inst))).toEqual(['patterns[0].channels[0][0].inst']);
    expect(paths(mut((d) => (d.patterns[0].channels[0][0].inst = 'Z')))).toEqual(['patterns[0].channels[0][0].inst']);
    expect(describeSongError(validateSong(mut((d) => (d.patterns[0].channels[0][0].inst = 'Z')))[0])).toBe('patterns[0].channels[0][0].inst: no instrument "Z"');
    expect(paths(mut((d) => (d.patterns[0].channels[0][1].inst = '1')))).toEqual(['patterns[0].channels[0][1].inst']);
  });
  it('a note can use a built-in or a custom instrument', () => {
    expect(validateSong(mut((d) => (d.patterns[0].channels[1] = [{ row: 3, note: 60, inst: 'B' }, { row: 4, note: 60, inst: 'A' }])))).toEqual([]);
  });
  it('instruments', () => {
    const inst = (d: SongDoc) => d.instruments[0];
    expect(paths(mut((d) => (inst(d).id = '1')))).toEqual(['instruments[0].id']);
    expect(paths(mut((d) => (inst(d).id = 'A')))).toContain('instruments[0].id');
    expect(paths(mut((d) => (inst(d).id = 'W')))).toContain('instruments[0].id');
    expect(paths(mut((d) => d.instruments.push({ ...structuredClone(inst(d)) })))).toEqual(['instruments[1].id']);
    expect(paths(mut((d) => (inst(d).name = '')))).toEqual(['instruments[0].name']);
    expect(paths(mut((d) => (inst(d).name = 'x'.repeat(25))))).toEqual(['instruments[0].name']);
    expect(paths(mut((d) => ((inst(d) as { colour: string }).colour = 'mauve')))).toEqual(['instruments[0].colour']);
    expect(paths(mut((d) => (inst(d).description = 'x'.repeat(61))))).toEqual(['instruments[0].description']);
    expect(paths(mut((d) => (inst(d).frames = [])))).toContain('instruments[0].frames');
    expect(paths(mut((d) => (inst(d).frames = Array.from({ length: 129 }, () => ({ ...good().instruments[0].frames[0] })))))).toContain('instruments[0].frames');
    expect(paths(mut((d) => (inst(d).frames[0].pitch = 49)))).toEqual(['instruments[0].frames[0].pitch']);
    expect(paths(mut((d) => (inst(d).frames[0].pitch = 1.5)))).toEqual(['instruments[0].frames[0].pitch']);
    expect(paths(mut((d) => (inst(d).frames[0].noisePeriod = 32)))).toEqual(['instruments[0].frames[0].noisePeriod']);
    expect(paths(mut((d) => (inst(d).frames[0].volume = 16)))).toEqual(['instruments[0].frames[0].volume']);
    expect(paths(mut((d) => (inst(d).loop = 1)))).toEqual(['instruments[0].loop']);
    expect(paths(mut((d) => delete inst(d).loop))).toEqual([]);
  });
});

describe('song document: used instruments', () => {
  it('in order of first use: order list, then rows, channels A-C', () => {
    const d = good();
    d.instruments.push({ ...structuredClone(d.instruments[0]), id: 'C' });
    d.patterns = [
      { rows: 8, channels: [[{ row: 2, note: 60, inst: 'C' }], [{ row: 0, note: 60, inst: '4' }, { row: 2, note: 60, inst: '3' }], [{ row: 0, note: 60, inst: '2' }]] },
      { rows: 8, channels: [[{ row: 0, note: 60, inst: '9' }], [], []] },
      { rows: 8, channels: [[{ row: 0, note: 60, inst: '8' }], [], []] },
    ];
    d.order = [1, 0];
    expect(usedInstrumentIds(d)).toEqual(['9', '4', '2', 'C', '3', '8']);
  });
});

describe('built-in instruments', () => {
  it('ten of them, ids 1-9 and A, in order, with the colours of the spec', () => {
    expect(BUILTINS.map((b) => b.id).join('')).toBe('123456789A');
    expect(BUILTINS.map((b) => b.name)).toEqual(['Piano', 'Organ', 'Strings', 'Bell', 'Chord', 'Bass', 'Kick', 'Snare', 'Hi-hat', 'Zap']);
    expect(BUILTINS.map((b) => b.colour)).toEqual(['blue', 'orange', 'lilac', 'teal', 'gold', 'green', 'red', 'white', 'pink', 'violet']);
  });
  it('are valid instruments under 64 frames, with a description, and all different', () => {
    const doc = { ...good(), instruments: [] as SongDoc['instruments'] };
    doc.patterns[0].channels[1] = BUILTINS.map((b, k) => ({ row: k, note: 60, inst: b.id }));
    expect(validateSong(doc)).toEqual([]);
    for (const b of BUILTINS) {
      expect(b.frames.length).toBeGreaterThan(0);
      expect(b.frames.length).toBeLessThan(64);
      expect(b.description.length).toBeGreaterThan(5);
      expect(b.description.length).toBeLessThanOrEqual(60);
      expect(INSTRUMENT_COLOURS).toContain(b.colour);
      if (b.loop !== undefined) expect(b.loop).toBeLessThan(b.frames.length);
    }
    expect(new Set(BUILTINS.map((b) => JSON.stringify(b.frames))).size).toBe(10);
  });
  it('sustained ones loop, plucked ones decay to silence', () => {
    for (const id of ['2', '3', '5', '6']) expect(instrumentOf({ instruments: [] }, id)?.loop).toBeDefined();
    for (const id of ['1', '4', '7', '8', '9', 'A']) expect(instrumentOf({ instruments: [] }, id)?.loop).toBeUndefined();
    expect(instrumentOf({ instruments: [] }, 'B')).toBeUndefined();
    expect(instrumentOf(good(), 'B')?.name).toBe('Pluck');
  });
  it('Chord arpeggiates 0, 4, 7 in its loop; drums use noise', () => {
    const c = instrumentOf({ instruments: [] }, '5')!;
    expect(c.frames.slice(c.loop).map((f) => f.pitch)).toEqual([0, 4, 7]);
    for (const id of ['7', '8', '9']) expect(instrumentOf({ instruments: [] }, id)!.frames.some((f) => f.noise)).toBe(true);
    expect(instrumentOf({ instruments: [] }, '9')!.frames.every((f) => !f.tone)).toBe(true);
  });
});
