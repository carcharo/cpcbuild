/**
 * Messages between the extension host and the emulator webview (typed, with ids).
 *
 * Host -> webview: `HostRequest` (every one is answered by exactly one `ResponseMsg` with the same id).
 * Webview -> host: `ResponseMsg`, plus unsolicited `WebviewNotice`s.
 */
import type { EmuModel, EmuState } from '../emuApi';

export type HostRequest = { id: number } & (
  | { type: 'open'; model: EmuModel; fileKind: string; name: string; /** base64 */ data: string; run?: string }
  | { type: 'reset' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'step' }
  | { type: 'stepOver' }
  | { type: 'stepOut' }
  | { type: 'state' }
  | { type: 'readMemory'; addr: number; length: number }
  | { type: 'writeMemory'; addr: number; /** base64 */ bytes: string }
  | { type: 'setBreakpoint'; addr: number; on: boolean }
  | { type: 'screenshot' }
);

export type RequestType = HostRequest['type'];

/** The payload of a successful answer, per request type. */
export interface ResultMap {
  open: { state: EmuState };
  reset: { state: EmuState };
  pause: { state: EmuState };
  resume: { state: EmuState };
  step: { state: EmuState };
  stepOver: { state: EmuState };
  stepOut: { state: EmuState };
  state: { state: EmuState };
  readMemory: { /** base64 */ bytes: string };
  writeMemory: Record<string, never>;
  setBreakpoint: Record<string, never>;
  screenshot: { /** base64 of packed RGBA */ rgba: string; width: number; height: number };
}

export interface ResponseMsg {
  kind: 'response';
  id: number;
  ok: boolean;
  error?: string;
  result?: unknown;
}

export type WebviewNotice =
  | { kind: 'ready' }
  /** The emulator paused or resumed (by a command, a breakpoint, a step or the toolbar). */
  | { kind: 'event'; event: 'paused' | 'resumed'; state: EmuState }
  | { kind: 'log'; text: string };

export type WebviewMessage = ResponseMsg | WebviewNotice;

/** Host -> webview, not answered. */
export type HostNotice =
  | { kind: 'visibility'; visible: boolean }
  | { kind: 'config'; runHidden: boolean }
  /** Test hook: create the audio context and report whether the worklet loaded. */
  | { kind: 'probeAudio' };

/** Where the webview finds its files (asWebviewUri strings), embedded in the page. */
export interface WebviewBoot {
  cpcecJs: string;
  cpcecWasm: string;
  worklet: string;
  roms: Record<string, string>;
  runHidden: boolean;
}
