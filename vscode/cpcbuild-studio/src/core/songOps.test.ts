import { describe, expect, it } from 'vitest';
import { SongDoc, SongInstrument, newSong, validateSong } from './songDoc';
import { SongOp, applySongOp } from './songOps';

const ok = (doc: SongDoc, op: SongOp): SongDoc => {
  const before = JSON.stringify(doc);
  const r = applySongOp(doc, op);
  if ('error' in r) throw new Error(r.error);
  expect(JSON.stringify(doc)).toBe(before); // never mutates
  expect(validateSong(r.state)).toEqual([]);
  expect(r.label.length).toBeGreaterThan(2);
  return r.state;
};
const err = (doc: SongDoc, op: SongOp): string => {
  const r = applySongOp(doc, op);
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
};
const label = (doc: SongDoc, op: SongOp): string => {
  const r = applySongOp(doc, op);
  if ('error' in r) throw new Error(r.error);
  return r.label;
};
const song = (): SongDoc => {
  const d = newSong();
  d.patterns = [
    { rows: 16, channels: [[{ row: 0, note: 60, inst: '1' }, { row: 4, note: 'off' }, { row: 8, note: 106, inst: '6', vol: 7 }], [{ row: 2, note: 25, inst: '2' }], []] },
    { rows: 8, channels: [[], [], [{ row: 1, note: 70, inst: '9' }]] },
    { rows: 8, channels: [[], [], []] },
  ];
  d.order = [0, 1, 2, 1];
  d.loop = 2;
  return d;
};

describe('song ops: cells', () => {
  it('setCell puts an event in sorted place, replaces one on the same row, and clears with null', () => {
    let d = ok(song(), { op: 'setCell', pattern: 0, channel: 0, row: 2, event: { note: 64, inst: '3' } });
    expect(d.patterns[0].channels[0].map((e) => e.row)).toEqual([0, 2, 4, 8]);
    d = ok(d, { op: 'setCell', pattern: 0, channel: 0, row: 2, event: { note: 'off' } });
    expect(d.patterns[0].channels[0][1]).toEqual({ row: 2, note: 'off' });
    d = ok(d, { op: 'setCell', pattern: 0, channel: 0, row: 2, event: null });
    expect(d.patterns[0].channels[0].map((e) => e.row)).toEqual([0, 4, 8]);
  });
  it('a volume of 15 is the default and is not stored; an off carries nothing else', () => {
    const d = ok(song(), { op: 'setCell', pattern: 1, channel: 0, row: 0, event: { note: 60, inst: 'A', vol: 15 } });
    expect(d.patterns[1].channels[0][0]).toEqual({ row: 0, note: 60, inst: 'A' });
    const o = ok(d, { op: 'setCell', pattern: 1, channel: 0, row: 0, event: { note: 'off', inst: 'A', vol: 3 } });
    expect(o.patterns[1].channels[0][0]).toEqual({ row: 0, note: 'off' });
  });
  it('refuses bad cells and says unchanged', () => {
    const d = song();
    expect(err(d, { op: 'setCell', pattern: 9, channel: 0, row: 0, event: null })).toBe('no pattern 9');
    expect(err(d, { op: 'setCell', pattern: 0, channel: 3, row: 0, event: null })).toBe('channels are 0-2');
    expect(err(d, { op: 'setCell', pattern: 0, channel: 0, row: 16, event: null })).toBe('rows are 0-15');
    expect(err(d, { op: 'setCell', pattern: 0, channel: 0, row: 1, event: { note: 20, inst: '1' } })).toMatch(/24-107/);
    expect(err(d, { op: 'setCell', pattern: 0, channel: 0, row: 1, event: { note: 60, inst: 'Q' } })).toBe('no instrument "Q"');
    expect(err(d, { op: 'setCell', pattern: 0, channel: 0, row: 1, event: { note: 60 } })).toMatch(/no instrument/);
    expect(err(d, { op: 'setCell', pattern: 0, channel: 0, row: 1, event: null })).toBe('unchanged');
  });
  it('setCells pastes a block, clipped to the pattern and the channels, and null clears', () => {
    const block = [
      [{ note: 60, inst: '1' }, null, { note: 62, inst: '1' }],
      [null, { note: 'off' as const }],
      [{ note: 64, inst: '1' }],
    ];
    const d = ok(song(), { op: 'setCells', pattern: 1, channel: 1, row: 6, events: block });
    expect(d.patterns[1].channels[1]).toEqual([{ row: 6, note: 60, inst: '1' }]); // 62 would land on row 8, outside the pattern
    expect(d.patterns[1].channels[2].map((e) => e.row)).toEqual([1, 7]); // [null, off] at rows 6,7: row 7 off; row 1 kept
    const cleared = ok(song(), { op: 'setCells', pattern: 0, channel: 0, row: 0, events: [[null, null, null, null, null]] });
    expect(cleared.patterns[0].channels[0].map((e) => e.row)).toEqual([8]);
    expect(label(song(), { op: 'setCells', pattern: 1, channel: 0, row: 0, events: [[{ note: 60, inst: '1' }]], label: 'Paste cells' })).toBe('Paste cells');
  });
  it('clearRange clears events inside the box only', () => {
    const d = ok(song(), { op: 'clearRange', pattern: 0, ch0: 0, ch1: 1, row0: 1, row1: 8 });
    expect(d.patterns[0].channels[0].map((e) => e.row)).toEqual([0]);
    expect(d.patterns[0].channels[1]).toEqual([]);
    expect(err(song(), { op: 'clearRange', pattern: 0, ch0: 2, ch1: 2, row0: 0, row1: 15 })).toBe('unchanged');
    expect(err(song(), { op: 'clearRange', pattern: 0, ch0: 1, ch1: 0, row0: 0, row1: 1 })).toBe('channels are 0-2');
  });
  it('transpose moves notes, clamps to 24-107 and leaves offs alone', () => {
    const up = ok(song(), { op: 'transpose', pattern: 0, ch0: 0, ch1: 1, row0: 0, row1: 15, semitones: 5 });
    expect(up.patterns[0].channels[0].map((e) => e.note)).toEqual([65, 'off', 107]);
    expect(up.patterns[0].channels[1][0].note).toBe(30);
    const down = ok(song(), { op: 'transpose', pattern: 0, ch0: 0, ch1: 1, row0: 0, row1: 15, semitones: -12 });
    expect(down.patterns[0].channels[1][0].note).toBe(24);
    expect(down.patterns[0].channels[0][0].note).toBe(48);
    expect(err(song(), { op: 'transpose', pattern: 0, ch0: 0, ch1: 0, row0: 0, row1: 15, semitones: 0 })).toBe('unchanged');
    expect(err(song(), { op: 'transpose', pattern: 0, ch0: 0, ch1: 0, row0: 4, row1: 4, semitones: 3 })).toBe('unchanged'); // only an off
  });
});

