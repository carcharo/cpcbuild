/**
 * ay.ts -- a small AY-3-8912 model for the in-editor sound preview. Pure (no DOM, no vscode), so the
 * worklet and vitest both use it. Written from the chip's documented behaviour, one voice (channel A):
 *   - tone: a square wave at clock / (16 * period), period 1-4095 (0 acts as 1);
 *   - noise: a 17-bit LFSR (new bit = bit0 XOR bit3, shifted in at bit 16, output bit0) stepped at
 *     clock / (16 * noisePeriod), noisePeriod 1-31 (0 acts as 1);
 *   - mixer: out = (tone OR tone_off) AND (noise OR noise_off);
 *   - volume: 0 is silent, 1-15 gives 2^((v - 15) / 2), about 3 dB per step;
 *   - output scaled to [-0.5, 0.5] with the DC removed by a one-pole high-pass (about 20 Hz).
 * The chip's tone divider runs at clock / 8 and flips the output each time it counts `period`; the
 * noise divider is half as fast again, so it steps every 2 * noisePeriod of those ticks. Each output
 * sample is the average of the chip ticks that fall inside it (a box filter), which keeps the high
 * notes from aliasing too harshly. No allocation happens per sample.
 */

/** The CPC's AY clock in Hz (1 MHz). The preview models the CPC only. */
export const CPC_CLOCK = 1_000_000;

/** The effect frame fields the preview needs (the same shape as the .cpcsfx frames). */
export interface SfxFrameLike {
  pitch: number;
  tone: boolean;
  noise: boolean;
  noisePeriod: number;
  volume: number;
}

/** Tone period for a fractional note number (60 = C-4): round(clock / 16 / (440 * 2^((pitch - 69) / 12))), 1-4095. */
export function notePeriod(pitch: number, clock: number): number {
  const p = Math.round(clock / 16 / (440 * Math.pow(2, (pitch - 69) / 12)));
  return Math.min(4095, Math.max(1, p));
}

/** Level for volume 0-15: 0 is silent, 15 is 1.0, then 2^((v - 15) / 2). */
export function volumeLevel(v: number): number {
  const i = Math.min(15, Math.max(0, v | 0));
  return i === 0 ? 0 : Math.pow(2, (i - 15) / 2);
}

/** The mixer rule for one channel (the datasheet's truth table). */
export function mixBit(tone: boolean, noise: boolean, toneEnabled: boolean, noiseEnabled: boolean): boolean {
  return (tone || !toneEnabled) && (noise || !noiseEnabled);
}

const LFSR_SEED = 1;
const lfsrNext = (s: number): number => (s >> 1) | (((s ^ (s >> 3)) & 1) << 16);

const LEVELS = new Float64Array(16);
for (let v = 0; v < 16; v++) LEVELS[v] = volumeLevel(v);

/**
 * The full chip: three tone channels (A, B, C), each with its own period, volume, tone and noise
 * enables, and one shared noise generator. Output = the sum of the channels' `(bit - 0.5) * level`
 * times `gain`, then the one-pole high-pass. Muted channels (setMute) contribute nothing.
 */
export class AyChip {
  private readonly ticksPerSample: number; // chip ticks (clock / 8) per output sample
  private readonly hpCoef: number;
  private readonly gain: number;
  // registers
  private readonly period = new Int32Array([1, 1, 1]);
  private readonly toneOn = new Uint8Array([1, 1, 1]);
  private readonly noiseOn = new Uint8Array([0, 0, 0]);
  private readonly level = new Float64Array(3);
  private noiseRate = 2; // ticks per LFSR step = 2 * noisePeriod
  private muteMask = 0;
  // state
  private readonly toneCount = new Int32Array(3);
  private readonly toneBit = new Uint8Array([1, 1, 1]);
  private readonly last = new Float64Array(3); // last raw level per channel, held when a sample spans no tick
  private noiseCount = 0;
  private lfsr = LFSR_SEED;
  private acc = 0; // fractional chip ticks carried between samples
  private hpX = 0;
  private hpY = 0;

  constructor(readonly clock: number, readonly sampleRate: number, opts: { gain?: number } = {}) {
    this.ticksPerSample = clock / 8 / sampleRate;
    this.hpCoef = Math.exp((-2 * Math.PI * 20) / sampleRate);
    this.gain = opts.gain ?? 1;
  }

  /** Set channel ch (0 = A, 1 = B, 2 = C): tone period 0-4095, mixer enables, volume 0-15. */
  setChannel(ch: number, period: number, tone: boolean, noise: boolean, volume: number): void {
    this.period[ch] = Math.min(4095, Math.max(1, period | 0));
    this.toneOn[ch] = tone ? 1 : 0;
    this.noiseOn[ch] = noise ? 1 : 0;
    this.level[ch] = LEVELS[Math.min(15, Math.max(0, volume | 0))];
  }

  /** The shared noise period, 0-31 (0 acts as 1). */
  setNoise(period: number): void {
    this.noiseRate = 2 * Math.min(31, Math.max(1, period | 0));
  }

