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
