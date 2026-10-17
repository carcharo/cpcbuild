/** Shared by the core tests: the repo root and running the Python tools. Test-only (uses node). */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Repo root: the directory above vscode/ (this file is vscode/cpcbuild-studio/src/core/). */
export const REPO = path.resolve(__dirname, '..', '..', '..', '..');

/** Runs python3 tools/<tool> with `args` from the repo root; stdout, or the failure. */
export function py(tool: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync('python3', [path.join('tools', tool), ...args], { cwd: REPO, encoding: 'utf8' });
  if (r.error) throw r.error;
  return { ok: r.status === 0, stdout: r.stdout, stderr: r.stderr };
}

export function scratchDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The zxbasic checkout (the compiler fork): $ZXBASIC, else a `zxbasic` folder in `start` or any folder above
 * it (so REPO/../zxbasic, and a worktree under the main checkout, both resolve). undefined when absent.
 */
export function findZxbasic(start: string): string | undefined {
  const ok = (d: string): boolean => fs.existsSync(path.join(d, 'zxbc.py'));
  if (process.env.ZXBASIC) return ok(process.env.ZXBASIC) ? process.env.ZXBASIC : undefined;
  for (let d = path.resolve(start); ; d = path.dirname(d)) {
    if (ok(path.join(d, 'zxbasic'))) return path.join(d, 'zxbasic');
    if (path.dirname(d) === d) return undefined;
  }
}

/** Warns once (use with `ZXBASIC ? describe : describe.skip`) that the zxbasic-dependent suites are skipped. */
export function warnNoZxbasic(zx: string | undefined): void {
  if (!zx) console.warn('SKIPPED: the zxbasic checkout was not found. Set ZXBASIC or put it next to the cpcbuild checkout (../zxbasic).');
}
