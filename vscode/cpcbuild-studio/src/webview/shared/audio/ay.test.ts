import { describe, expect, it } from 'vitest';
import { Ay, AyChip, CPC_CLOCK, frameRegs, lfsrOutputs, lfsrPeriod, mixBit, notePeriod, volumeLevel } from './ay';

const SR = 48000;

function renderSeconds(ay: Ay, seconds: number, sr = SR): Float32Array {
  const out = new Float32Array(Math.round(seconds * sr));
  for (let i = 0; i < out.length; i += 128) ay.render(out, i, Math.min(128, out.length - i)); // worklet-sized blocks
  return out;
}

function crossings(s: Float32Array): number {
  let n = 0;
  for (let i = 1; i < s.length; i++) if ((s[i - 1] < 0) !== (s[i] < 0)) n++;
  return n;
}

describe('tone', () => {
  it('period 142 at 1 MHz gives 440.1 Hz (zero crossings over 1 s at 48 kHz)', () => {
    const ay = new Ay(CPC_CLOCK, SR);
    ay.set(142, 0, true, false, 15);
    const s = renderSeconds(ay, 1);
    // 1e6 / (16 * 142) = 440.14 Hz = 880.3 crossings per second; allow the start/end edges.
    expect(Math.abs(crossings(s) - 880.3)).toBeLessThanOrEqual(2);
    expect(crossings(s) / 2).toBeCloseTo(440.14, 0);
  });

  it('is a square wave of about +-0.5 at full volume (the high-pass and the first edge overshoot a little)', () => {
    const ay = new Ay(CPC_CLOCK, SR);
    ay.set(142, 0, true, false, 15);
    const s = renderSeconds(ay, 0.5);
    const max = Math.max(...s), min = Math.min(...s);
    expect(max).toBeLessThanOrEqual(0.6);
    expect(max).toBeGreaterThan(0.45);
    expect(min).toBeGreaterThanOrEqual(-0.6);
    expect(min).toBeLessThan(-0.45);
  });

  it('period 0 acts as 1 and 4095 is the lowest note', () => {
    const lo = new Ay(CPC_CLOCK, SR), z = new Ay(CPC_CLOCK, SR), one = new Ay(CPC_CLOCK, SR);
    lo.set(9999, 0, true, false, 15);
    z.set(0, 0, true, false, 15);
    one.set(1, 0, true, false, 15);
    expect(renderSeconds(z, 0.1)).toEqual(renderSeconds(one, 0.1));
    expect(crossings(renderSeconds(lo, 1)) / 2).toBeCloseTo(1e6 / 16 / 4095, 0); // 15.26 Hz
  });
});

describe('notePeriod', () => {
  it('matches the spec table (CPC 1 MHz)', () => {
    const t: [number, number][] = [
      [24, 1911], // C-1
      [45, 568], // A-2
      [60, 239], // C-4
      [69, 142], // A-4
      [72, 119], // C-5
      [91, 40], // G-6
      [107, 16], // B-7
    ];
    for (const [m, cpc] of t) {
      expect(notePeriod(m, CPC_CLOCK)).toBe(cpc);
    }
  });

  it('clamps to 1-4095', () => {
    expect(notePeriod(200, CPC_CLOCK)).toBe(1);
    expect(notePeriod(-50, CPC_CLOCK)).toBe(4095);
  });

  it('frameRegs packs period, noise period, mixer and volume', () => {
    expect(frameRegs({ pitch: 69, tone: true, noise: true, noisePeriod: 7, volume: 12 }, CPC_CLOCK)).toEqual([142, 7, 3, 12]);
    expect(frameRegs({ pitch: 60, tone: false, noise: true, noisePeriod: 40, volume: 20 }, CPC_CLOCK)).toEqual([239, 31, 2, 15]);
  });
});

