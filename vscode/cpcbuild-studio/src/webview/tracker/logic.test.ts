import { describe, expect, it } from 'vitest';
import { demoSong } from '../../core/songDemo';
import { newSong } from '../../core/songDoc';
import { applySongOp } from '../../core/songOps';
import { BUILTINS } from '../../core/songInstruments';
import { rowOfTick } from '../../core/songFrames';
import {
  BOARD_ROWS, NOTE_CODES, auditionFrames, beatLabel, beatPos, bumpVolume, cellName, enterNote, envelopeShape, keyNoteLabel, moveCursor, moveStepOp, noteForCode, playPlan, speedFromTyped, spokenNote, stepSpeed, tempoLabel, ticksLabel,
} from './logic';

describe('key map by KeyboardEvent.code', () => {
  it('Z..M are C..B of the octave, Q..I the octave above, 1 is note off', () => {
    const z = ['KeyZ', 'KeyS', 'KeyX', 'KeyD', 'KeyC', 'KeyV', 'KeyG', 'KeyB', 'KeyH', 'KeyN', 'KeyJ', 'KeyM'];
    expect(z.map((c) => noteForCode(c, 4))).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71]);
    const q = ['KeyQ', 'Digit2', 'KeyW', 'Digit3', 'KeyE', 'KeyR', 'Digit5', 'KeyT', 'Digit6', 'KeyY', 'Digit7', 'KeyU', 'KeyI'];
    expect(q.map((c) => noteForCode(c, 4))).toEqual([72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84]);
    expect(noteForCode('Digit1', 4)).toBe('off');
  });
  it('knows nothing of other keys, and nothing outside C-1..B-7', () => {
    expect(noteForCode('KeyA', 4)).toBeUndefined();
    expect(noteForCode('Digit4', 4)).toBeUndefined();
    expect(noteForCode('KeyI', 7)).toBeUndefined(); // C-9
    expect(noteForCode('KeyU', 7)).toBeUndefined(); // B-8
    expect(noteForCode('KeyM', 7)).toBe(107);
    expect(noteForCode('KeyZ', 1)).toBe(24);
    expect(noteForCode('KeyZ', 99)).toBe(noteForCode('KeyZ', 7)); // clamped
  });
  it('has 25 note keys and the board shows each once, unused positions apart', () => {
    expect(Object.keys(NOTE_CODES)).toHaveLength(25);
    const codes = BOARD_ROWS.flat().map((k) => k.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of Object.keys(NOTE_CODES)) expect(codes).toContain(c);
    expect(codes.filter((c) => noteForCode(c, 4) === undefined)).toEqual(['Digit4', 'KeyA', 'KeyF']);
  });
  it('labels board keys with the note at the octave', () => {
    expect(keyNoteLabel('KeyZ', 4)).toBe('C-4');
    expect(keyNoteLabel('KeyS', 4)).toBe('C#4');
    expect(keyNoteLabel('Digit1', 4)).toBe('off');
    expect(keyNoteLabel('KeyA', 4)).toBe('');
    expect(keyNoteLabel('KeyI', 7)).toBe('');
  });
});

describe('row labels', () => {
  it('numbers the beats and dots the rows between', () => {
    expect([0, 1, 2, 3, 4, 5, 8].map((r) => beatLabel(r, 4))).toEqual(['1', '·', '·', '·', '2', '·', '3']);
    expect([0, 1, 2].map((r) => beatLabel(r, 1))).toEqual(['1', '2', '3']);
  });
  it('gives beat.row positions', () => {
    expect(beatPos(0, 4)).toBe('1.1');
    expect(beatPos(13, 4)).toBe('4.2');
  });
});

