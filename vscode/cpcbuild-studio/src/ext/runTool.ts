/**
 * runTool.ts -- the one way Studio starts external programs (zxbc, mkdsk.py,
 * mkcpr.py, emulators): spawn with an argument array and no shell, cancel
 * through a token, and report every line to a sink (the "CPC Game Studio" output
 * channel and/or a task terminal). No vscode import: unit-testable in node.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface Sink {
  /** One line of output. `err` = it came from the program's stderr. */
  line(text: string, err?: boolean): void;
}

export interface CancelToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

export interface ToolOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  token?: CancelToken;
  sink?: Sink;
  /** Do not echo the command line to the sink. */
  quiet?: boolean;
  /** After a cancel's polite SIGTERM, how long before SIGKILL (default 3000 ms). */
  killAfterMs?: number;
}

export interface ToolResult {
  /** Exit code; null when the program did not start or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
  /** The signal that ended the program (macOS Gatekeeper's SIGKILL, a crash), when it did not exit by itself. */
  signal?: NodeJS.Signals;
  /** True when `error` is "program not found" (ENOENT); the zxbc fallback keys on this, not on the text. */
  notFound?: boolean;
  /** Set when the program could not be started (not found, bad cwd, ...). */
  error?: string;
}

/** A tool the system stopped (a signal, no exit code): on macOS that is almost always Gatekeeper refusing an unnotarised download. */
export function stoppedText(tool: string, signal: string, platform: NodeJS.Platform = process.platform): string {
  return `${tool} was stopped by the system (${signal}) before it finished.` + (platform === 'darwin'
    ? ' If macOS showed "Not Opened" ("Apple could not verify ..."), choose Done (not Move to Bin), run `xattr -dr com.apple.quarantine <the SDK folder>` in Terminal (README-FIRST.txt in the SDK says more), and build again.'
    : ' Build again; if it keeps happening, run "CPC Game Studio: Check Environment".');
}

/** Environment for child processes: poetry lives in ~/.local/bin, which a GUI-launched VS Code may lack (as cpcrun.py does). */
export function toolEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const local = path.join(os.homedir(), '.local', 'bin');
  const parts = (env[key] ?? '').split(path.delimiter);
  if (!parts.includes(local)) env[key] = [local, ...parts].filter(Boolean).join(path.delimiter);
  return env;
}

