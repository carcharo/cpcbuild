/**
 * tmxGen.ts -- converting a Tiled .tmx to a .bas include, with the same options as tools/tmx2bas.py.
 *
 *   builtin  the TypeScript port (src/core/tmx.ts), no Python needed;
 *   python   tools/tmx2bas.py of the cpcbuild checkout, run from the project root.
 *
 * Both are given the same command line (project-relative paths, the project root as working
 * directory), so the header they write is identical and so is the rest. No vscode import.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { insideRoot, PathEscapeError } from '../core/paths';
import { defaultMapName, parseTmx, TmxError, tmxToBas } from '../core/tmx';
import { pythonCmd, runTool, type CancelToken, type Sink } from './runTool';

export interface TmxGenSettings {
  engine: 'builtin' | 'python';
  pythonPath: string;
  /** The cpcbuild checkout (holds tools/tmx2bas.py); needed for the python engine. */
  library?: string;
}

export interface TmxGenOptions {
  layer?: string;
  name?: string;
  firstgid?: number;
  empty?: number;
  /** Project-relative output; default: beside the map, same stem, .bas. */
  output?: string;
}

export interface TmxGenResult {
  ok: boolean;
  /** Project-relative output path. */
  output: string;
  error?: string;
  text?: string;
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

export function defaultOutput(tmxRel: string): string {
  return tmxRel.replace(/\.tmx$/i, '') + '.bas';
}

/** tmx2bas.py's command line (without the script) for these options. */
export function tmxArgv(tmxRel: string, o: TmxGenOptions, outRel: string): string[] {
  const a = [tmxRel];
  if (o.layer !== undefined) a.push('--layer', o.layer);
  if (o.name) a.push('--name', o.name);
  if (o.empty !== undefined) a.push('--empty', String(o.empty));
  if (o.firstgid !== undefined) a.push('--firstgid', String(o.firstgid));
  a.push('-o', outRel);
  return a;
}

/** The text the tool prints for a failure. */
const toolError = (tmxRel: string, e: unknown): string => `tmx2bas: ${tmxRel}: ${e instanceof Error ? e.message : String(e)}`;

export async function generateTmx(
  root: string,
  tmxRel: string,
  o: TmxGenOptions,
  s: TmxGenSettings,
  extra: { sink?: Sink; token?: CancelToken } = {},
): Promise<TmxGenResult> {
  const outRel = toPosix(o.output ?? defaultOutput(tmxRel));
  const res: TmxGenResult = { ok: false, output: outRel };
  let abs: string;
  try {
    abs = insideRoot(root, tmxRel);
    insideRoot(root, outRel);
  } catch (e) {
    if (e instanceof PathEscapeError) {
      res.error = `tmx2bas.py: error: ${e.message}`;
      return res;
    }
    throw e;
  }
  if (!fs.existsSync(abs)) {
    res.error = `tmx2bas.py: error: ${tmxRel}: not found`;
    return res;
  }
  if (o.empty !== undefined && !(Number.isInteger(o.empty) && o.empty >= 0 && o.empty <= 255)) {
    res.error = 'tmx2bas.py: error: --empty must be 0-255';
    return res;
  }
  const argv = tmxArgv(tmxRel, o, outRel);
  if (s.engine === 'python') {
    const script = s.library ? path.join(s.library, 'tools', 'tmx2bas.py') : '';
    if (!script || !fs.existsSync(script)) {
      res.error = 'tools/tmx2bas.py was not found. Set "cpcbuild.library.path" to your cpcbuild checkout (the folder holding lib/ and tools/), or set "cpcbuild.assets.engine" to "builtin".';
      return res;
    }
    const t = await runTool(pythonCmd(s.pythonPath), [script, ...argv], { cwd: root, token: extra.token, sink: extra.sink, quiet: true });
    if (t.cancelled) res.error = 'cancelled';
    else if (t.error) res.error = `${t.error}. Set "cpcbuild.python.path" to a Python 3, or set "cpcbuild.assets.engine" to "builtin".`;
    else if (t.code !== 0) res.error = (t.stderr.trim() || `tmx2bas.py exited with ${t.code}`).split('\n').pop() as string;
    else {
      res.ok = true;
      res.text = fs.readFileSync(path.resolve(root, outRel), 'utf8');
    }
    return res;
  }
  try {
    const map = parseTmx(fs.readFileSync(abs, 'utf8'));
    const text = tmxToBas(map, o.name || defaultMapName(tmxRel), { layer: o.layer, firstgid: o.firstgid, empty: o.empty }, argv, tmxRel);
    const out = path.resolve(root, outRel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    res.ok = true;
    res.text = text;
  } catch (e) {
    res.error = toolError(tmxRel, e instanceof TmxError ? e : e);
  }
  return res;
}
