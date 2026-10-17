/**
 * runTool.ts -- the one way Studio starts external programs (zxbc, mkdsk.py,
 * mkcpr.py, emulators): spawn with an argument array and no shell, cancel
 * through a token, and report every line to a sink (the "CPCBuild" output
 * channel and/or a task terminal). No vscode import: unit-testable in node.
 */
import { spawn, spawnSync } from 'node:child_process';
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
  /** Set when the program could not be started (not found, bad cwd, ...). */
  error?: string;
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
    const posix = process.platform !== 'win32';
    const child = spawn(exe, all, { cwd: opts.cwd, env: opts.env ?? toolEnv(), shell: false, detached: posix, windowsHide: true });

    let killTimer: NodeJS.Timeout | undefined;
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      sub?.dispose();
      if (killTimer) clearTimeout(killTimer);
      for (const [buf, err] of [[outBuf, false], [errBuf, true]] as const) if (buf.s) sink?.line(buf.s, err);
      resolve({ code, stdout, stderr, cancelled, error: spawnError });
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
      spawnError = e.code === 'ENOENT' ? `"${exe}" was not found${opts.cwd ? ` (working directory ${opts.cwd})` : ''}` : e.message;
      finish(null);
    });
    child.on('close', (code) => finish(code));
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
    const child = spawn(exe, all, { cwd: opts.cwd, env: opts.env ?? toolEnv(), shell: false, detached: true, stdio: 'ignore' });
    child.once('error', (e: NodeJS.ErrnoException) => resolve({ ok: false, error: e.code === 'ENOENT' ? `"${exe}" was not found` : e.message }));
    let exited = false;
    child.once('exit', () => (exited = true));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true, pid: child.pid, alive: () => !exited && child.exitCode === null && child.signalCode === null });
    });
  });
}
