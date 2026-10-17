import { describe, expect, it } from 'vitest';
import { launchDetached, runTool, Sink, toolEnv } from './runTool';

const collect = (): { sink: Sink; lines: string[] } => {
  const lines: string[] = [];
  return { lines, sink: { line: (t, e) => void lines.push((e ? '!' : '') + t) } };
};

describe('runTool', () => {
  it('passes args as an array, no shell', async () => {
    const { sink, lines } = collect();
    const r = await runTool([process.execPath], ['-e', 'console.log(process.argv.slice(1).join("|"))', 'a b', '$HOME', ';x'], { sink });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('a b|$HOME|;x');
    expect(lines.at(-1)).toBe('a b|$HOME|;x');
  });
  it('reports stderr lines and exit codes', async () => {
    const { sink, lines } = collect();
    const r = await runTool([process.execPath], ['-e', 'console.error("bad"); process.exit(3)'], { sink, quiet: true });
    expect(r.code).toBe(3);
    expect(lines).toEqual(['!bad']);
  });
  it('says when the program is missing', async () => {
    const r = await runTool(['definitely-not-a-program-xyz'], []);
    expect(r.code).toBeNull();
    expect(r.error).toMatch(/was not found/);
  });
  it('cancels', async () => {
    let cb = (): void => {};
    const token = { isCancellationRequested: false, onCancellationRequested: (l: () => void) => { cb = l; return { dispose() {} }; } };
    const p = runTool([process.execPath], ['-e', 'setTimeout(()=>{}, 30000)'], { token, quiet: true });
    setTimeout(() => cb(), 100);
    const r = await p;
    expect(r.cancelled).toBe(true);
  });
  it.skipIf(process.platform === 'win32')('escalates to SIGKILL when the tool ignores SIGTERM', async () => {
    let cb = (): void => {};
    const token = { isCancellationRequested: false, onCancellationRequested: (l: () => void) => { cb = l; return { dispose() {} }; } };
    const p = runTool([process.execPath], ['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setTimeout(()=>{}, 30000)'], { token, quiet: true, killAfterMs: 300 });
    await new Promise((r) => setTimeout(r, 500)); // let node install its handler
    const t0 = Date.now();
    cb();
    const r = await p;
    expect(r.cancelled).toBe(true);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
  it('puts ~/.local/bin on PATH', () => {
    expect(toolEnv({ PATH: '/usr/bin' }).PATH).toContain('.local');
  });
  it('launchDetached reports whether the process we started is still alive (a bare pid can be reused)', async () => {
    const r = await launchDetached([process.execPath], ['-e', 'setTimeout(()=>{}, 400)'], {});
    expect(r.ok).toBe(true);
    expect(r.alive?.()).toBe(true);
    const t0 = Date.now();
    while (r.alive?.() && Date.now() - t0 < 5000) await new Promise((res) => setTimeout(res, 50));
    expect(r.alive?.()).toBe(false);
  });
});
