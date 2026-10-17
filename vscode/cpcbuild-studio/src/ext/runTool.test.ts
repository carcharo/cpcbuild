import { describe, expect, it } from 'vitest';
import { runTool, Sink, toolEnv } from './runTool';

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
  it('puts ~/.local/bin on PATH', () => {
    expect(toolEnv({ PATH: '/usr/bin' }).PATH).toContain('.local');
  });
});
