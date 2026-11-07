// AudioWorklet processor 'cpc-ay': plays a list of per-frame register sets through the AY model.
// Frame k starts at output sample round(k * sampleRate / 50), counted on the audio clock, so the
// 50 Hz timing does not drift. Messages in:  { type: 'play', clock, regs: Int32Array (4 per frame:
// period, noisePeriod, mixer bits 1 = tone 2 = noise, volume) }  and  { type: 'stop' }.
// Messages out: { type: 'frame', n } as frame n starts, { type: 'ended' } once the last frame has
// played in full or after a stop.
import { Ay } from './ay';

declare const registerProcessor: (name: string, ctor: unknown) => void;
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

const FRAME_HZ = 50;

class CpcAy extends AudioWorkletProcessor {
  private ay: Ay | null = null;
  private clock = 0;
  private regs: Int32Array | null = null;
  private frames = 0;
  private frame = -1; // index of the frame now sounding
  private pos = 0; // samples rendered since play began
  private nextAt = 0; // sample index at which frame + 1 starts

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent): void => {
      const d = ev.data as { type: string; clock?: number; regs?: Int32Array };
      if (d.type === 'play' && d.regs && d.clock) {
        if (!this.ay || this.clock !== d.clock) {
          this.ay = new Ay(d.clock, sampleRate);
          this.clock = d.clock;
        }
        this.ay.reset();
        this.regs = d.regs;
        this.frames = d.regs.length >> 2;
        this.frame = -1;
        this.pos = 0;
        this.nextAt = 0;
      } else if (d.type === 'stop' && this.regs) {
        this.regs = null;
        this.port.postMessage({ type: 'ended' });
      }
    };
  }

  process(_in: Float32Array[][], out: Float32Array[][]): boolean {
    const o = out[0][0];
    const regs = this.regs, ay = this.ay;
    if (!regs || !ay) return true; // idle: the output is already silent
    let i = 0;
    while (i < o.length && this.regs) {
      if (this.pos >= this.nextAt) {
        const f = this.frame + 1;
        if (f >= this.frames) {
          this.regs = null;
          o.fill(0, i);
          this.port.postMessage({ type: 'ended' });
          break;
        }
        this.frame = f;
        this.nextAt = Math.round(((f + 1) * sampleRate) / FRAME_HZ);
        const r = f << 2;
        ay.set(regs[r], regs[r + 1], (regs[r + 2] & 1) !== 0, (regs[r + 2] & 2) !== 0, regs[r + 3]);
        this.port.postMessage({ type: 'frame', n: f });
      }
      const n = Math.min(o.length - i, this.nextAt - this.pos);
      ay.render(o, i, n);
      i += n;
      this.pos += n;
    }
    for (let c = 1; c < out[0].length; c++) out[0][c].set(o);
    return true;
  }
}
registerProcessor('cpc-ay', CpcAy);