describe('tempo', () => {
  it('+ steps to a lower speed, - to a higher, within 3-15', () => {
    expect(stepSpeed(6, true)).toBe(5);
    expect(stepSpeed(6, false)).toBe(7);
    expect(stepSpeed(3, true)).toBe(3);
    expect(stepSpeed(15, false)).toBe(15);
    expect(stepSpeed(2, true)).toBe(2);
    expect(stepSpeed(40, false)).toBe(40);
  });
  it('snaps typed values to the nearest speed', () => {
    expect(speedFromTyped('125', 4)).toBe(6);
    expect(speedFromTyped('130', 4)).toBe(6);
    expect(speedFromTyped('1000', 4)).toBe(3);
    expect(speedFromTyped('1', 4)).toBe(15);
    expect(speedFromTyped('abc', 4)).toBeUndefined();
    expect(speedFromTyped('', 4)).toBeUndefined();
    expect(speedFromTyped('0', 4)).toBeUndefined();
    expect(speedFromTyped('187,5', 4)).toBe(4);
  });
  it('shows BPM and ticks per row', () => {
    expect(tempoLabel(6, 4)).toBe('125');
    expect(tempoLabel(4, 4)).toBe('187.5');
    expect(ticksLabel(6)).toBe('6 ticks/row');
    expect(ticksLabel(1)).toBe('1 tick/row');
  });
});

describe('cell names', () => {
  const doc = demoSong();
  it('names empty, off and note cells for a screen reader', () => {
    expect(cellName(4, 1, undefined, doc)).toBe('Row 5, channel B: empty');
    expect(cellName(0, 0, { row: 0, note: 'off' }, doc)).toBe('Row 1, channel A: note off');
    expect(cellName(4, 1, { row: 4, note: 72, inst: '1', vol: 12 }, doc)).toBe('Row 5, channel B: C 5, Piano, volume 12');
    expect(cellName(4, 2, { row: 4, note: 61, inst: '6' }, doc)).toBe('Row 5, channel C: C sharp 4, Bass');
    expect(cellName(0, 0, { row: 0, note: 60, inst: 'Z' }, doc)).toBe('Row 1, channel A: C 4, instrument Z');
  });
  it('speaks notes', () => {
    expect(spokenNote(60)).toBe('C 4');
    expect(spokenNote(66)).toBe('F sharp 4');
  });
});

describe('entering and volume', () => {
  it('keeps an existing volume when a note replaces a note, not after off', () => {
    expect(enterNote(undefined, 60, '1')).toEqual({ note: 60, inst: '1' });
    expect(enterNote({ row: 0, note: 50, inst: '2', vol: 9 }, 60, '1')).toEqual({ note: 60, inst: '1', vol: 9 });
    expect(enterNote({ row: 0, note: 'off' }, 60, '1')).toEqual({ note: 60, inst: '1' });
    expect(enterNote({ row: 0, note: 50, inst: '2', vol: 9 }, 'off', '1')).toEqual({ note: 'off' });
  });
  it('changes the volume 0-15 and does nothing on empty, off or at the limit', () => {
    expect(bumpVolume({ row: 0, note: 60, inst: '1' }, -1)).toEqual({ note: 60, inst: '1', vol: 14 });
    expect(bumpVolume({ row: 0, note: 60, inst: '1', vol: 3 }, 1)).toEqual({ note: 60, inst: '1', vol: 4 });
    expect(bumpVolume({ row: 0, note: 60, inst: '1' }, 1)).toBeUndefined();
    expect(bumpVolume({ row: 0, note: 60, inst: '1', vol: 0 }, -1)).toBeUndefined();
    expect(bumpVolume(undefined, 1)).toBeUndefined();
    expect(bumpVolume({ row: 0, note: 'off' }, 1)).toBeUndefined();
  });
});

