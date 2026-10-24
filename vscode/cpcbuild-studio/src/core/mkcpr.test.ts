/** The mkcpr port against tools/mkcpr.py: fixtures made by mkcpr.gen.py, plus the Python tool run live as a second oracle. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCpr, buildStub, MkcprError, readOrigin, summaryLine } from './mkcpr';
import { py, scratchDir } from './testutil';

const FX = path.join(__dirname, 'fixtures', 'mkcpr');
const cases = JSON.parse(fs.readFileSync(path.join(FX, 'cases.json'), 'utf8')) as Record<string, { load: number; entry: number; summary: string }>;
const read = (n: string): Buffer => fs.readFileSync(path.join(FX, n));

describe('mkcpr fixtures (made by tools/mkcpr.py)', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`${name}: the same .cpr bytes, listing and summary`, () => {
      const image = read(`${name}.bin`);
      const got = buildCpr(image, c.load, c.entry);
      expect(Buffer.from(got).equals(read(`${name}.cpr`))).toBe(true);
      expect(buildStub(c.load, c.entry, image.length).listing.join('\n') + '\n').toBe(read(`${name}.lst`).toString('utf8'));
      expect(summaryLine(`${name}.cpr`, got.length, c.load, c.entry)).toBe(c.summary);
    });
  }
  it('the entry defaults to the load address', () => {
    expect(Buffer.from(buildCpr(read('tiny.bin'), 0x40)).equals(read('tiny.cpr'))).toBe(true);
  });
});

describe('mkcpr errors are the tool\'s texts', () => {
  const msg = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      expect(e).toBeInstanceOf(MkcprError);
      return (e as Error).message;
    }
    return '';
  };
  it('empty, out of range, too big', () => {
    expect(msg(() => buildCpr(new Uint8Array(0), 0x40))).toBe('empty program image');
    expect(msg(() => buildCpr(new Uint8Array(1), 0x10000))).toBe('load/entry must be 16-bit addresses');
    expect(msg(() => buildCpr(new Uint8Array(1), 0x40, -1))).toBe('load/entry must be 16-bit addresses');
    expect(msg(() => buildCpr(new Uint8Array(0xc000), 0x40))).toBe('program &0040-&C03F does not fit below &C000');
  });
  it('the same messages as the Python tool', () => {
    const dir = scratchDir('mkcpr-');
    const bin = path.join(dir, 'big.bin');
    fs.writeFileSync(bin, Buffer.alloc(0xc000));
    const r = py('mkcpr.py', [bin, '--load', '0x40', '-o', path.join(dir, 'x.cpr')]);
    expect(r.ok).toBe(false);
    expect(r.stderr.trim()).toBe('mkcpr: ' + msg(() => buildCpr(new Uint8Array(0xc000), 0x40)));
    fs.writeFileSync(bin, Buffer.alloc(0));
    const e = py('mkcpr.py', [bin, '--load', '0x40', '-o', path.join(dir, 'x.cpr')]);
    expect(e.stderr.trim()).toBe('mkcpr: empty program image');
  });
});

describe('readOrigin', () => {
  it('finds .core.__START_PROGRAM in a real map', () => {
    const t = fs.readFileSync(path.join(__dirname, 'fixtures', 'plusdemo.map'), 'utf8');
    const o = readOrigin(t, 'plusdemo.map');
    expect(Number.isInteger(o)).toBe(true);
    expect(t).toMatch(new RegExp(`^${o.toString(16).toUpperCase().padStart(4, '0')}: \\.core\\.__START_PROGRAM`, 'm'));
  });
  it('says what is missing', () => {
    expect(() => readOrigin('0040: foo\n', 'x.map')).toThrow('no .core.__START_PROGRAM in x.map; give --load');
  });
});
