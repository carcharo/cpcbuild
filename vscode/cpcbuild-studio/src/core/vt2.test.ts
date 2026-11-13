import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOCKS, SfxDoc, SfxFrame, period } from './sfxDoc';
import { generate } from './sfxPresets';
import { SongDoc, SongInstrument, newSong } from './songDoc';
import { Vt2Error, frameLine, sampleDigit, sfxToVt2, songProblems, songToVt2, vt2Problems } from './vt2';

const repo = path.resolve(__dirname, '../../../..');
const toolsDir = process.env.AT3_TOOLS || path.join(repo, 'tools/arkos/work/bin');
const haveTools = fs.existsSync(path.join(toolsDir, 'SongToSoundEffects'));
const haveSongTool = fs.existsSync(path.join(toolsDir, 'SongToAkg'));

const frame = (pitch: number, volume: number, extra: Partial<SfxFrame> = {}): SfxFrame => ({ pitch, tone: true, noise: false, noisePeriod: 0, volume, ...extra });
const bank = (...effects: [string, SfxFrame[]][]): SfxDoc => ({ format: 'cpcsfx', version: 1, effects: effects.map(([name, frames]) => ({ name, frames })) });

const END = '... +000_ +00_ 0_ L';
const pad = (from: number): string => Array.from({ length: 32 - from }, (_, i) => `[Sample${from + i}]\n${END}\n\n`).join('');

