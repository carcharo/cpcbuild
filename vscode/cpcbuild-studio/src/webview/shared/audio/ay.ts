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

export class Ay {
  private readonly ticksPerSample: number; // chip ticks (clock / 8) per output sample
  private readonly hpCoef: number;
  // registers (channel A)
  private tonePeriod = 1;
  private noiseRate = 2; // ticks per LFSR step = 2 * noisePeriod
  private toneOn = true;
  private noiseOn = false;
  private level = 0;
  // state
  private toneCount = 0;
  private noiseCount = 0;
  private toneBit = true;
  private lfsr = LFSR_SEED;
  private acc = 0; // fractional chip ticks carried between samples
  private last = 0; // last raw level, held when a sample spans no tick
  private hpX = 0;
  private hpY = 0;

  constructor(readonly clock: number, readonly sampleRate: number) {
    this.ticksPerSample = clock / 8 / sampleRate;
    this.hpCoef = Math.exp((-2 * Math.PI * 20) / sampleRate);
  }

  /** Set channel A's registers: tone period 0-4095, noise period 0-31, mixer enables, volume 0-15. */
  set(period: number, noisePeriod: number, tone: boolean, noise: boolean, volume: number): void {
    this.tonePeriod = Math.min(4095, Math.max(1, period | 0));
    this.noiseRate = 2 * Math.min(31, Math.max(1, noisePeriod | 0));
    this.toneOn = tone;
    this.noiseOn = noise;
    this.level = LEVELS[Math.min(15, Math.max(0, volume | 0))];
  }

  /** Back to power-on state (counters, LFSR, filter); registers are kept. */
  reset(): void {
    this.toneCount = 0;
    this.noiseCount = 0;
    this.toneBit = true;
    this.lfsr = LFSR_SEED;
    this.acc = 0;
    this.last = 0;
    this.hpX = 0;
    this.hpY = 0;
  }

  /** Fill out[start .. start + n) with mono samples in [-0.5, 0.5]. */
  render(out: Float32Array, start: number, n: number): void {
    const level = this.level, a = this.hpCoef;
    let { toneCount, noiseCount, toneBit, lfsr, acc, last, hpX, hpY } = this;
    const period = this.tonePeriod, noiseRate = this.noiseRate, toneOn = this.toneOn, noiseOn = this.noiseOn;
    const tps = this.ticksPerSample;
    for (let i = 0; i < n; i++) {
      acc += tps;
      const ticks = acc | 0;
      acc -= ticks;
      if (ticks > 0) {
        let sum = 0;
        for (let t = 0; t < ticks; t++) {
          if (++toneCount >= period) {
            toneCount = 0;
            toneBit = !toneBit;
          }
          if (++noiseCount >= noiseRate) {
            noiseCount = 0;
            lfsr = lfsrNext(lfsr);
          }
          sum += (toneBit || !toneOn) && ((lfsr & 1) === 1 || !noiseOn) ? 1 : 0;
        }
        last = sum / ticks;
      }
      const x = (last - 0.5) * level; // centred on half the level, so a volume step stays within +-0.5
      hpY = a * (hpY + x - hpX);
      hpX = x;
      out[start + i] = hpY;
    }
    this.toneCount = toneCount;
    this.noiseCount = noiseCount;
    this.toneBit = toneBit;
    this.lfsr = lfsr;
    this.acc = acc;
    this.last = last;
    this.hpX = hpX;
    this.hpY = hpY;
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
