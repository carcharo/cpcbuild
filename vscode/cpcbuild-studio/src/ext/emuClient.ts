/**
 * emuClient.ts -- Studio's side of the cpcbuild.emu.* contract.
 * Only vscode.commands.executeCommand; nothing of cpcbuild-emu is imported. Every method resolves:
 * a failure is `{ error }`, as in the contract.
 */
import * as vscode from 'vscode';
import type { EmuBreakpointArgs, EmuError, EmuReadMemoryResult, EmuState } from '../emuApi';
import { EMU_API_VERSION } from '../emuApi';

export const isError = (r: unknown): r is EmuError => !!r && typeof r === 'object' && typeof (r as EmuError).error === 'string';

export type StepCommand = 'pause' | 'resume' | 'step' | 'stepOver' | 'stepOut';

export class EmuClient {
  /** The session Studio knows (from `open` or an event); undefined = the emulator's latest session. */
  session?: string;
  private apiOk?: { at: number; ok: boolean; why?: string };

  /** True when cpcbuild-emu is installed and speaks API 1 (cached for a few seconds). */
  async available(): Promise<{ ok: boolean; why?: string }> {
    const now = Date.now();
    if (this.apiOk && now - this.apiOk.at < 3000) return this.apiOk;
    let r: { ok: boolean; why?: string };
    // cpcbuild-emu loads on its commands, so call one: "command not found" means it is not installed
    const v = await this.raw<{ api: number }>('cpcbuild.emu.version');
    if (isError(v)) r = { ok: false, why: /command '.*' not found/i.test(v.error) ? 'the CPCBuild Emulator extension (cpcbuild-emu) is not installed' : v.error };
    else if (v.api !== EMU_API_VERSION) r = { ok: false, why: `cpcbuild-emu speaks API ${v.api}, Studio needs API ${EMU_API_VERSION}` };
    else r = { ok: true };
    this.apiOk = { at: now, ...r };
    return r;
  }

  private async raw<T>(command: string, args?: object): Promise<T | EmuError> {
    try {
      const r = await vscode.commands.executeCommand<T | EmuError | undefined>(command, args);
      return r ?? ({ error: `${command} returned nothing` } as EmuError);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private async call<T>(name: string, args: object = {}): Promise<T | EmuError> {
    const r = await this.raw<T>(`cpcbuild.emu.${name}`, this.session ? { session: this.session, ...args } : args);
    if (isError(r) && /no such session/.test(r.error)) this.session = undefined;
    return r;
  }

  /** The state of the session; `{ error }` when there is none (the emulator was not started, or was closed). */
  state(): Promise<EmuState | EmuError> {
    return this.call<EmuState>('state');
  }

  async readMemory(addr: number, length: number): Promise<Uint8Array | EmuError> {
    const r = await this.call<EmuReadMemoryResult>('readMemory', { addr, length });
    if (isError(r)) return r;
    return Uint8Array.from(Buffer.from(r.bytes, 'base64'));
  }

  async setBreakpoint(addr: number, on: boolean): Promise<{ ok: true } | EmuError> {
    const args: Omit<EmuBreakpointArgs, 'session'> = { addr, kind: 'exec' };
    const r = await this.call<object>(on ? 'setBreakpoint' : 'clearBreakpoint', args);
    return isError(r) ? r : { ok: true };
  }

  async control(cmd: StepCommand): Promise<{ state: EmuState } | EmuError> {
    return this.call<{ state: EmuState }>(cmd);
  }
}
