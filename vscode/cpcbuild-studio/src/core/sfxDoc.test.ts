import { describe, expect, it } from 'vitest';
import { CLOCKS, SfxDoc, describeError, lengthMs, noteName, parseSfx, period, roundPitch, serialiseSfx, uniqueName, validateSfx, validName } from './sfxDoc';
import { newBank, presetEffect } from './sfxPresets';

const text = (doc: unknown): string => JSON.stringify(doc, null, 2) + '\n';
const good = (): SfxDoc => ({
  format: 'cpcsfx',
  version: 1,
  effects: [{ name: 'jump', frames: [{ pitch: 72.5, tone: true, noise: false, noisePeriod: 0, volume: 15 }] }],
});

describe('sfx document: period and helpers', () => {
  it('period matches the measured Arkos periods at both clocks', () => {
    expect(period(60, CLOCKS.cpc)).toBe(239);
        expect(period(24, CLOCKS.cpc)).toBe(1911);
      });

  it('period is clamped to 1-4095', () => {
    expect(period(300, CLOCKS.cpc)).toBe(1);
    expect(period(-100, CLOCKS.cpc)).toBe(4095);
  });

  it('lengthMs is 20 ms a frame', () => {
    expect(lengthMs({ name: 'a', frames: Array.from({ length: 12 }, () => good().effects[0].frames[0]) })).toBe(240);
  });

  it('roundPitch keeps 0.01', () => {
    expect(roundPitch(72.3456)).toBe(72.35);
    expect(roundPitch(60)).toBe(60);
  });

  it('note names', () => {
    expect(noteName(60)).toBe('C-4');
    expect(noteName(24)).toBe('C-1');
    expect(noteName(107)).toBe('B-7');
    expect(noteName(61.4)).toBe('C#4');
  });

  it('names', () => {
    for (const n of ['a', 'Jump_2', 'x'.repeat(24)]) expect(validName(n)).toBe(true);
    for (const n of ['', '1a', 'a b', 'a-b', 'x'.repeat(25), 'é', 5, undefined]) expect(validName(n)).toBe(false);
  });

  it('uniqueName avoids a name already used, ignoring case', () => {
    const d = good();
    expect(uniqueName(d, 'coin')).toBe('coin');
    expect(uniqueName(d, 'Jump')).toBe('Jump2');
  });
});

describe('sfx document: round trip', () => {
  it('serialise(parse(text)) is the text, byte for byte', () => {
    const t = serialiseSfx(good());
    const r = parseSfx(t);
    expect(r.errors).toEqual([]);
    expect(serialiseSfx(r.doc!)).toBe(t);
    expect(t.endsWith('}\n')).toBe(true);
    expect(t).toContain('\n  "effects": [\n    {\n');
  });

  it('a bank made from presets round trips, preset included', () => {
    const doc = newBank();
    doc.effects.push(presetEffect('explosion', 'boom'), presetEffect('alarm', 'alarm'));
    const t = serialiseSfx(doc);
    const r = parseSfx(t);
    expect(r.errors).toEqual([]);
    expect(r.doc).toEqual(doc);
    expect(serialiseSfx(r.doc!)).toBe(t);
  });

  it('keeps unknown keys', () => {
    const doc = { ...good(), editor: { zoom: 3 } } as unknown as SfxDoc;
    (doc.effects[0] as unknown as Record<string, unknown>).note = 'hi';
    (doc.effects[0].frames[0] as unknown as Record<string, unknown>).tag = 7;
    const t = text(doc);
    const r = parseSfx(t);
    expect(r.errors).toEqual([]);
    expect(serialiseSfx(r.doc!)).toBe(t);
  });

  it('pitches are saved at 0.01', () => {
    const doc = good();
    doc.effects[0].frames[0].pitch = 60.123456;
    expect(parseSfx(serialiseSfx(doc)).doc!.effects[0].frames[0].pitch).toBe(60.12);
  });
});

describe('sfx document: validation', () => {
  const errs = (doc: unknown): string[] => validateSfx(doc).map(describeError);

  it('accepts a good document', () => {
    expect(validateSfx(good())).toEqual([]);
  });

  it('bad JSON and wrong shapes never throw', () => {
    expect(parseSfx('{nope').doc).toBeNull();
    expect(parseSfx('{nope').errors[0].message).toMatch(/not valid JSON/);
    for (const v of [null, 5, 'x', [], { effects: 3 }]) expect(() => validateSfx(v)).not.toThrow();
    expect(errs([])).toEqual(['a .cpcsfx file is a JSON object']);
  });

  it('header and bank size', () => {
    expect(errs({ ...good(), format: 'x', version: 2 })).toEqual(['format: format must be "cpcsfx"', 'version: version must be 1']);
    expect(errs({ ...good(), effects: [] })).toEqual(['effects: a bank has 1-9 effects, not 0']);
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...good().effects[0], name: `e${i}` }));
    expect(errs({ ...good(), effects: ten })).toEqual(['effects: a bank has 1-9 effects, not 10']);
  });

  it('effect names: bad and duplicate (case-insensitive)', () => {
    const e = good().effects[0];
    expect(errs({ ...good(), effects: [{ ...e, name: '9' }] })[0]).toMatch(/^effects\[0\]\.name: name must be 1-24/);
    expect(errs({ ...good(), effects: [e, { ...e, name: 'JUMP' }] })).toEqual(['effects[1].name: name "JUMP" is already used by effect 1']);
  });

  it('frames: counts and each field, with its index', () => {
    const e = good().effects[0];
    expect(errs({ ...good(), effects: [{ ...e, frames: [] }] })).toEqual(['effects[0].frames: an effect has 1-250 frames, not 0']);
    const long = Array.from({ length: 251 }, () => e.frames[0]);
    expect(errs({ ...good(), effects: [{ ...e, frames: long }] })).toEqual(['effects[0].frames: an effect has 1-250 frames, not 251']);
    const f = e.frames[0];
    const bad = { pitch: 108, tone: 1, noise: 'x', noisePeriod: 32, volume: 16 };
    expect(errs({ ...good(), effects: [{ ...e, frames: [f, f, bad] }] }).map((m) => m.split(':')[0])).toEqual([
      'effects[0].frames[2].pitch',
      'effects[0].frames[2].tone',
      'effects[0].frames[2].noise',
      'effects[0].frames[2].noisePeriod',
      'effects[0].frames[2].volume',
    ]);
    expect(errs({ ...good(), effects: [{ ...e, frames: [{ ...f, pitch: 23.99 }] }] })).toHaveLength(1);
    expect(errs({ ...good(), effects: [{ ...e, frames: [{ ...f, volume: 1.5 }] }] })).toHaveLength(1);
  });

  it('preset: kind and numeric params', () => {
    const e = good().effects[0];
    expect(errs({ ...good(), effects: [{ ...e, preset: { kind: 'nope', params: {} } }] }).length).toBeGreaterThan(1);
    expect(errs({ ...good(), effects: [{ ...e, preset: presetEffect('blip', 'b').preset }] })).toEqual([]);
  });

  it('parseSfx gives no document while there are errors', () => {
    const r = parseSfx(text({ ...good(), version: 9 }));
    expect(r.doc).toBeNull();
    expect(r.errors).toHaveLength(1);
  });
});
