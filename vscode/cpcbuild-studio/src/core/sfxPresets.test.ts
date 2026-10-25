import { describe, expect, it } from 'vitest';
import { PRESET_KINDS, validateSfx } from './sfxDoc';
import { DEFAULT_PARAMS, MAX_LENGTH, MIN_LENGTH, PRESET_LABELS, clampParams, generate, newBank, presetEffect, rng } from './sfxPresets';
import { sfxToVt2 } from './vt2';

describe('sfx presets', () => {
  it('every kind has a label and defaults inside the limits', () => {
    for (const k of PRESET_KINDS) {
      expect(PRESET_LABELS[k]).toBeTruthy();
      expect(clampParams(DEFAULT_PARAMS[k])).toEqual(DEFAULT_PARAMS[k]);
    }
  });

  for (const kind of PRESET_KINDS) {
    describe(kind, () => {
      it('is deterministic and makes valid frames of the asked length', () => {
        const a = generate(kind);
        expect(generate(kind)).toEqual(a);
        expect(a).toHaveLength(DEFAULT_PARAMS[kind].length);
        const doc = { format: 'cpcsfx', version: 1, effects: [presetEffect(kind, kind)] };
        expect(validateSfx(doc)).toEqual([]);
      });

      it('sounds: starts audible, is not constant, and the writer accepts it at both clocks', () => {
        const f = generate(kind);
        expect(f[0].volume).toBeGreaterThanOrEqual(8);
        expect(new Set(f.map((x) => x.volume)).size).toBeGreaterThan(1);
        const doc = { format: 'cpcsfx' as const, version: 1, effects: [presetEffect(kind, kind)] };
        expect(() => sfxToVt2(doc, 'cpc')).not.toThrow();
        expect(() => sfxToVt2(doc, 'spectrum')).not.toThrow();
      });

      it('rough changes pitches only, deterministically; extremes stay valid', () => {
        const smooth = generate(kind, { ...DEFAULT_PARAMS[kind], rough: 0 });
        const rough = generate(kind, { ...DEFAULT_PARAMS[kind], rough: 1 });
        expect(generate(kind, { ...DEFAULT_PARAMS[kind], rough: 1 })).toEqual(rough);
        expect(rough.map((x) => x.volume)).toEqual(smooth.map((x) => x.volume));
        expect(rough.map((x) => x.pitch)).not.toEqual(smooth.map((x) => x.pitch));
        for (const length of [MIN_LENGTH, MAX_LENGTH]) {
          const doc = { format: 'cpcsfx', version: 1, effects: [presetEffect(kind, 'x', { start: 24, slide: -83, length, noise: 0.5, rough: 1 })] };
          expect(validateSfx(doc)).toEqual([]);
        }
      });
    });
  }

  it('the shapes the spec names', () => {
    const jump = generate('jump').map((f) => f.pitch);
    expect(jump[jump.length - 1]).toBe(72);
    expect(jump).toEqual([...jump].sort((a, b) => a - b));
    const laser = generate('laser').map((f) => f.pitch);
    expect(laser[laser.length - 1]).toBe(52);
    expect(laser).toEqual([...laser].sort((a, b) => b - a));
    expect(generate('hit').every((f) => f.noise && !f.tone)).toBe(true);
    expect(generate('blip').every((f) => f.tone && !f.noise)).toBe(true);
    expect(new Set(generate('alarm').map((f) => f.pitch))).toEqual(new Set([79, 74]));
    expect(new Set(generate('coin').map((f) => f.pitch))).toEqual(new Set([83, 88]));
    expect(new Set(generate('door').map((f) => f.pitch))).toEqual(new Set([36, 31]));
  });

  it('noise mixes in as an attack between 0 and 1', () => {
    const f = generate('jump', { ...DEFAULT_PARAMS.jump, noise: 0.25 });
    expect(f.filter((x) => x.noise)).toHaveLength(3);
    expect(f.slice(0, 3).every((x) => x.noise && x.tone && x.noisePeriod > 0)).toBe(true);
    expect(f.slice(3).every((x) => !x.noise && x.tone)).toBe(true);
  });

  it('parameters are clamped', () => {
    expect(clampParams({ start: 5, slide: 500, length: 1000.4, noise: 3, rough: -1 })).toEqual({ start: 24, slide: 83, length: 100, noise: 1, rough: 0 });
    expect(generate('blip', { ...DEFAULT_PARAMS.blip, length: 0 })).toHaveLength(MIN_LENGTH);
  });

  it('presetEffect records the preset, and newBank is one blip', () => {
    const e = presetEffect('coin', 'coin');
    expect(e.preset).toEqual({ kind: 'coin', params: DEFAULT_PARAMS.coin });
    const b = newBank();
    expect(b.effects.map((x) => x.name)).toEqual(['blip']);
    expect(validateSfx(b)).toEqual([]);
  });

  it('rng is the same sequence every time', () => {
    const r = rng(1);
    const first = [r(), r(), r()];
    const s = rng(1);
    expect([s(), s(), s()]).toEqual(first);
    expect(first.every((v) => v >= 0 && v < 1)).toBe(true);
  });
});
