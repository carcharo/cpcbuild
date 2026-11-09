// AudioWorklet processor 'cpc-ay': plays per-frame register sets through the AY model, timed at 50 Hz.
// Tick k starts at output sample round(k * sampleRate / 50), counted on the audio clock, so the
// timing does not drift. Messages in:
//   { type: 'play', clock, regs: Int32Array (4 per frame: period, noisePeriod, mixer bits 1 = tone
//     2 = noise, volume) }                                       -- one voice, for effects
//   { type: 'playSong', clock, regs: Int32Array (9 per tick, see songPack.ts), loopTick (-1 none),
//     gain, startTick? }                                          -- three voices; at the end jump to loopTick
//   { type: 'setMute', mask }  (bit 0 = A ...)   { type: 'stop' }
// Messages out: { type: 'frame', n } as tick n starts (n = index into regs), { type: 'ended' } once
// the last frame has played in full or after a stop.
import { Ay, AyChip } from './ay';
import { SONG_STRIDE } from './songPack';

declare const registerProcessor: (name: string, ctor: unknown) => void;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_HZ = 50;

class CpcAy extends AudioWorkletProcessor {
  private ay: Ay | null = null;
  private chip: AyChip | null = null;
  private clock = 0;
  private gain = 1;
  private mute = 0;
  private regs: Int32Array | null = null;
  private stride = 4;
  private frames = 0;
  private loopTick = -1;
  private frame = -1; // index of the frame now sounding
  private played = 0; // frames started since play began (differs from frame after a loop jump)
  private pos = 0; // samples rendered since play began
  private nextAt = 0; // sample index at which the next frame starts

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent): void => {
      const d = ev.data as { type: string; clock?: number; regs?: Int32Array; loopTick?: number; gain?: number; startTick?: number; mask?: number };
      if (d.type === 'play' && d.regs && d.clock) {
        if (!this.ay || this.clock !== d.clock) {
          this.ay = new Ay(d.clock, sampleRate);
          this.clock = d.clock;
        }
        this.ay.reset();
        this.chip = null;
        this.begin(d.regs, 4, -1, 0);
      } else if (d.type === 'playSong' && d.regs && d.clock) {
        this.gain = d.gain ?? 1;
        this.chip = new AyChip(d.clock, sampleRate, { gain: this.gain });
        this.chip.setMute(this.mute);
        this.ay = null;
        this.clock = 0;
        this.begin(d.regs, SONG_STRIDE, d.loopTick ?? -1, d.startTick ?? 0);
      } else if (d.type === 'setMute') {
        this.mute = (d.mask ?? 0) & 7;
        this.chip?.setMute(this.mute);
      } else if (d.type === 'stop' && this.regs) {
        this.regs = null;
        this.port.postMessage({ type: 'ended' });
      }
    };
  }

  private begin(regs: Int32Array, stride: number, loopTick: number, startTick: number): void {
    this.regs = regs;
    this.stride = stride;
    this.frames = Math.floor(regs.length / stride);
    this.loopTick = loopTick;
    this.frame = Math.min(Math.max(0, startTick | 0), this.frames) - 1;
    this.played = 0;
    this.pos = 0;
    this.nextAt = 0;
  }

  process(_in: Float32Array[][], out: Float32Array[][]): boolean {
    const o = out[0][0];
    const regs = this.regs, ay = this.ay, chip = this.chip;
    if (!regs || !(ay || chip)) return true; // idle: the output is already silent
    let i = 0;
    while (i < o.length && this.regs) {
      if (this.pos >= this.nextAt) {
        let f = this.frame + 1;
        if (f >= this.frames && this.loopTick >= 0 && this.loopTick < this.frames) f = this.loopTick;
        if (f >= this.frames) {
          this.regs = null;
          o.fill(0, i);
          this.port.postMessage({ type: 'ended' });
          break;
        }
        this.frame = f;
        this.played++;
        this.nextAt = Math.round((this.played * sampleRate) / FRAME_HZ);
        const r = f * this.stride;
        if (chip) {
          const m = regs[r + 4];
          chip.setChannel(0, regs[r], (m & 1) !== 0, (m & 8) !== 0, regs[r + 5]);
          chip.setChannel(1, regs[r + 1], (m & 2) !== 0, (m & 16) !== 0, regs[r + 6]);
          chip.setChannel(2, regs[r + 2], (m & 4) !== 0, (m & 32) !== 0, regs[r + 7]);
          chip.setNoise(regs[r + 3]);
        } else if (ay) {
          ay.set(regs[r], regs[r + 1], (regs[r + 2] & 1) !== 0, (regs[r + 2] & 2) !== 0, regs[r + 3]);
        }
        this.port.postMessage({ type: 'frame', n: f });
      }
      const n = Math.min(o.length - i, this.nextAt - this.pos);
      if (chip) chip.render(o, i, n);
      else ay!.render(o, i, n);
      i += n;
      this.pos += n;
    }
    for (let c = 1; c < out[0].length; c++) out[0][c].set(o);
    return true;
  }
}
registerProcessor('cpc-ay', CpcAy);