describe('cursor', () => {
  const at = { row: 5, channel: 1 };
  it('moves with arrows, a bar with PgUp/PgDn, Home/End, and stops at the edges', () => {
    expect(moveCursor('ArrowDown', at, 32, 4)).toEqual({ row: 6, channel: 1 });
    expect(moveCursor('ArrowUp', { row: 0, channel: 0 }, 32, 4)).toEqual({ row: 0, channel: 0 });
    expect(moveCursor('ArrowLeft', { row: 3, channel: 0 }, 32, 4)).toEqual({ row: 3, channel: 0 });
    expect(moveCursor('ArrowRight', { row: 3, channel: 2 }, 32, 4)).toEqual({ row: 3, channel: 2 });
    expect(moveCursor('ArrowRight', at, 32, 4)).toEqual({ row: 5, channel: 2 });
    expect(moveCursor('PageDown', at, 32, 4)).toEqual({ row: 21, channel: 1 });
    expect(moveCursor('PageDown', at, 32, 8)).toEqual({ row: 31, channel: 1 });
    expect(moveCursor('PageUp', at, 32, 4)).toEqual({ row: 0, channel: 1 });
    expect(moveCursor('Home', at, 32, 4)).toEqual({ row: 0, channel: 1 });
    expect(moveCursor('End', at, 32, 4)).toEqual({ row: 31, channel: 1 });
    expect(moveCursor('a', at, 32, 4)).toBeUndefined();
  });
});

describe('envelope shape', () => {
  it('is the volume frames over 15', () => {
    const piano = BUILTINS[0];
    const s = envelopeShape(piano);
    expect(s).toHaveLength(16);
    expect(s[0]).toBe(1);
    expect(s[15]).toBeCloseTo(1 / 15);
    expect(envelopeShape(BUILTINS[1])).toEqual([7 / 15, 11 / 15, 13 / 15, 13 / 15]);
  });
});

describe('sequencer through ops', () => {
  const song = () => {
    let d = newSong();
    for (const op of [{ op: 'addPattern' }, { op: 'addPattern' }, { op: 'orderAdd', pattern: 1 }, { op: 'orderAdd', pattern: 2 }] as const) {
      const r = applySongOp(d, op);
      if ('error' in r) throw new Error(r.error);
      d = r.state;
    }
    return d; // order [0,1,2], loop 0
  };
  it('moves a chip with Alt+arrows (orderMove) and the loop stays on its chip', () => {
    let d = song();
    const op = moveStepOp(d.order.length, 0, 1);
    expect(op).toEqual({ op: 'orderMove', from: 0, to: 1 });
    const r = applySongOp(d, op!);
    if ('error' in r) throw new Error(r.error);
    d = r.state;
    expect(d.order).toEqual([1, 0, 2]);
    expect(d.loop).toBe(1);
    expect(moveStepOp(3, 0, -1)).toBeUndefined();
    expect(moveStepOp(3, 2, 1)).toBeUndefined();
  });
  it('removes a chip and sets the loop on one', () => {
    let d = song();
    let r = applySongOp(d, { op: 'setLoop', at: 2 });
    if ('error' in r) throw new Error(r.error);
    d = r.state;
    expect(d.loop).toBe(2);
    r = applySongOp(d, { op: 'orderRemove', at: 0 });
    if ('error' in r) throw new Error(r.error);
    expect(r.state.order).toEqual([1, 2]);
    expect(r.state.loop).toBe(1);
  });
});

describe('play plan and audition', () => {
  it('starts at the selected step when it holds the pattern, else the first step with it, else plays it alone', () => {
    const d = { ...newSong(), order: [0, 1, 0], patterns: [newSong().patterns[0], newSong().patterns[0]] };
    expect(playPlan(d, 0, 2)).toMatchObject({ startStep: 2, solo: false });
    expect(playPlan(d, 1, 2)).toMatchObject({ startStep: 1, solo: false });
    const lone = { ...d, patterns: [...d.patterns, d.patterns[0]] };
    const p = playPlan(lone, 2, 0);
    expect(p.solo).toBe(true);
    expect(p.doc.order).toEqual([2]);
  });
  it('auditions one note for 25 ticks on the cursor channel without looping', () => {
    const f = auditionFrames(newSong(), 60, '1', 2);
    expect(f.ticks).toHaveLength(25);
    expect(f.loopTick).toBe(-1);
    expect(f.ticks[0].c.volume).toBeGreaterThan(0);
    expect(f.ticks[0].a.volume).toBe(0);
    expect(rowOfTick(f, 3)?.row).toBe(3);
  });
});
