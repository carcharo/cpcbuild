import { describe, expect, it } from 'vitest';
import { runInZxEmulator, zxArgs, ZX_NOT_SET } from './zxRun';

const lines: string[] = [];
const sink = { line: (t: string) => void lines.push(t) };

describe('Spectrum run', () => {
  it('puts the .tap into ${file}', () => {
    expect(zxArgs({ zxEmulator: 'fuse', zxEmulatorArgs: ['--tape', '${file}'] }, '/p/build/x.tap')).toEqual(['--tape', '/p/build/x.tap']);
  });
  it('inserts a path with $-patterns literally', () => {
    expect(zxArgs({ zxEmulator: 'fuse', zxEmulatorArgs: ['--tape=${file}', '${file}'] }, "/p/a$&b$'c$$d.tap")).toEqual(["--tape=/p/a$&b$'c$$d.tap", "/p/a$&b$'c$$d.tap"]);
  });
  it('says what to set when no emulator is configured', async () => {
    const r = await runInZxEmulator({ zxEmulator: '', zxEmulatorArgs: ['${file}'] }, '/p/x.tap', sink);
    expect(r).toEqual({ ok: false, message: ZX_NOT_SET });
    expect(ZX_NOT_SET).toMatch(/Fuse/);
    expect(ZX_NOT_SET).toMatch(/ZEsarUX/);
  });
  it('reports an emulator that cannot start', async () => {
    const r = await runInZxEmulator({ zxEmulator: '/no/such/emulator', zxEmulatorArgs: ['${file}'] }, '/p/x.tap', sink);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('/no/such/emulator');
  });
});