describe('vt2: tone offsets (periods measured with Arkos 3.7, see the S1 spec)', () => {
  // note name, note number, CPC period
  const table: [string, number, number][] = [
    ['C-1', 24, 1911],
    ['A-2', 45, 568],
    ['C-3', 48, 478],
    ['F#3', 54, 338],
    ['C-4', 60, 239],
    ['A-4', 69, 142],
    ['C-5', 72, 119],
    ['G-6', 91, 40],
    ['B-7', 107, 16],
  ];
  for (const [name, m, cpc] of table) {
    it(`${name}: period ${cpc}`, () => {
      expect(period(m, CLOCKS.cpc)).toBe(cpc);
      const sign = (n: number): string => `${n < 0 ? '-' : '+'}${Math.abs(n).toString(16).toUpperCase().padStart(3, '0')}`;
      expect(frameLine(frame(m, 15), CLOCKS.cpc)).toBe(`T.. ${sign(cpc - 239)}_ +00_ F_`);
    });
  }

  it('spells the offsets out', () => {
    expect(frameLine(frame(24, 15), CLOCKS.cpc)).toBe('T.. +688_ +00_ F_');
    expect(frameLine(frame(107, 1), CLOCKS.cpc)).toBe('T.. -0DF_ +00_ 1_');
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

  it('the CPC clock', () => {
    const expected =
      head(1000000) +
      `[Sample1]\nT.. +000_ +00_ F_\nTN. -078_ +0A_ 8_\n${END}\n\n` +
      `[Sample2]\nT.. -061_ +00_ 3_\n${END}\n\n` +
      pad(3) +
      rows;
    expect(sfxToVt2(doc, 'test')).toBe(expected);
  });

  it('defines all 31 samples and ends every effect with the silent end line, never a sounding L', () => {
    const text = sfxToVt2(doc);
    expect(text.match(/^\[Sample\d+\]$/gm)).toHaveLength(31);
    for (const line of text.split('\n').filter((l) => l.endsWith(' L'))) expect(line).toBe(END);
  });
});

describe('vt2: errors', () => {
  const ok = (n: number): SfxFrame[] => [frame(60, n)];
  const msg = (doc: SfxDoc): string => {
    expect(() => sfxToVt2(doc)).toThrow(Vt2Error);
    return vt2Problems(doc)[0];
  };

  it('too many effects', () => {
    const many = bank(...Array.from({ length: 10 }, (_, i): [string, SfxFrame[]] => [`e${i}`, ok(i + 1)]));
    expect(msg(many)).toBe('a bank has 1-9 effects, not 10');
    expect(vt2Problems(bank())[0]).toBe('a bank has 1-9 effects, not 0');
  });

  it('nine effects are fine', () => {
    const nine = bank(...Array.from({ length: 9 }, (_, i): [string, SfxFrame[]] => [`e${i}`, ok(i + 1)]));
    expect(vt2Problems(nine)).toEqual([]);
    expect(sfxToVt2(nine)).toContain('9F0F');
  });

  it('too long (and empty)', () => {
    expect(msg(bank(['long', Array.from({ length: 251 }, () => frame(60, 5))]))).toBe('effect "long": 251 frames, but an effect has 1-250');
    expect(vt2Problems(bank(['long', Array.from({ length: 250 }, () => frame(60, 5))]))).toEqual([]);
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
      fs.writeFileSync(vt2, sfxToVt2(doc, 'golden'));
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

// ------------------------------------------------------------------------- songs

const pluck = (id: string, vol = 15, extra: Partial<SongInstrument> = {}): SongInstrument => ({
  id,
  name: `Pluck ${id}`,
  colour: 'peach',
  description: '',
  frames: [frame(0, vol), frame(0, 10), frame(0, 6)].map((f) => ({ pitch: 0, tone: true, noise: false, noisePeriod: 0, volume: f.volume })),
  loop: 1,
  ...extra,
});

const smallSong = (): SongDoc => ({
  format: 'cpcsong',
  version: 1,
  speed: 6,
  rowsPerBeat: 4,
  patterns: [
    {
      rows: 4,
      channels: [
        [{ row: 0, note: 60, inst: '9' }, { row: 2, note: 'off' }],
        [{ row: 0, note: 72, inst: '5', vol: 9 }, { row: 1, note: 74, inst: 'B', vol: 9 }, { row: 3, note: 76, inst: 'B' }],
        [],
      ],
    },
    { rows: 2, channels: [[{ row: 0, note: 48, inst: 'B' }], [], []] },
  ],
  order: [0, 1, 1],
  loop: 1,
  instruments: [pluck('B')],
});

describe('vt2: songToVt2, exact text of a 2-pattern song', () => {
  const expected =
    '[Module]\nVortexTrackerII=1\nVersion=3.7\nTitle=demo\nAuthor=cpcbuild\nNoteTable=1\nChipFreq=1000000\nSpeed=6\nNoise=HEX\nPlayOrder=0,L1,1\n\n' +
    '[Ornament1]\n0,4,7,L0,4,7\n\n' +
    // Hi-hat (built-in 9, no loop: silent end line), Chord (built-in 5, loops from frame 3), custom Pluck B (loops from frame 1)
    '[Sample1]\n.N. +000_ +01_ A_\n.N. +000_ +01_ 6_\n.N. +000_ +02_ 3_\n.N. +000_ +02_ 1_\n... +000_ +00_ 0_ L\n\n' +
    '[Sample2]\nT.. +000_ +00_ F_\nT.. +000_ +00_ D_\nT.. +000_ +00_ D_\nT.. +000_ +00_ C_ L\nT.. +000_ +00_ C_\nT.. +000_ +00_ C_\n\n' +
    '[Sample3]\nT.. +000_ +00_ F_\nT.. +000_ +00_ A_ L\nT.. +000_ +00_ 6_\n\n' +
    pad(4) +
    '[Pattern0]\n' +
    '....|..|C-4 1F0F ....|C-5 2F19 ....|... .... ....\n' +
    '....|..|... .... ....|D-5 3F0. ....|... .... ....\n' +
    '....|..|R-- .... ....|... .... ....|... .... ....\n' +
    '....|..|... .... ....|E-5 3F0F ....|... .... ....\n\n' +
    '[Pattern1]\n' +
    '....|..|C-3 3F0F ....|... .... ....|... .... ....\n' +
    '....|..|... .... ....|... .... ....|... .... ....\n';

  it('matches the measured rules', () => {
    expect(songToVt2(smallSong(), 'demo')).toBe(expected);
  });

  it('is pure: the document is untouched and the text repeatable', () => {
    const d = smallSong();
    const before = JSON.stringify(d);
    expect(songToVt2(d, 'demo')).toBe(songToVt2(d, 'demo'));
    expect(JSON.stringify(d)).toBe(before);
  });

  it('a song with no pitch shapes still has [Ornament1] as L0; the loop defaults to the first position', () => {
    const d: SongDoc = { ...newSong(), instruments: [] };
    d.patterns[0].channels[0] = [{ row: 0, note: 60, inst: '2' }];
    const t = songToVt2(d, 'x');
    expect(t).toContain('PlayOrder=L0\n');
    expect(t).toContain('[Ornament1]\nL0\n');
    expect(t).toContain('C-4 1F0F ....');
  });

  it('a pitch shape without a loop holds its last value (L before the last value)', () => {
    const d = smallSong();
    d.instruments = [pluck('B', 15, { loop: undefined, frames: [0, 5, 12].map((p) => ({ pitch: p, tone: true, noise: false, noisePeriod: 0, volume: 9 })) })];
    expect(songToVt2(d, 'x')).toContain('[Ornament2]\n0,5,L12\n');
  });
});

describe('vt2: songToVt2 limits', () => {
  const noteOn = (inst: string, row: number) => ({ row, note: 60, inst });
  /** Customs B.. (distinct first-frame volume or pitch) plus the ten built-ins. */
  const IDS = 'BCDEFGHIJKLMNOPQRSTUV';
  const many = (n: number, shaped = false): SongDoc => {
    const customs = [...IDS].slice(0, Math.max(0, n - 10)).map((id, k) => pluck(id, (k % 15) + 1, shaped ? { frames: [{ pitch: k + 1, tone: true, noise: false, noisePeriod: 0, volume: 7 }], loop: undefined } : {}));
    const ids = [...'123456789A'.slice(0, Math.min(10, n)), ...customs.map((c) => c.id)];
    const d: SongDoc = { ...newSong(), instruments: customs };
    d.patterns[0] = { rows: 32, channels: [ids.map((id, row) => noteOn(id, row)), [], []] };
    return d;
  };

  it('sample digits: 1-9 then J..V for 10-22', () => {
    expect(sampleDigit(1)).toBe('1');
    expect(sampleDigit(9)).toBe('9');
    expect(sampleDigit(10)).toBe('J');
    expect(sampleDigit(22)).toBe('V');
    const lines = songToVt2(many(22), 'x').split('\n').filter((l) => l.startsWith('....|..|')).slice(0, 22);
    expect(lines.map((l) => l.slice(12, 13)).join('')).toBe('123456789JKLMNOPQRSTUV');
    expect(lines[8]).toContain('C-4 9F');
    expect(lines[9]).toContain('C-4 JF');
    expect(lines[21]).toContain('C-4 VF');
  });

  it('the 23rd instrument is an error naming the ones left out', () => {
    const d = many(23);
    expect(songProblems(many(22))).toEqual([]);
    expect(songProblems(d)).toEqual(['the song uses 23 different instruments, but the converter reaches 22: N (Pluck N) would be left out']);
    expect(() => songToVt2(d)).toThrow(Vt2Error);
  });

  it('identical pitch shapes share one ornament; different ones do not', () => {
    const shape = (id: string, pitches: number[]): SongInstrument => pluck(id, 15, { loop: undefined, frames: pitches.map((p) => ({ pitch: p, tone: true, noise: false, noisePeriod: 0, volume: 9 })) });
    const d = smallSong();
    d.instruments = [shape('B', [0, 4]), shape('C', [0, 4]), shape('D', [0, 3])];
    d.patterns[1].channels[2] = [{ row: 0, note: 60, inst: 'C' }, { row: 1, note: 60, inst: 'D' }];
    const t = songToVt2(d, 'x');
    expect(t.match(/^\[Ornament\d+\]$/gm)).toEqual(['[Ornament1]', '[Ornament2]', '[Ornament3]']);
    // Chord is ornament 1, B and C share ornament 2, D is ornament 3
    expect(t).toContain('[Ornament2]\n0,L4\n');
    expect(t).toContain('[Ornament3]\n0,L3\n');
  });

  it('15 pitch shapes (the built-in Bell, Chord, Kick, Snare and Zap count) are fine, the 16th is an error', () => {
    expect(songProblems(many(20, true))).toEqual([]);
    const sixteen = many(21, true);
    expect(songProblems(sixteen)).toEqual(['the song uses 16 different pitch shapes (instruments that change pitch while they play, such as Chord, Bell or Kick), but the converter reaches 15']);
  });

  it('document errors come first, with their path, and never throw', () => {
    const bad = { ...smallSong(), speed: 0 };
    expect(songProblems(bad)[0]).toBe('speed: speed must be a whole number 1-255');
    expect(() => songProblems(null)).not.toThrow();
    expect(() => songProblems({ patterns: 5 })).not.toThrow();
    expect(() => songToVt2(bad)).toThrow(/^speed:/);
  });
});

describe.skipIf(!haveSongTool)('vt2: golden against the real SongToAkg', () => {
  const run = (doc: SongDoc): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'songgolden-'));
    try {
      const vt2 = path.join(dir, 'song.vt2');
      const asm = path.join(dir, 'song.asm');
      fs.writeFileSync(vt2, songToVt2(doc, 'golden'));
      execFileSync(path.join(toolsDir, 'SongToAkg'), ['--labelPrefix', 'golden_', vt2, asm], { timeout: 120000 });
      return fs.readFileSync(asm, 'utf8');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  const count = (asm: string, what: string): number => asm.split('\n').filter((l) => new RegExp(`^(golden_)?${what}\\d+$`).test(l.trim())).length;

  it('the small song: exit 0, 3 instruments, 1 arpeggio, 2 patterns', () => {
    const asm = run(smallSong());
    expect(count(asm, 'Instrument')).toBe(3);
    expect(count(asm, 'Arpeggio')).toBe(1);
    expect(asm).toMatch(/db 1 +; Loop start index/);
  }, 130000);

  it('22 different instruments all arrive', () => {
    const noteOn = (inst: string, row: number) => ({ row, note: 60, inst });
    const customs = [...'BCDEFGHIJKLM'].map((id, k) => pluck(id, k + 1));
    const ids = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', ...customs.map((c) => c.id)];
    const d: SongDoc = { ...newSong(), instruments: customs };
    d.patterns[0] = { rows: 32, channels: [ids.map((id, row) => noteOn(id, row)), [], []] };
    expect(count(run(d), 'Instrument')).toBe(22);
  }, 130000);
});
