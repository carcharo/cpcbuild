/**
 * mkcprGen.ts -- packaging a bare-metal binary as a Plus cartridge (.cpr), with the engine the settings choose.
 *
 *   builtin  the TypeScript port (src/core/mkcpr.ts), no Python needed;
 *   python   tools/mkcpr.py of the cpcbuild checkout.
 *
 * Both take the same inputs (the binary, load address, output) and give the same bytes. No vscode import.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildCpr, MkcprError } from '../core/mkcpr';
import { pythonCmd, runTool, type CancelToken, type Sink } from './runTool';
import { resolveMkcpr } from './toolpaths';

export interface MkcprSettings {
  engine: 'builtin' | 'python';
  pythonPath: string;
  /** The cpcbuild checkout (holds tools/mkcpr.py); needed for the python engine. */
  library?: string;
}

export interface MkcprResult {
  ok: boolean;
  /** The failure, with the fix (the tool's own text for converter errors). */
  error?: string;
}

/** Writes `cpr` from `bin` loaded at `load`; never throws. */
export async function makeCpr(
  bin: string,
  load: number,
  cpr: string,
  s: MkcprSettings,
  extra: { cwd?: string; sink?: Sink; token?: CancelToken } = {},
): Promise<MkcprResult> {
  if (s.engine === 'python') {
    const script = resolveMkcpr(s.library);
    if (!script) return { ok: false, error: `tools/mkcpr.py was not found under ${s.library}. Point "cpcbuild.library.path" at a full cpcbuild checkout, or set "cpcbuild.assets.engine" to "builtin".` };
    const loadHex = '0x' + load.toString(16).toUpperCase();
    const r = await runTool(pythonCmd(s.pythonPath), [script, bin, '--load', loadHex, '-o', cpr], { cwd: extra.cwd, token: extra.token, sink: extra.sink });
    if (r.cancelled) return { ok: false, error: 'cancelled.' };
    if (r.error || r.code !== 0 || !fs.existsSync(cpr)) {
      return { ok: false, error: r.error ? `${r.error}. Set "cpcbuild.python.path" to a Python 3, or set "cpcbuild.assets.engine" to "builtin".` : `mkcpr.py exited with ${r.code} (is the program below &C000?).` };
    }
    return { ok: true };
  }
  try {
    const data = buildCpr(fs.readFileSync(bin), load);
    fs.mkdirSync(path.dirname(cpr), { recursive: true });
    fs.writeFileSync(cpr, data);
    extra.sink?.line(`mkcpr: ${cpr}: ${data.length} bytes (built in), load &${load.toString(16).toUpperCase().padStart(4, '0')}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof MkcprError ? `mkcpr: ${e.message}` : `mkcpr: ${e instanceof Error ? e.message : String(e)}` };
  }
}
