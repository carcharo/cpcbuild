/** Cartridge packaging: both engines write the bytes tools/mkcpr.py wrote for the fixtures, and report problems. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO, scratchDir } from '../core/testutil';
import { makeCpr, type MkcprSettings } from './mkcprGen';

const FX = path.join(__dirname, '..', 'core', 'fixtures', 'mkcpr');
const dir = scratchDir('mkcprgen-');
const S = (engine: 'builtin' | 'python', over: Partial<MkcprSettings> = {}): MkcprSettings => ({ engine, pythonPath: 'python3', library: REPO, ...over });

for (const engine of ['builtin', 'python'] as const) {
  describe(`engine ${engine}`, () => {
    for (const name of ['tiny', 'pageplus1', 'max']) {
      it(`${name}: the fixture's bytes`, async () => {
        // the load address is the one the fixture was made with (entry = load for these)
        const meta = JSON.parse(fs.readFileSync(path.join(FX, 'cases.json'), 'utf8'))[name] as { load: number };
        const out = path.join(dir, `${engine}-${name}.cpr`);
        const r = await makeCpr(path.join(FX, `${name}.bin`), meta.load, out, S(engine), { cwd: dir });
        expect(r.ok, r.error).toBe(true);
        const want = fs.readFileSync(path.join(FX, `${name}.cpr`));
        expect(fs.readFileSync(out).equals(want)).toBe(true);
      });
    }
    it('a program that does not fit below &C000 fails', async () => {
      const bin = path.join(dir, 'big.bin');
      fs.writeFileSync(bin, Buffer.alloc(0xc000));
      const r = await makeCpr(bin, 0x40, path.join(dir, `${engine}-big.cpr`), S(engine), { cwd: dir });
      expect(r.ok).toBe(false);
      expect(fs.existsSync(path.join(dir, `${engine}-big.cpr`))).toBe(false);
      expect(r.error).toBeTruthy();
    });
  });
}

describe('the builtin engine needs neither Python nor the checkout', () => {
  it('builds with both missing', async () => {
    const out = path.join(dir, 'nopy.cpr');
    const r = await makeCpr(path.join(FX, 'tiny.bin'), 0x40, out, S('builtin', { pythonPath: path.join(dir, 'no-python'), library: undefined }));
    expect(r.ok, r.error).toBe(true);
    expect(fs.readFileSync(out).equals(fs.readFileSync(path.join(FX, 'tiny.cpr')))).toBe(true);
  });
  it('says the tool\'s text for a too-big program', async () => {
    const bin = path.join(dir, 'big2.bin');
    fs.writeFileSync(bin, Buffer.alloc(0xc000));
    const r = await makeCpr(bin, 0x40, path.join(dir, 'big2.cpr'), S('builtin'));
    expect(r.error).toBe('mkcpr: program &0040-&C03F does not fit below &C000');
  });
  it('the python engine without the tool says how to fix it', async () => {
    const r = await makeCpr(path.join(FX, 'tiny.bin'), 0x40, path.join(dir, 'x.cpr'), S('python', { library: path.join(dir, 'nowhere') }));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/tools\/mkcpr\.py was not found/);
  });
});
