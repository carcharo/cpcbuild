import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOCKS, SfxDoc, SfxFrame, period } from './sfxDoc';
import { generate } from './sfxPresets';
import { Vt2Error, frameLine, sfxToVt2, vt2Problems } from './vt2';

const repo = path.resolve(__dirname, '../../../..');
const toolsDir = process.env.AT3_TOOLS || path.join(repo, 'tools/arkos/work/bin');
const haveTools = fs.existsSync(path.join(toolsDir, 'SongToSoundEffects'));

const frame = (pitch: number, volume: number, extra: Partial<SfxFrame> = {}): SfxFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume, ...extra });
const bank = (...effects: [string, SfxFrame[]][]): SfxDoc => ({ format: 'cpcsfx', version: 1, effects: effects.map(([name, frames]) => ({ name, frames })) });

const END = '... +000_ +00_ 0_ L';
const pad = (from: number): string => Array.from({ length: 32 - from }, (_, i) => `[Sample${from + i}]\n${END}\n\n`).join('');

describe('vt2: tone offsets (periods measured with Arkos 3.7, see the S1 spec)', () => {
  // note number, CPC period, Spectrum period
  const table: [string, number, number, number][] = [
    ['C-1', 24, 1911, 3389],
    ['A-2', 45, 568, 1008],
    ['C-3', 48, 478, 847],
    ['F#3', 54, 338, 599],
    ['C-4', 60, 239, 424],
    ['A-4', 69, 142, 252],
    ['C-5', 72, 119, 212],
    ['G-6', 91, 40, 71],
    ['B-7', 107, 16, 28],
  ];
  for (const [name, m, cpc, zx] of table) {
    it(`${name}: periods ${cpc} / ${zx}`, () => {
      expect(period(m, CLOCKS.cpc)).toBe(cpc);
      expect(period(m, CLOCKS.spectrum)).toBe(zx);
      const sign = (n: number): string => `${n < 0 ? '-' : '+'}${Math.abs(n).toString(16).toUpperCase().padStart(3, '0')}`;
      expect(frameLine(frame(m, 15), CLOCKS.cpc)).toBe(`T.. ${sign(cpc - 239)}_ +00_ F_`);
      expect(frameLine(frame(m, 15), CLOCKS.spectrum)).toBe(`T.. ${sign(zx - 424)}_ +00_ F_`);
    });
  }

  it('spells the offsets out', () => {
    expect(frameLine(frame(24, 15), CLOCKS.cpc)).toBe('T.. +688_ +00_ F_');
    expect(frameLine(frame(24, 15), CLOCKS.spectrum)).toBe('T.. +B95_ +00_ F_');
    expect(frameLine(frame(107, 1), CLOCKS.cpc)).toBe('T.. -0DF_ +00_ 1_');
    expect(frameLine(frame(107, 1), CLOCKS.spectrum)).toBe('T.. -18C_ +00_ 1_');
  });

  it('mixer letters, noise period in hex and volume digit', () => {
    expect(frameLine(frame(60, 0xa, { tone: false, noise: true, noisePeriod: 31 }), CLOCKS.cpc)).toBe('.N. +000_ +1F_ A_');
    expect(frameLine(frame(60, 9, { noise: true, noisePeriod: 10 }), CLOCKS.cpc)).toBe('TN. +000_ +0A_ 9_');
    expect(frameLine(frame(60, 9, { tone: false }), CLOCKS.cpc)).toBe('... +000_ +00_ 9_');
  });
});

