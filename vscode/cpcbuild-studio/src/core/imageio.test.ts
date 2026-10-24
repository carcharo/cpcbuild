/**
 * imageio.ts against Pillow: imageio.gen.py writes GIF / BMP images (and a 16-bit PNG) plus the
 * bytes of Pillow's convert("RGBA"); the decoders must reproduce them exactly.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { encodePng } from './image';
import { decodeImage, ImageReadError, sniffFormat } from './imageio';
import { pySpawn, scratchDir } from './testutil';

let dir = '';
beforeAll(() => {
  dir = scratchDir('imageio-');
  const r = pySpawn([path.join(__dirname, 'imageio.gen.py'), dir], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
});

describe('GIF and BMP decoders vs Pillow convert("RGBA")', () => {
  const names = (): string[] => fs.readdirSync(dir).filter((f) => /\.(gif|bmp)$/.test(f)).sort();
  it('reads every generated file identically', () => {
    const bad: string[] = [];
    let n = 0;
    for (const f of names()) {
      const want = fs.readFileSync(path.join(dir, f.replace(/\.\w+$/, '.rgba')));
      let got: Uint8Array | undefined;
      try {
        got = decodeImage(new Uint8Array(fs.readFileSync(path.join(dir, f)))).data;
      } catch (e) {
        bad.push(`${f}: ${(e as Error).message}`);
        continue;
      }
      n++;
      if (Buffer.compare(Buffer.from(got), want) !== 0) bad.push(`${f}: pixels differ`);
    }
    expect(n).toBeGreaterThanOrEqual(60);
    expect(bad).toEqual([]);
  });
});

describe('format handling', () => {
  it('sniffs by magic, not by name', () => {
    expect(sniffFormat(encodePng({ width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).fill(255) }))).toBe('png');
    expect(sniffFormat(fs.readFileSync(path.join(dir, 'gif_plain0.gif')))).toBe('gif');
    expect(sniffFormat(fs.readFileSync(path.join(dir, 'bmp_rgb0.bmp')))).toBe('bmp');
    expect(sniffFormat(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
  it('refuses a 16-bit PNG with the way out, and unknown data', () => {
    expect(() => decodeImage(new Uint8Array(fs.readFileSync(path.join(dir, 'png16.png'))))).toThrow(/16-bit PNG.*python/);
    expect(() => decodeImage(new Uint8Array([1, 2, 3, 4]))).toThrow(ImageReadError);
  });
  it('decodes an 8-bit PNG', () => {
    const img = { width: 16, height: 16, data: new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? (i % 8 === 3 ? 255 : 128) : (i * 37) & 255)) };
    expect(Array.from(decodeImage(encodePng(img)).data)).toEqual(Array.from(img.data));
  });
});
