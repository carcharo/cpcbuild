// SPDX-License-Identifier: MIT OR GPL-3.0-or-later -- interface contract shared by cpcbuild-studio and cpcbuild-emu
/**
 * emuApi.ts -- the cpcbuild.emu.* command contract, API version 1
 * (docs/phase8-design.md section 2). Types only.
 *
 * This file is COPIED, not shared: cpcbuild-studio and cpcbuild-emu each
 * hold the same text (src/emuApi.ts in each) and a test in each checks the
 * two are identical. The extensions talk only through VS Code commands:
 *
 *   vscode.commands.executeCommand<Result>('cpcbuild.emu.<name>', args)
 *
 * Every command resolves; a failure is `{ error: string }`, never a throw.
 */

export const EMU_API_VERSION = 1;

export type EmuModel = '464' | '664' | '6128' | 'plus';
export type EmuFileKind = 'dsk' | 'cpr' | 'sna';

export interface EmuError {
  error: string;
}

/** `cpcbuild.emu.version`: Studio checks `api` before any other call. */
export interface EmuVersion {
  api: number;
  cpcec: string;
  models: EmuModel[];
}

/** `cpcbuild.emu.open`. `.bin` is not a kind: Studio always packages first. */
export interface EmuOpenArgs {
  file: string;
  kind: EmuFileKind;
  model: EmuModel;
  /** The AMSDOS name typed after boot (`run"NAME`); a `.cpr` boots by itself. */
  run?: string;
  /** Load into the open session (default true). */
  reuse?: boolean;
  focus?: boolean;
}

export interface EmuOpenResult {
  session: string;
}

export type EmuPauseReason = 'breakpoint' | 'step' | 'user' | 'halted';

export interface EmuState {
  running: boolean;
  paused: boolean;
  reason?: EmuPauseReason;
  pc: number;
  sp: number;
  af: number;
  bc: number;
  de: number;
  hl: number;
  ix: number;
  iy: number;
  af2: number;
  bc2: number;
  de2: number;
  hl2: number;
  i: number;
  r: number;
  im: number;
  iff1: number;
  frame: number;
  model: EmuModel;
}

/** `cpcbuild.emu.readMemory`: what the Z80 sees at that address; `bank` is reserved (v1 rejects it). */
export interface EmuReadMemoryArgs {
  session: string;
  addr: number;
  length: number;
  bank?: number;
}

export interface EmuReadMemoryResult {
  /** base64 */
  bytes: string;
}

/** `exec` only in v1; `read`/`write` return `{ error }`. */
export interface EmuBreakpointArgs {
  session: string;
  addr: number;
  kind: 'exec' | 'read' | 'write';
}

export interface EmuScreenshotResult {
  /** base64 PNG of the emulated screen, without host scaling. */
  png: string;
  width: number;
  height: number;
}

/** `cpcbuild.emuEvent`, run by cpcbuild-emu on Studio's side when a session pauses, resumes or closes. */
export interface EmuEvent {
  session: string;
  /** The emulator paused, resumed or closed (the design fixes the three occasions, not the spelling). */
  event: string;
  state?: EmuState;
}

export type EmuCommand =
  | 'cpcbuild.emu.version'
  | 'cpcbuild.emu.open'
  | 'cpcbuild.emu.reset'
  | 'cpcbuild.emu.pause'
  | 'cpcbuild.emu.resume'
  | 'cpcbuild.emu.step'
  | 'cpcbuild.emu.stepOver'
  | 'cpcbuild.emu.stepOut'
  | 'cpcbuild.emu.state'
  | 'cpcbuild.emu.readMemory'
  | 'cpcbuild.emu.writeMemory'
  | 'cpcbuild.emu.setBreakpoint'
  | 'cpcbuild.emu.clearBreakpoint'
  | 'cpcbuild.emu.screenshot'
  | 'cpcbuild.emu.close';