describe('song ops: patterns', () => {
  it('addPattern uses the length of the last pattern; copyPattern is a deep copy at the end', () => {
    let d = ok(song(), { op: 'addPattern' });
    expect(d.patterns).toHaveLength(4);
    expect(d.patterns[3]).toEqual({ rows: 8, channels: [[], [], []] });
    d = ok(song(), { op: 'copyPattern', index: 0 });
    expect(d.patterns[3]).toEqual(song().patterns[0]);
    expect(d.patterns[3].channels[0][0]).not.toBe(d.patterns[0].channels[0][0]);
  });
  it('at most 16 patterns', () => {
    let d = song();
    while (d.patterns.length < 16) d = ok(d, { op: 'addPattern' });
    expect(err(d, { op: 'addPattern' })).toBe('a song has at most 16 patterns');
    expect(err(d, { op: 'copyPattern', index: 0 })).toBe('a song has at most 16 patterns');
  });
  it('deletePattern removes its order entries, shifts later indices and clamps the loop', () => {
    const d = ok(song(), { op: 'deletePattern', index: 1 });
    expect(d.patterns).toHaveLength(2);
    expect(d.order).toEqual([0, 1]); // 0, (1 gone), 2 -> 1, (1 gone)
    expect(d.loop).toBe(1); // the loop pointed at entry 2 (pattern 2) which is now entry 1
    const e = ok(song(), { op: 'deletePattern', index: 2 });
    expect(e.order).toEqual([0, 1, 1]);
    expect(e.loop).toBe(2);
    const f = ok({ ...song(), loop: 3 }, { op: 'deletePattern', index: 0 });
    expect(f.order).toEqual([0, 1, 0]);
    expect(f.loop).toBe(2);
  });
  it('refuses the last pattern, and an order that would be empty', () => {
    const one = newSong();
    expect(err(one, { op: 'deletePattern', index: 0 })).toBe('a song needs at least one pattern');
    const d = { ...song(), order: [2], loop: 0 };
    expect(err(d, { op: 'deletePattern', index: 2 })).toMatch(/order would be empty/);
    expect(err(song(), { op: 'deletePattern', index: 7 })).toBe('no pattern 7');
  });
  it('setRows drops events beyond the new length', () => {
    const d = ok(song(), { op: 'setRows', pattern: 0, rows: 5 });
    expect(d.patterns[0].rows).toBe(5);
    expect(d.patterns[0].channels[0].map((e) => e.row)).toEqual([0, 4]);
    const g = ok(song(), { op: 'setRows', pattern: 1, rows: 128 });
    expect(g.patterns[1].rows).toBe(128);
    expect(err(song(), { op: 'setRows', pattern: 0, rows: 129 })).toBe('a pattern has 1-128 rows');
    expect(err(song(), { op: 'setRows', pattern: 0, rows: 16 })).toBe('unchanged');
  });
  it('speed and rows per beat', () => {
    expect(ok(song(), { op: 'setSpeed', speed: 4 }).speed).toBe(4);
    expect(err(song(), { op: 'setSpeed', speed: 0 })).toBe('speed is 1-255');
    expect(ok(song(), { op: 'setRowsPerBeat', rowsPerBeat: 8 }).rowsPerBeat).toBe(8);
    expect(err(song(), { op: 'setRowsPerBeat', rowsPerBeat: 17 })).toBe('rows per beat is 1-16');
  });
});

