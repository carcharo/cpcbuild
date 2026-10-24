/** A tiny runner (the extension host loads this module's run()): named async tests, a summary, a throw on any failure. */
interface Case { name: string; fn: () => Promise<void> }
const cases: Case[] = [];

export function test(name: string, fn: () => Promise<void>): void {
  cases.push({ name, fn });
}

export async function runAll(): Promise<void> {
  let pass = 0;
  const failed: string[] = [];
  for (const c of cases) {
    const t0 = Date.now();
    try {
      await c.fn();
      pass++;
      console.log(`  ok   ${c.name} (${Date.now() - t0} ms)`);
    } catch (e) {
      failed.push(c.name);
      console.log(`  FAIL ${c.name}\n       ${(e as Error).stack ?? e}`);
    }
  }
  console.log(`extension host tests: ${pass} passed, ${failed.length} failed`);
  if (failed.length) throw new Error(`${failed.length} extension host test(s) failed: ${failed.join('; ')}`);
}

export async function waitFor<T>(what: string, fn: () => T | undefined | false | Promise<T | undefined | false>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

import * as path from 'path';

/** The Python the tests call directly: the one runTest.ts chose (with Pillow); else `py -3` on Windows, python3 elsewhere. */
export const python = (): { cmd: string; pre: string[] } =>
  process.env.CPCBUILD_TEST_PYTHON ? { cmd: process.env.CPCBUILD_TEST_PYTHON, pre: [] } : process.platform === 'win32' ? { cmd: 'py', pre: ['-3'] } : { cmd: 'python3', pre: [] };

/** A program that starts, exits at once and shows nothing: stands in for an installed external emulator or Tiled. */
export const TRUE_EXE = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'hostname.exe') : '/usr/bin/true';
