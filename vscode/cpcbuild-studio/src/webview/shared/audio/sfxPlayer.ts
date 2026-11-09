/**
 * sfxPlayer.ts -- main-thread side of the sound preview. createSfxPlayer(ctx, workletUrl) loads the
 * 'cpc-ay' worklet (dist/webview/ayWorklet.js) on first play and returns a small player: play() sends
 * the effect's per-frame registers to the worklet, which times them at 50 Hz from the audio clock.
 * The AudioContext must be created or resumed from a user gesture (play() calls resume()).
 */
import type { SongFrames } from '../../../core/songFrames';
import { CPC_CLOCK, frameRegs, type SfxFrameLike } from './ay';
import { packSong } from './songPack';

export interface SfxPlayer {
  /** Start the effect (replacing any playing one). Resolves once the worklet has the frames. */
  play(frames: readonly SfxFrameLike[]): Promise<void>;
  /**
   * Play a song's frames on three voices (gain 0.5 so three loud channels do not clip); it jumps to
   * frames.loopTick at the end, or ends when there is none. onFrame(n) then reports tick indexes.
   */
  playSong(frames: SongFrames, opts?: { startTick?: number }): Promise<void>;
  /** Mute channels while a song plays: bit 0 = A, bit 1 = B, bit 2 = C. Kept across songs. */
  setMute(mask: number): void;
  /** Stop at once; 'ended' fires if something was playing. */
  stop(): void;
  /** Called as frame n (0-based) starts sounding. Returns an unsubscribe function. */
  onFrame(cb: (n: number) => void): () => void;
  /** Called when playback finishes or is stopped. Returns an unsubscribe function. */
  onEnded(cb: () => void): () => void;
}

const SONG_GAIN = 0.5;

export function createSfxPlayer(ctx: AudioContext, workletUrl: string): SfxPlayer {
  const frameCbs = new Set<(n: number) => void>();
  const endedCbs = new Set<() => void>();
  let node: AudioWorkletNode | null = null;
  let muteMask = 0;
  let loading: Promise<AudioWorkletNode> | null = null;

  const ensure = (): Promise<AudioWorkletNode> => {
    if (node) return Promise.resolve(node);
    loading ??= ctx.audioWorklet.addModule(workletUrl).then(() => {
      const n = new AudioWorkletNode(ctx, 'cpc-ay', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      n.port.onmessage = (ev: MessageEvent): void => {
        const d = ev.data as { type: string; n?: number };
        if (d.type === 'frame') frameCbs.forEach((cb) => cb(d.n as number));
        else if (d.type === 'ended') endedCbs.forEach((cb) => cb());
      };
      n.connect(ctx.destination);
      node = n;
      return n;
    });
    loading.catch(() => { loading = null; }); // allow a retry after a failed load
    return loading;
  };

  return {
    async play(frames) {
      const clock = CPC_CLOCK;
      const regs = new Int32Array(frames.length * 4);
      frames.forEach((f, i) => regs.set(frameRegs(f, clock), i * 4));
      if (ctx.state === 'suspended') await ctx.resume();
      const n = await ensure();
      n.port.postMessage({ type: 'play', clock, regs }, [regs.buffer]);
    },
    async playSong(frames, opts) {
      const regs = packSong(frames);
      if (ctx.state === 'suspended') await ctx.resume();
      const n = await ensure();
      n.port.postMessage({ type: 'playSong', clock: CPC_CLOCK, regs, loopTick: frames.loopTick, gain: SONG_GAIN, startTick: opts?.startTick ?? 0 }, [regs.buffer]);
      n.port.postMessage({ type: 'setMute', mask: muteMask });
    },
    setMute(mask) {
      muteMask = mask & 7;
      node?.port.postMessage({ type: 'setMute', mask: muteMask });
    },
    stop() {
      node?.port.postMessage({ type: 'stop' });
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => { frameCbs.delete(cb); };
    },
    onEnded(cb) {
      endedCbs.add(cb);
      return () => { endedCbs.delete(cb); };
    },
  };
}