describe('song ops: order', () => {
  it('orderAdd appends or inserts and keeps the loop on its entry', () => {
    expect(ok(song(), { op: 'orderAdd', pattern: 2 }).order).toEqual([0, 1, 2, 1, 2]);
    const d = ok(song(), { op: 'orderAdd', pattern: 0, at: 1 });
    expect(d.order).toEqual([0, 0, 1, 2, 1]);
    expect(d.loop).toBe(3);
    expect(ok(song(), { op: 'orderAdd', pattern: 0, at: 3 }).loop).toBe(2);
    expect(err(song(), { op: 'orderAdd', pattern: 5 })).toBe('no pattern 5');
    expect(err(song(), { op: 'orderAdd', pattern: 0, at: 9 })).toBe('no position 9');
  });
  it('at most 256 entries', () => {
    const d = { ...song(), order: Array(256).fill(0), loop: 0 };
    expect(err(d, { op: 'orderAdd', pattern: 0 })).toBe('the order has at most 256 entries');
  });
  it('orderRemove refuses the last entry and moves the loop', () => {
    const d = ok(song(), { op: 'orderRemove', at: 0 });
    expect(d.order).toEqual([1, 2, 1]);
    expect(d.loop).toBe(1);
    expect(ok(song(), { op: 'orderRemove', at: 3 }).loop).toBe(2);
    expect(ok({ ...song(), loop: 3 }, { op: 'orderRemove', at: 3 }).loop).toBe(2);
    expect(err({ ...song(), order: [0], loop: 0 }, { op: 'orderRemove', at: 0 })).toBe('the order needs at least one entry');
  });
  it('orderMove keeps the loop on the entry it was on; setLoop', () => {
    const d = ok(song(), { op: 'orderMove', from: 2, to: 0 });
    expect(d.order).toEqual([2, 0, 1, 1]);
    expect(d.loop).toBe(0);
    const e = ok(song(), { op: 'orderMove', from: 0, to: 3 });
    expect(e.order).toEqual([1, 2, 1, 0]);
    expect(e.loop).toBe(1);
    expect(err(song(), { op: 'orderMove', from: 1, to: 1 })).toBe('unchanged');
    expect(ok(song(), { op: 'setLoop', at: 0 }).loop).toBe(0);
    expect(err(song(), { op: 'setLoop', at: 4 })).toBe('no position 4');
  });
});