  /** Bit 0 = A, bit 1 = B, bit 2 = C: a muted channel contributes 0. */
  setMute(mask: number): void {
    this.muteMask = mask & 7;
  }

  /** Back to power-on state (counters, LFSR, filter); registers and mute are kept. */
  reset(): void {
    this.toneCount.fill(0);
    this.toneBit.fill(1);
    this.last.fill(0);
    this.noiseCount = 0;
    this.lfsr = LFSR_SEED;
    this.acc = 0;
    this.hpX = 0;
    this.hpY = 0;
  }

  /** Fill out[start .. start + n) with mono samples (full scale is +-0.5 per unit of gain). */
  render(out: Float32Array, start: number, n: number): void {
    const a = this.hpCoef, gain = this.gain, tps = this.ticksPerSample, noiseRate = this.noiseRate;
    const { period, toneOn, noiseOn, level, toneCount, toneBit, last } = this;
    const mute = this.muteMask;
    let { noiseCount, lfsr, acc, hpX, hpY } = this;
    for (let i = 0; i < n; i++) {
      acc += tps;
      const ticks = acc | 0;
      acc -= ticks;
      if (ticks > 0) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let t = 0; t < ticks; t++) {
          if (++toneCount[0] >= period[0]) { toneCount[0] = 0; toneBit[0] ^= 1; }
          if (++toneCount[1] >= period[1]) { toneCount[1] = 0; toneBit[1] ^= 1; }
          if (++toneCount[2] >= period[2]) { toneCount[2] = 0; toneBit[2] ^= 1; }
          if (++noiseCount >= noiseRate) {
            noiseCount = 0;
            lfsr = lfsrNext(lfsr);
          }
          const nb = lfsr & 1;
          if ((toneBit[0] === 1 || toneOn[0] === 0) && (nb === 1 || noiseOn[0] === 0)) s0++;
          if ((toneBit[1] === 1 || toneOn[1] === 0) && (nb === 1 || noiseOn[1] === 0)) s1++;
          if ((toneBit[2] === 1 || toneOn[2] === 0) && (nb === 1 || noiseOn[2] === 0)) s2++;
        }
        last[0] = s0 / ticks;
        last[1] = s1 / ticks;
        last[2] = s2 / ticks;
      }
      // each channel centred on half its level, so a volume step stays within +-0.5
      const x = (((mute & 1) === 0 ? (last[0] - 0.5) * level[0] : 0) +
        ((mute & 2) === 0 ? (last[1] - 0.5) * level[1] : 0) +
        ((mute & 4) === 0 ? (last[2] - 0.5) * level[2] : 0)) * gain;
      hpY = a * (hpY + x - hpX);
      hpX = x;
      out[start + i] = hpY;
    }
    this.noiseCount = noiseCount;
    this.lfsr = lfsr;
    this.acc = acc;
    this.hpX = hpX;
    this.hpY = hpY;
  }
}

/** One voice (channel A of the full chip), used by the effects preview. */
export class Ay {
  private readonly chip: AyChip;

  constructor(readonly clock: number, readonly sampleRate: number) {
    this.chip = new AyChip(clock, sampleRate);
    this.chip.setChannel(1, 1, true, false, 0);
    this.chip.setChannel(2, 1, true, false, 0);
  }

  /** Set channel A's registers: tone period 0-4095, noise period 0-31, mixer enables, volume 0-15. */
  set(period: number, noisePeriod: number, tone: boolean, noise: boolean, volume: number): void {
    this.chip.setChannel(0, period, tone, noise, volume);
    this.chip.setNoise(noisePeriod);
  }

  /** Back to power-on state (counters, LFSR, filter); registers are kept. */
  reset(): void {
    this.chip.reset();
  }

  /** Fill out[start .. start + n) with mono samples in [-0.5, 0.5]. */
  render(out: Float32Array, start: number, n: number): void {
    this.chip.render(out, start, n);
  }
}

/** The first n noise outputs (bit0) of the LFSR from seed 1: output k is read, then the register steps. */
export function lfsrOutputs(n: number): number[] {
  const r: number[] = [];
  let s = LFSR_SEED;
  for (let i = 0; i < n; i++) {
    r.push(s & 1);
    s = lfsrNext(s);
  }
  return r;
}

/** Number of steps before the LFSR returns to its seed (131071 for a maximal 17-bit register). */
export function lfsrPeriod(): number {
  let s = lfsrNext(LFSR_SEED), n = 1;
  while (s !== LFSR_SEED) {
    s = lfsrNext(s);
    n++;
  }
  return n;
}

/** Registers the player writes for one effect frame, as 4 ints: period, noisePeriod, mixer (1 tone, 2 noise), volume. */
export function frameRegs(f: SfxFrameLike, clock: number): [number, number, number, number] {
  return [notePeriod(f.pitch, clock), Math.min(31, Math.max(0, f.noisePeriod | 0)), (f.tone ? 1 : 0) | (f.noise ? 2 : 0), Math.min(15, Math.max(0, f.volume | 0))];
}