/** Quotes an argument for display only (the command never goes through a shell). */
export function displayArg(a: string): string {
  return /^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`;
}

/** Kills a process tree: the process group on POSIX, `taskkill /T /F` on Windows. */
export function killTree(pid: number | undefined, child: { kill(signal?: NodeJS.Signals): boolean }, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32') {
      if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    } else if (pid) {
      try {
        process.kill(-pid, signal);
      } catch {
        child.kill(signal); // not a group leader
      }
    } else child.kill(signal);
  } catch {
    /* already gone */
  }
}

/** What "cpcbuild.python.path" holds when unset on Windows: the py launcher, asking for Python 3. */
export const PY_LAUNCHER = 'py -3';

/** The command for a Python setting: `py -3` is two words, anything else (a path may hold spaces) is one program. */
export const pythonCmd = (p: string): string[] => (p === PY_LAUNCHER ? ['py', '-3'] : [p]);

/**
 * True when `python` would run macOS's placeholder /usr/bin/python3, which only works once the Command Line Tools
 * (or Xcode) are installed and otherwise opens Apple's "install the developer tools" dialog. `xcode-select -p`
 * answers without prompting.
 */
export function isMacPythonStub(
  python: string,
  o: { platform?: NodeJS.Platform; pathDirs?: string[]; exists?: (p: string) => boolean; devDir?: () => string | undefined } = {},
): boolean {
  if ((o.platform ?? process.platform) !== 'darwin') return false;
  const exists = o.exists ?? ((p: string) => fs.existsSync(p));
  const dirs = o.pathDirs ?? (toolEnv().PATH ?? '').split(path.delimiter).filter(Boolean);
  const resolved = python.includes('/') ? python : dirs.map((d) => path.join(d, python)).find(exists);
  if (resolved !== '/usr/bin/python3' && resolved !== '/usr/bin/python') return false;
  const devDir = o.devDir ?? (() => {
    const r = spawnSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : undefined;
  });
  const d = devDir();
  return !d || !exists(d);
}

export function runTool(command: readonly string[], args: readonly string[], opts: ToolOptions = {}): Promise<ToolResult> {
  const [exe, ...pre] = command;
  const all = [...pre, ...args];
  const sink = opts.sink;
  if (!exe) return Promise.resolve({ code: null, stdout: '', stderr: '', cancelled: false, error: 'empty command' });
  if (!opts.quiet) sink?.line(`$ ${[exe, ...all].map(displayArg).join(' ')}${opts.cwd ? `   (in ${opts.cwd})` : ''}`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let cancelled = false;
    let settled = false;
    let spawnError: string | undefined;
    let notFound = false;
    const posix = process.platform !== 'win32';
    let child: ChildProcess;
    try {
      child = spawn(exe, all, { cwd: opts.cwd, env: opts.env ?? toolEnv(), shell: false, detached: posix, windowsHide: true });
    } catch (e) {
      // spawn throws (rather than emitting 'error') for some failures, e.g. UNKNOWN for a file Windows cannot run
      resolve({ code: null, stdout, stderr, cancelled, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let killTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null, signal?: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      sub?.dispose();
      if (killTimer) clearTimeout(killTimer);
      for (const [buf, err] of [[outBuf, false], [errBuf, true]] as const) if (buf.s) sink?.line(buf.s, err);
      resolve({ code, stdout, stderr, cancelled, error: spawnError, notFound: notFound || undefined, signal: signal ?? undefined });
    };
    const kill = (): void => {
      if (cancelled) return;
      cancelled = true;
      // polite first (POSIX), then SIGKILL for a tool that ignores it; Windows has no polite signal
      killTree(child.pid, child, 'SIGTERM');
      if (posix && !settled) {
        killTimer = setTimeout(() => {
          if (!settled) killTree(child.pid, child, 'SIGKILL');
        }, opts.killAfterMs ?? 3000);
        killTimer.unref();
      }
    };
    const sub = opts.token?.onCancellationRequested(kill);
    if (opts.token?.isCancellationRequested) kill();

    const outBuf = { s: '' };
    const errBuf = { s: '' };
    const feed = (buf: { s: string }, chunk: string, err: boolean): void => {
      buf.s += chunk;
      let i: number;
      while ((i = buf.s.indexOf('\n')) >= 0) {
        sink?.line(buf.s.slice(0, i).replace(/\r$/, ''), err);
        buf.s = buf.s.slice(i + 1);
      }
    };
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
      feed(outBuf, c, false);
    });
    child.stderr?.on('data', (c: string) => {
      stderr += c;
      feed(errBuf, c, true);
    });
    child.on('error', (e: NodeJS.ErrnoException) => {
      notFound = e.code === 'ENOENT';
      spawnError = e.code === 'ENOENT' ? `"${exe}" was not found${opts.cwd ? ` (working directory ${opts.cwd})` : ''}` : e.message;
      finish(null);
    });
    child.on('close', (code, signal) => finish(code, signal));
  });
}

/** Starts a GUI program that outlives the call (an emulator). Resolves once it has started or failed to. */
export interface Launched {
  ok: boolean;
  error?: string;
  pid?: number;
  /** True while the process we started has not exited (a pid alone can be reused by something else). */
  alive?: () => boolean;
}
export function launchDetached(command: readonly string[], args: readonly string[], opts: { cwd?: string; sink?: Sink; env?: NodeJS.ProcessEnv } = {}): Promise<Launched> {
  const [exe, ...pre] = command;
  const all = [...pre, ...args];
  opts.sink?.line(`$ ${[exe, ...all].map(displayArg).join(' ')}`);
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(exe, all, { cwd: opts.cwd, env: opts.env ?? toolEnv(), shell: false, detached: true, stdio: 'ignore' });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    child.once('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, error: e.code === 'ENOENT' ? `"${exe}" was not found` : e.message }));
    let exited = false;
    child.once('exit', () => (exited = true));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, pid: child.pid, alive: () => !exited && child.exitCode === null && child.signalCode === null });
    });
  });
}
