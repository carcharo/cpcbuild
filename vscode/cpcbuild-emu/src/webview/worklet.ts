// AudioWorklet processor: plays the 16-bit stereo frames the page pushes, reports how many sample pairs it
// has consumed so the page can pace the emulator by the audio clock (docs/phase8-design.md section 4).
declare const registerProcessor: (name: string, ctor: unknown) => void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class CpcOut extends AudioWorkletProcessor {
  private chunks: Int16Array[] = [];
  private pos = 0;
  private consumed = 0;
  private blocks = 0;

  constructor() {
    super();
    this.port.onmessage = (ev: MessageEvent): void => {
      const d = ev.data as { samples?: Int16Array; clear?: boolean };
      if (d.clear) {
        this.chunks = [];
        this.pos = 0;
        this.consumed = 0;
      } else if (d.samples) this.chunks.push(d.samples);
    };
  }

  process(_in: Float32Array[][], out: Float32Array[][]): boolean {
    const l = out[0][0], r = out[0][1] ?? out[0][0];
    let n = 0;
    while (n < l.length && this.chunks.length) {
      const c = this.chunks[0];
      while (n < l.length && this.pos < c.length) {
        l[n] = c[this.pos] / 32768;
        r[n] = c[this.pos + 1] / 32768;
        this.pos += 2;
        n++;
        this.consumed++;
      }
      if (this.pos >= c.length) {
        this.chunks.shift();
        this.pos = 0;
      }
    }
    for (; n < l.length; n++) l[n] = r[n] = 0; // underrun: silence
    if (++this.blocks % 4 === 0) this.port.postMessage({ consumed: this.consumed });
    return true;
  }
}
registerProcessor('cpc-out', CpcOut);
