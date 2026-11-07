import { describe, expect, it } from 'vitest';
import { SfxDoc, SfxFrame, validateSfx } from './sfxDoc';
import { SfxOp, applyOp } from './sfxOps';
import { newBank } from './sfxPresets';

const ok = (doc: SfxDoc, op: SfxOp): SfxDoc => {
  const r = applyOp(doc, op);
  if ('error' in r) throw new Error(r.error);
  expect(validateSfx(r.state)).toEqual([]);
  return r.state;
};
const err = (doc: SfxDoc, op: SfxOp): string => {
  const r = applyOp(doc, op);
  if (!('error' in r)) throw new Error('expected an error');
  return r.error;
};
const fr = (pitch: number, volume = 15): SfxFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume });

describe('sfx ops', () => {
  it('setFrames replaces a range, cleans values and drops the preset; the old document is untouched', () => {
    const doc = newBank();
    const before = JSON.stringify(doc);
    const next = ok(doc, { op: 'setFrames', effect: 0, start: 1, frames: [fr(70.123), { ...fr(200), volume: 99, noisePeriod: -4 }] });
    expect(next.effects[0].preset).toBeUndefined();
    expect(next.effects[0].frames[1].pitch).toBe(70.12);
    expect(next.effects[0].frames[2]).toMatchObject({ pitch: 107, volume: 15, noisePeriod: 0 });
    expect(next.effects[0].frames.length).toBe(doc.effects[0].frames.length);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('setFrames with the same frames is "unchanged"; out of range is refused', () => {
    const doc = newBank();
    expect(err(doc, { op: 'setFrames', effect: 0, start: 0, frames: doc.effects[0].frames.slice(0, 2) })).toBe('unchanged');
    expect(err(doc, { op: 'setFrames', effect: 0, start: 5, frames: [fr(60), fr(60), fr(60)] })).toBe('frames outside the effect');
    expect(err(doc, { op: 'setFrames', effect: 3, start: 0, frames: [fr(60)] })).toBe('no effect 3');
  });

  it('resize grows with the last frame, shrinks, and respects 1-250', () => {
    const doc = ok(newBank(), { op: 'setFrames', effect: 0, start: 0, frames: [fr(60)] });
    const grown = ok(doc, { op: 'resize', effect: 0, length: 250 });
    expect(grown.effects[0].frames.length).toBe(250);
    expect(grown.effects[0].frames[249]).toEqual(grown.effects[0].frames[5]);
    expect(ok(grown, { op: 'resize', effect: 0, length: 1 }).effects[0].frames.length).toBe(1);
    expect(err(grown, { op: 'resize', effect: 0, length: 251 })).toMatch(/1-250/);
    expect(err(grown, { op: 'resize', effect: 0, length: 0 })).toMatch(/1-250/);
  });

  it('insertFrame copies the frame after itself; deleteFrame keeps at least one', () => {
    let doc = ok(newBank(), { op: 'resize', effect: 0, length: 2 });
    doc = ok(doc, { op: 'insertFrame', effect: 0, at: 0 });
    expect(doc.effects[0].frames.length).toBe(3);
    expect(doc.effects[0].frames[1]).toEqual(doc.effects[0].frames[0]);
    doc = ok(doc, { op: 'deleteFrame', effect: 0, at: 0 });
    doc = ok(doc, { op: 'deleteFrame', effect: 0, at: 0 });
    expect(err(doc, { op: 'deleteFrame', effect: 0, at: 0 })).toBe('an effect needs at least one frame');
  });

  it('rename checks the name rules and uniqueness (case-insensitive)', () => {
    let doc = ok(newBank(), { op: 'addPreset', kind: 'jump' });
    expect(doc.effects.map((e) => e.name)).toEqual(['blip', 'jump']);
    expect(err(doc, { op: 'rename', effect: 1, name: 'BLIP' })).toMatch(/already used by effect 1/);
    expect(err(doc, { op: 'rename', effect: 1, name: '1jump' })).toMatch(/name must be/);
    expect(err(doc, { op: 'rename', effect: 1, name: 'jump' })).toBe('unchanged');
    doc = ok(doc, { op: 'rename', effect: 1, name: 'Hop_2' });
    expect(doc.effects[1].name).toBe('Hop_2');
  });

  it('addPreset / addBlank insert after the given effect with unique names, up to 9', () => {
    let doc = ok(newBank(), { op: 'addPreset', kind: 'blip', after: 0 });
    expect(doc.effects.map((e) => e.name)).toEqual(['blip', 'blip2']);
    doc = ok(doc, { op: 'addBlank', after: 0 });
    expect(doc.effects.map((e) => e.name)).toEqual(['blip', 'effect', 'blip2']);
    expect(doc.effects[1].preset).toBeUndefined();
    while (doc.effects.length < 9) doc = ok(doc, { op: 'addPreset', kind: 'coin' });
    expect(err(doc, { op: 'addPreset', kind: 'coin' })).toBe('a bank has at most 9 effects');
    expect(err(doc, { op: 'duplicate', effect: 0 })).toBe('a bank has at most 9 effects');
  });

  it('setPreset regenerates the frames and keeps the preset; same parameters are unchanged', () => {
    const doc = newBank();
    const params = { ...doc.effects[0].preset!.params, length: 20 };
    const next = ok(doc, { op: 'setPreset', effect: 0, kind: 'blip', params });
    expect(next.effects[0].frames.length).toBe(20);
    expect(next.effects[0].preset).toEqual({ kind: 'blip', params });
    expect(err(next, { op: 'setPreset', effect: 0, kind: 'blip', params })).toBe('unchanged');
    const laser = ok(next, { op: 'setPreset', effect: 0, kind: 'laser', params: { start: 80, slide: -20, length: 10, noise: 0, rough: 0 } });
    expect(laser.effects[0].preset?.kind).toBe('laser');
  });

  it('duplicate, move and delete', () => {
    let doc = ok(newBank(), { op: 'addPreset', kind: 'jump' });
    doc = ok(doc, { op: 'duplicate', effect: 1 });
    expect(doc.effects.map((e) => e.name)).toEqual(['blip', 'jump', 'jump2']);
    expect(doc.effects[2].frames).toEqual(doc.effects[1].frames);
    expect(doc.effects[2].frames[0]).not.toBe(doc.effects[1].frames[0]);
    doc = ok(doc, { op: 'move', from: 2, to: 0 });
    expect(doc.effects.map((e) => e.name)).toEqual(['jump2', 'blip', 'jump']);
    expect(err(doc, { op: 'move', from: 0, to: 0 })).toBe('unchanged');
    expect(err(doc, { op: 'move', from: 0, to: 3 })).toBe('no effect 3');
    doc = ok(doc, { op: 'delete', effect: 0 });
    doc = ok(doc, { op: 'delete', effect: 0 });
    expect(err(doc, { op: 'delete', effect: 0 })).toBe('a bank needs at least one effect');
  });
});
