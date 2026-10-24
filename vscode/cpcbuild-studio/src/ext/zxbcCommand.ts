/**
 * zxbcCommand.ts -- starting the compiler. The default command ["zxbc"] is replaced by `poetry run zxbc` when
 * it cannot be found and zxbc.cwd is a Poetry project (the zxbasic fork). Where zxbc comes from in the first
 * place (SDK, managed tools, PATH) is toolpaths.ts's resolveCompiler. No vscode import (unit-testable).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTool, ToolOptions, ToolResult } from './runTool';

export const DEFAULT_ZXBC = ['zxbc'];

export const isDefaultZxbc = (cmd: readonly string[]): boolean => cmd.length === 1 && cmd[0] === 'zxbc';

export interface PoetryEnv {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
  exists?: (p: string) => boolean;
}

const isFile = (p: string): boolean => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** poetry on PATH, else where its installer puts it (a Dock-launched VS Code often lacks ~/.local/bin). */
export function findPoetry(o: PoetryEnv = {}): string | undefined {
  const env = o.env ?? process.env;
  const home = o.home ?? os.homedir();
  const win = (o.platform ?? process.platform) === 'win32';
  const exists = o.exists ?? isFile;
  const names = win ? ['poetry.exe'] : ['poetry'];
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH');
  const dirs = (pathKey ? env[pathKey] ?? '' : '').split(win ? ';' : ':').filter(Boolean);
  const cands: string[] = [];
  for (const d of dirs) for (const n of names) cands.push(path.join(d, n));
  if (win) {
    const appData = env.APPDATA;
    if (appData) {
      cands.push(path.join(appData, 'Python', 'Scripts', 'poetry.exe'), path.join(appData, 'pypoetry', 'venv', 'Scripts', 'poetry.exe'));
    }
  } else {
    cands.push(path.join(home, '.local', 'bin', 'poetry'));
  }
  return cands.find(exists);
}

/** `poetry run zxbc`, when `cmd` is the default and `cwd` holds a pyproject.toml and poetry is found. */
export function poetryFallback(cmd: readonly string[], cwd: string, o: PoetryEnv = {}): string[] | undefined {
  if (!isDefaultZxbc(cmd)) return undefined;
  if (!(o.exists ?? isFile)(path.join(cwd, 'pyproject.toml'))) return undefined;
  const poetry = findPoetry(o);
  return poetry ? [poetry, 'run', 'zxbc'] : undefined;
}

/** The setting value to suggest, as JSON. */
export const settingText = (cmd: readonly string[]): string => JSON.stringify(cmd);

export interface ZxbcRun extends ToolResult {
  /** The command that was actually started. */
  used: string[];
  /** Set when the poetry fallback replaced the default command. */
  fellBack: boolean;
}

/** Runs the compiler (or `--version`): the configured command, then `poetry run zxbc` if the default was not found. */
export async function runZxbc(command: readonly string[], args: readonly string[], opts: ToolOptions & { cwd: string }, poetry: PoetryEnv = {}): Promise<ZxbcRun> {
  const first = await runTool(command, args, opts);
  if (!first.error || !first.notFound) return { ...first, used: [...command], fellBack: false };
  const fb = poetryFallback(command, opts.cwd, poetry);
  if (!fb) return { ...first, used: [...command], fellBack: false };
  opts.sink?.line(`zxbc was not found; using ${fb.join(' ')} (zxbc.cwd holds a pyproject.toml).`);
  const second = await runTool(fb, args, opts);
  return { ...second, used: fb, fellBack: true };
}

export const DOWNLOAD_HINT = 'Run "CPC Game Studio: Download Tools".';

/** The developer's way: `poetry run zxbc` from the zxbasic checkout, with the exact setting when poetry is known. */
export function poetryAdvice(cmd: readonly string[], cwd: string, o: PoetryEnv = {}): string {
  const poetry = isDefaultZxbc(cmd) ? findPoetry(o) : undefined;
  const value = poetry ? [poetry, 'run', 'zxbc'] : ['poetry', 'run', 'zxbc'];
  const needCwd = !(o.exists ?? isFile)(path.join(cwd, 'pyproject.toml'));
  return `Set "cpcbuild.zxbc.command" to ${settingText(value)} (for the fork${poetry ? '' : `; poetry was not found on PATH or in ${(o.platform ?? process.platform) === 'win32' ? '%APPDATA%\\Python\\Scripts' : '~/.local/bin'}`}) and ${needCwd ? '"cpcbuild.zxbc.cwd" to your zxbasic checkout' : 'keep "cpcbuild.zxbc.cwd" on your zxbasic checkout'}, then run "CPC Game Studio: Check Environment".`;
}

/**
 * The error text for a compiler that could not be started: it ends with the Download Tools hint. The Poetry advice
 * is for developers, so it appears only when `cwd` (zxbc.cwd) is set.
 */
export function compilerHint(spawnError: string, cmd: readonly string[] = DEFAULT_ZXBC, cwd?: string, o: PoetryEnv = {}): string {
  if (cwd) return `${spawnError}. ${poetryAdvice(cmd, cwd, o)} ${DOWNLOAD_HINT}`;
  return `${spawnError}.${isDefaultZxbc(cmd) ? '' : ' Check "cpcbuild.zxbc.command", or clear it to use the downloaded tools.'} ${DOWNLOAD_HINT}`;
}