describe('vt2: exact text of a 2-effect bank', () => {
  const doc = bank(
    ['beep', [frame(60, 15), frame(72, 8, { noise: true, noisePeriod: 10 })]],
    ['low', [frame(69, 3)]],
  );
  const head = (clock: number): string =>
    `[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=test\nAuthor=cpcbuild\nNoteTable=1\nChipFreq=${clock}\nSpeed=6\nNoise=HEX\nPlayOrder=L0\n\n[Ornament1]\nL0\n\n`;
  const rows = '[Pattern0]\n....|..|C-4 1F0F ....|--- .... ....|--- .... ....\n....|..|C-4 2F0F ....|--- .... ....|--- .... ....\n';

  it('CPC', () => {
    const expected =
      head(1000000) +
      `[Sample1]\nT.. +000_ +00_ F_\nTN. -078_ +0A_ 8_\n${END}\n\n` +
      `[Sample2]\nT.. -061_ +00_ 3_\n${END}\n\n` +
      pad(3) +
      rows;
    expect(sfxToVt2(doc, 'cpc', 'test')).toBe(expected);
  });

  it('Spectrum', () => {
    const expected =
      head(1773400) +
      `[Sample1]\nT.. +000_ +00_ F_\nTN. -0D4_ +0A_ 8_\n${END}\n\n` +
      `[Sample2]\nT.. -0AC_ +00_ 3_\n${END}\n\n` +
      pad(3) +
      rows;
    expect(sfxToVt2(doc, 'spectrum', 'test')).toBe(expected);
  });

  it('defines all 31 samples and ends every effect with the silent end line, never a sounding L', () => {
    const text = sfxToVt2(doc, 'cpc');
    expect(text.match(/^\[Sample\d+\]$/gm)).toHaveLength(31);
    for (const line of text.split('\n').filter((l) => l.endsWith(' L'))) expect(line).toBe(END);
  });
});

describe('vt2: errors', () => {
  const ok = (n: number): SfxFrame[] => [frame(60, n)];
  const msg = (doc: SfxDoc): string => {
    expect(() => sfxToVt2(doc, 'cpc')).toThrow(Vt2Error);
    return vt2Problems(doc, 'cpc')[0];
  };

  it('too many effects', () => {
    const many = bank(...Array.from({ length: 10 }, (_, i): [string, SfxFrame[]] => [`e${i}`, ok(i + 1)]));
    expect(msg(many)).toBe('a bank has 1-9 effects, not 10');
    expect(vt2Problems(bank(), 'cpc')[0]).toBe('a bank has 1-9 effects, not 0');
  });

  it('nine effects are fine', () => {
    const nine = bank(...Array.from({ length: 9 }, (_, i): [string, SfxFrame[]] => [`e${i}`, ok(i + 1)]));
    expect(vt2Problems(nine, 'cpc')).toEqual([]);
    expect(sfxToVt2(nine, 'cpc')).toContain('9F0F');
  });

  it('too long (and empty)', () => {
    expect(msg(bank(['long', Array.from({ length: 251 }, () => frame(60, 5))]))).toBe('effect "long": 251 frames, but an effect has 1-250');
    expect(vt2Problems(bank(['long', Array.from({ length: 250 }, () => frame(60, 5))]), 'cpc')).toEqual([]);
    expect(msg(bank(['none', []]))).toBe('effect "none": 0 frames, but an effect has 1-250');
  });

  it('offset out of range names the effect and frame', () => {
    expect(msg(bank(['a', ok(1)], ['bad', [frame(60, 1), frame(NaN, 1)]]))).toMatch(/^effect "bad", frame 2: tone offset NaN does not fit/);
  });

  it('identical effects name both', () => {
    expect(msg(bank(['one', ok(5)], ['two', [frame(60, 4)]], ['three', ok(5)]))).toBe('effects "one" and "three" are identical; the converter would merge them');
  });

  it('identical once the offsets are worked out (pitches that round to the same period)', () => {
    expect(msg(bank(['one', [frame(60, 5)]], ['two', [frame(60.001, 5)]]))).toMatch(/identical/);
  });

  it('bad names', () => {
    expect(msg(bank(['1up', ok(1)]))).toMatch(/^effect 1: name must be 1-24 characters/);
    expect(msg(bank(['has space', ok(1)]))).toMatch(/name must be/);
    expect(msg(bank(['x'.repeat(25), ok(1)]))).toMatch(/name must be/);
    expect(msg(bank(['', ok(1)]))).toMatch(/name must be/);
    expect(msg(bank(['Jump', ok(1)], ['jump', ok(2)]))).toBe('effects "Jump" and "jump" have the same name');
  });
});