describe('volume', () => {
  it('level 0 is silent, 15 is 1.0, each step is 2^(1/2) (about 3 dB)', () => {
    expect(volumeLevel(0)).toBe(0);
    expect(volumeLevel(15)).toBe(1);
    expect(volumeLevel(14)).toBeCloseTo(0.70711, 5);
    expect(volumeLevel(13)).toBeCloseTo(0.5, 5);
    expect(volumeLevel(9)).toBeCloseTo(0.125, 5);
    expect(volumeLevel(1)).toBeCloseTo(Math.pow(2, -7), 8);
    for (let v = 2; v <= 15; v++) expect(volumeLevel(v) / volumeLevel(v - 1)).toBeCloseTo(Math.SQRT2, 9);
  });

  it('output peak follows the level', () => {
    const peak = (v: number): number => {
      const ay = new Ay(CPC_CLOCK, SR);
      ay.set(142, 0, true, false, v);
      return Math.max(...renderSeconds(ay, 0.2));
    };
    expect(peak(11) / peak(15)).toBeCloseTo(0.25, 1);
  });

  it('volume 0 is exactly silent, whatever the mixer', () => {
    for (const [t, n] of [[true, false], [false, true], [true, true], [false, false]]) {
      const ay = new Ay(CPC_CLOCK, SR);
      ay.set(142, 5, t, n, 0);
      expect(renderSeconds(ay, 0.2).every((x) => x === 0)).toBe(true);
    }
  });
});

describe('noise LFSR', () => {
  // 17-bit register, seed 1, output = bit0, new bit = bit0 XOR bit3 entering at bit 16.
  // Bit j of the register at step k is the feedback bit made 17 - j steps earlier, so the outputs
  // obey o[m] = o[m-17] XOR o[m-14]. The seed has bit0 set only: o[0] = 1, o[1..16] = 0.
  // Then o[17] = o[0]^o[3] = 1; o[18..30] = 0 (their taps are both inside 1..16 or 0);
  // o[31] = o[14]^o[17] = 1. So the first 32 outputs have ones at 0, 17 and 31 only.
  const expected = Array.from({ length: 32 }, (_, i) => (i === 0 || i === 17 || i === 31 ? 1 : 0));

  it('first 32 outputs from seed 1', () => {
    expect(lfsrOutputs(32)).toEqual(expected);
  });

  it('keeps going by the same recurrence, and has the full 131071-step period', () => {
    const o = lfsrOutputs(400);
    for (let m = 17; m < o.length; m++) expect(o[m]).toBe(o[m - 17] ^ o[m - 14]);
    expect(lfsrPeriod()).toBe(131071);
  });

  it('the model steps the noise every 16 * noisePeriod chip cycles', () => {
    // Noise only, noise period 31 at 1 MHz: 1e6 / (16 * 31) = 2016 LFSR steps per second.
    // Count output level changes over 1 s and compare with the model sequence run for 2016 steps.
    const ay = new Ay(CPC_CLOCK, 192000); // above the tick rate, so every tick is seen
    ay.set(1, 31, false, true, 15);
    const s = renderSeconds(ay, 1, 192000);
    const seq = lfsrOutputs(2017);
    let changes = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes++;
    let seen = 0;
    for (let i = 1; i < s.length; i++) if (Math.abs(s[i] - s[i - 1]) > 0.2) seen++;
    // each level change shows as a step (up) and the high-pass decays between; allow a few at the edges
    expect(Math.abs(seen - changes)).toBeLessThanOrEqual(4);
  });
});

describe('mixer', () => {
  it('out = (tone OR tone_off) AND (noise OR noise_off)', () => {
    const rows: [boolean, boolean, boolean, boolean, boolean][] = [
      // tone, noise, toneEnabled, noiseEnabled, out
      [false, false, true, true, false],
      [true, false, true, true, false],
      [false, true, true, true, false],
      [true, true, true, true, true],
      [false, false, true, false, false], // tone only
      [true, false, true, false, true],
      [false, true, true, false, false],
      [false, false, false, true, false], // noise only
      [false, true, false, true, true],
      [true, false, false, true, false],
      [false, false, false, false, true], // both off: constant high
      [true, true, false, false, true],
    ];
    for (const [t, n, te, ne, out] of rows) expect(mixBit(t, n, te, ne)).toBe(out);
  });

  it('both off is a constant level: no sound after the DC filter settles', () => {
    const ay = new Ay(CPC_CLOCK, SR);
    ay.set(142, 5, false, false, 15);
    const s = renderSeconds(ay, 1);
    expect(Math.max(...s.subarray(SR / 2).map(Math.abs))).toBeLessThan(0.01);
  });
});

