/** zxRun.ts -- Build and Run for Spectrum (.tap) targets through an external emulator named by a setting. No vscode import. */
import { launchDetached, Sink } from './runTool';

export interface ZxSettings {
  zxEmulator: string;
  zxEmulatorArgs: string[];
}

export const ZX_NOT_SET =
  'no Spectrum emulator is set, so the .tap is not run. Set "cpcbuild.run.zxEmulator" to an emulator such as Fuse or ZEsarUX (and "cpcbuild.run.zxEmulatorArgs" if it needs more than the file name).';

/** The emulator's arguments with ${file} replaced by the .tap path. */
export function zxArgs(s: ZxSettings, file: string): string[] {
  return s.zxEmulatorArgs.map((a) => a.replace(/\$\{file\}/g, file));
}

export interface ZxOutcome {
  ok: boolean;
  message?: string;
  pid?: number;
}

export async function runInZxEmulator(s: ZxSettings, tap: string, sink: Sink): Promise<ZxOutcome> {
  const exe = s.zxEmulator.trim();
  if (!exe) return { ok: false, message: ZX_NOT_SET };
  const r = await launchDetached([exe], zxArgs(s, tap), { sink });
  return r.ok ? { ok: true, pid: r.pid } : { ok: false, message: `could not start "${exe}": ${r.error}` };
}