describe.skipIf(!haveTools)('vt2: golden against the real SongToSoundEffects', () => {
  interface Stored {
    volume: number;
    /** undefined when the frame has no tone / no noise */
    period?: number;
    noise?: number;
  }

  /** Effect number -> stored frames, from an Arkos .asm sound-effects file (plain or aks2bas-labelled). */
  function parseAsm(asm: string): Map<number, Stored[]> {
    const out = new Map<number, Stored[]>();
    let cur: Stored[] | undefined;
    for (const line of asm.split(/\r?\n/)) {
      const label = /_SoundEffects_Sound(\d+):?\s*$/.exec(line);
      if (label) out.set(Number(label[1]), (cur = []));
      const v = /Volume: (\d+)\./.exec(line);
      if (v && cur) cur.push({ volume: Number(v[1]) });
      const n = /;\s*Noise: (\d+)\./.exec(line);
      if (n && cur) cur[cur.length - 1].noise = Number(n[1]);
      const p = /^\s*dw (\d+)\s*; Software period\./.exec(line);
      if (p && cur) cur[cur.length - 1].period = Number(p[1]);
    }
    return out;
  }

  function convert(doc: SfxDoc): Map<number, Stored[]> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sfxgolden-'));
    try {
      const vt2 = path.join(dir, 'bank.vt2');
      const asm = path.join(dir, 'bank.asm');
      fs.writeFileSync(vt2, sfxToVt2(doc, 'cpc', 'golden'));
      execFileSync(path.join(toolsDir, 'SongToSoundEffects'), ['--labelPrefix', 'golden_', vt2, asm], { timeout: 120000 });
      return parseAsm(fs.readFileSync(asm, 'utf8'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  it("bounce's 8 blips, written by sfxToVt2, convert to the committed bounce_sfx.bas data", () => {
    // make_bounce_aks.py sfx(): the notes of the 62500 / period pitches, the decays with one step differing
    const notes = [72, 76, 81, 86, 60, 64, 69, 74];
    const effects: [string, SfxFrame[]][] = notes.map((m, k) => {
      const amps = [15, 12, 9 + (k & 1), 6 + ((k >> 1) & 1), 4 + ((k >> 2) & 1), 2, 1];
      return [`blip${k + 1}`, amps.map((a) => frame(m, a))];
    });
    const got = convert(bank(...effects));
    const want = parseAsm(fs.readFileSync(path.join(repo, 'examples/assets/bounce_sfx.bas'), 'utf8'));
    expect(want.size).toBe(8);
    expect([...got.keys()]).toEqual([...want.keys()]);
    for (const [n, w] of want) expect(got.get(n), `effect ${n}`).toEqual(w);
  }, 130000);

  it('noise-only, tone-plus-noise and sliding frames keep their periods, noise periods and volumes', () => {
    const doc: SfxDoc = {
      format: 'cpcsfx',
      version: 1,
      effects: [
        { name: 'hit', frames: generate('hit').slice(0, 8) },
        { name: 'door', frames: generate('door') },
        { name: 'laser', frames: generate('laser') },
      ],
    };
    const got = convert(doc);
    doc.effects.forEach((e, i) => {
      const want: Stored[] = e.frames.map((f) => ({
        volume: f.volume,
        // measured: the converter stores no tone period for a silent frame
        ...(f.tone && f.volume > 0 ? { period: period(f.pitch, CLOCKS.cpc) } : {}),
        ...(f.noise ? { noise: f.noisePeriod } : {}),
      }));
      expect(got.get(i + 1), e.name).toEqual(want);
    });
  }, 130000);
});