describe('song ops: instruments', () => {
  it('addInstrument copies a built-in into the next free id with a "copy" name', () => {
    let d = ok(song(), { op: 'addInstrument', fromId: '5' });
    expect(d.instruments).toHaveLength(1);
    expect(d.instruments[0]).toMatchObject({ id: 'B', name: 'Chord copy', colour: 'gold', loop: 3 });
    expect(d.instruments[0].frames).toHaveLength(6);
    d = ok(d, { op: 'addInstrument', fromId: 'B' });
    expect(d.instruments.map((i) => [i.id, i.name])).toEqual([['B', 'Chord copy'], ['C', 'Chord copy copy']]);
    d = ok(d, { op: 'deleteInstrument', id: 'B' });
    expect(ok(d, { op: 'addInstrument', fromId: '1' }).instruments.map((i) => i.id)).toEqual(['C', 'B']);
    expect(err(song(), { op: 'addInstrument', fromId: 'Z' })).toBe('no instrument "Z"');
  });
  it('a copied name stays within 24 characters', () => {
    let d = ok(song(), { op: 'addInstrument', fromId: '1' });
    d = ok(d, { op: 'updateInstrument', id: 'B', patch: { name: 'x'.repeat(24) } });
    expect(ok(d, { op: 'addInstrument', fromId: 'B' }).instruments[1].name).toBe(`${'x'.repeat(19)} copy`);
  });
  it('at most 21 custom instruments', () => {
    let d = song();
    for (let k = 0; k < 21; k++) d = ok(d, { op: 'addInstrument', fromId: '1' });
    expect(d.instruments.map((i) => i.id).join('')).toBe('BCDEFGHIJKLMNOPQRSTUV');
    expect(err(d, { op: 'addInstrument', fromId: '1' })).toBe('a song has at most 21 custom instruments');
  });
  it('updateInstrument patches fields, validates, and refuses built-ins', () => {
    const d0 = ok(song(), { op: 'addInstrument', fromId: '5' });
    const d = ok(d0, { op: 'updateInstrument', id: 'B', patch: { name: 'Mine', colour: 'grey', description: 'my sound', loop: null } });
    expect(d.instruments[0]).toMatchObject({ name: 'Mine', colour: 'grey', description: 'my sound' });
    expect('loop' in d.instruments[0]).toBe(false);
    const frames: SongInstrument['frames'] = [{ pitch: 3, tone: true, noise: false, noisePeriod: 0, volume: 9 }];
    const e = ok(d, { op: 'updateInstrument', id: 'B', patch: { frames, loop: 0 } });
    expect(e.instruments[0].frames).toEqual(frames);
    expect(e.instruments[0].frames[0]).not.toBe(frames[0]);
    expect(err(d0, { op: 'updateInstrument', id: 'B', patch: { name: '' } })).toBe('instruments[0].name: name must be 1-24 characters');
    expect(err(d0, { op: 'updateInstrument', id: 'B', patch: { loop: 9 } })).toMatch(/^instruments\[0\]\.loop/);
    expect(err(d0, { op: 'updateInstrument', id: 'B', patch: { frames: [] } })).toMatch(/^instruments\[0\]\.frames/);
    expect(err(d0, { op: 'updateInstrument', id: 'B', patch: { name: 'Chord copy' } })).toBe('unchanged');
    expect(err(d0, { op: 'updateInstrument', id: '1', patch: { name: 'x' } })).toMatch(/built-in/);
    expect(err(d0, { op: 'updateInstrument', id: 'Q', patch: { name: 'x' } })).toBe('no instrument "Q"');
  });
  it('deleteInstrument refuses while used and names the first use', () => {
    let d = ok(song(), { op: 'addInstrument', fromId: '1' });
    d = ok(d, { op: 'setCell', pattern: 1, channel: 2, row: 5, event: { note: 60, inst: 'B' } });
    d = ok(d, { op: 'setCell', pattern: 1, channel: 1, row: 3, event: { note: 60, inst: 'B' } });
    expect(err(d, { op: 'deleteInstrument', id: 'B' })).toBe('instrument B (Piano copy) is used at pattern B, channel B, row 3');
    d = ok(d, { op: 'clearRange', pattern: 1, ch0: 1, ch1: 2, row0: 3, row1: 5 });
    expect(ok(d, { op: 'deleteInstrument', id: 'B' }).instruments).toEqual([]);
    expect(err(d, { op: 'deleteInstrument', id: '1' })).toMatch(/built-in/);
  });
});

describe('song ops: labels', () => {
  it('each op has a short undo label', () => {
    const d = song();
    expect(label(d, { op: 'setCell', pattern: 0, channel: 0, row: 1, event: { note: 60, inst: '1' } })).toBe('Set note');
    expect(label(d, { op: 'setCell', pattern: 0, channel: 0, row: 0, event: null })).toBe('Clear cell');
    expect(label(d, { op: 'transpose', pattern: 0, ch0: 0, ch1: 0, row0: 0, row1: 1, semitones: 1 })).toBe('Transpose');
    expect(label(d, { op: 'addPattern' })).toBe('Add pattern');
    expect(label(d, { op: 'setSpeed', speed: 3 })).toBe('Change speed');
    expect(label(d, { op: 'orderAdd', pattern: 0 })).toBe('Add to order');
  });
  it('an unknown op is an error, not a throw', () => {
    expect(err(song(), { op: 'nope' } as unknown as SongOp)).toBe('unknown operation');
  });
});