describe('Ay is unchanged by the AyChip refactor', () => {
  // FNV-1a over the float32 bits of 1 s of output, with register changes every 20 ms. The constants
  // were taken from the implementation before Ay became a wrapper over AyChip channel A.
  const REFERENCE: Record<number, number> = { 48000: 229337137, 44100: 1488754291 };
  const regs: [number, number, boolean, boolean, number][] = [
    [142, 0, true, false, 15], [239, 7, true, true, 12], [1, 31, false, true, 9],
    [4095, 3, true, false, 3], [60, 0, false, false, 15], [119, 16, true, true, 1],
  ];
  for (const sr of [48000, 44100]) {
    it(`bit-identical output at ${sr} Hz`, () => {
      const ay = new Ay(CPC_CLOCK, sr);
      const out = new Float32Array(sr);
      let pos = 0, k = 0;
      while (pos < out.length) {
        const r = regs[k++ % regs.length];
        ay.set(r[0], r[1], r[2], r[3], r[4]);
        const n = Math.min(Math.round(sr / 50), out.length - pos);
        ay.render(out, pos, n);
        pos += n;
      }
      const u = new Uint32Array(out.buffer);
      let h = 2166136261;
      for (let i = 0; i < u.length; i++) {
        h ^= u[i];
        h = Math.imul(h, 16777619) >>> 0;
      }
      expect(h).toBe(REFERENCE[sr]);
    });
  }
});

describe('AyChip', () => {
  const tone = (chip: AyChip, ch: number, period: number, vol = 15): void => chip.setChannel(ch, period, true, false, vol);

  it('two tone channels sum: A at 142 plus B at 71 has the energy of both', () => {
    const only = (setup: (c: AyChip) => void): Float32Array => {
      const c = new AyChip(CPC_CLOCK, SR);
      setup(c);
      return renderSeconds(c as unknown as Ay, 0.5);
    };
    const a = only((c) => tone(c, 0, 142));
    const b = only((c) => tone(c, 1, 71));
    const ab = only((c) => { tone(c, 0, 142); tone(c, 1, 71); });
    for (let i = 0; i < ab.length; i += 97) expect(ab[i]).toBeCloseTo(a[i] + b[i], 5);
    expect(Math.max(...ab)).toBeGreaterThan(Math.max(...a) * 1.5);
  });

  it('mute removes one channel and leaves the other as it was', () => {
    const mk = (mask: number): Float32Array => {
      const c = new AyChip(CPC_CLOCK, SR);
      tone(c, 0, 142);
      tone(c, 1, 71);
      c.setMute(mask);
      return renderSeconds(c as unknown as Ay, 0.3);
    };
    const solo = new AyChip(CPC_CLOCK, SR);
    tone(solo, 0, 142);
    expect(mk(2)).toEqual(renderSeconds(solo as unknown as Ay, 0.3));
    expect(mk(7).every((x) => x === 0)).toBe(true);
  });

  it('noise is shared: channels with noise on and the same noise period give identical noise', () => {
    const mk = (chs: number[]): Float32Array => {
      const c = new AyChip(CPC_CLOCK, 192000);
      c.setNoise(9);
      for (const ch of chs) c.setChannel(ch, 1, false, true, 15);
      return renderSeconds(c as unknown as Ay, 0.2, 192000);
    };
    const one = mk([0]), two = mk([0, 2]);
    for (let i = 0; i < one.length; i += 53) expect(two[i]).toBeCloseTo(one[i] * 2, 5);
  });

  it('gain scales the output', () => {
    const mk = (gain: number): Float32Array => {
      const c = new AyChip(CPC_CLOCK, SR, { gain });
      tone(c, 0, 142);
      return renderSeconds(c as unknown as Ay, 0.2);
    };
    const full = mk(1), half = mk(0.5);
    for (let i = 0; i < full.length; i += 31) expect(half[i]).toBeCloseTo(full[i] / 2, 6);
  });

  it('channel volume 0 is silent on that channel only', () => {
    const c = new AyChip(CPC_CLOCK, SR);
    tone(c, 0, 142, 0);
    tone(c, 1, 142, 15);
    const solo = new AyChip(CPC_CLOCK, SR);
    tone(solo, 1, 142, 15);
    expect(renderSeconds(c as unknown as Ay, 0.2)).toEqual(renderSeconds(solo as unknown as Ay, 0.2));
  });
});
