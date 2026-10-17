import { describe, expect, it } from 'vitest';
import { decodeByte, encodeByte, MAXPENS, packBlock, packPlusSprite, PPB, pixelBits, pixelMask, unpackBlock, unpackPlusSprite, type Mode } from './pixels';
import { asicDecode, asicEntry, fwRgb, hwInk, nearestFw, q4, rgb12, rgb12To8, parsePalList } from './palette';
import { rng } from './testutil';

const modes: Mode[] = [0, 1, 2];

describe('pixel packing', () => {
  it('known mode 0/1/2 bytes (as tests/tools/test_img2cpc.py)', () => {
    expect(pixelBits(0, 0, 15)).toBe(0xaa);
    expect(pixelBits(0, 1, 15)).toBe(0x55);
    expect(encodeByte(0, [15, 15])).toBe(0xff);
    expect(encodeByte(1, [3, 0, 0, 0])).toBe(0x88);
    expect(encodeByte(2, [1, 0, 0, 0, 0, 0, 0, 1])).toBe(0x81);
    expect(pixelMask(1, 2)).toBe(0x22);
  });

  for (const mode of modes) {
    it(`mode ${mode}: every byte value round-trips through decode/encode`, () => {
      // mode 0..2 byte <-> pens is a bijection over all 256 values
      for (let b = 0; b < 256; b++) expect(encodeByte(mode, decodeByte(mode, b))).toBe(b);
    });

    it(`mode ${mode}: every pen combination round-trips`, () => {
      const n = PPB[mode], maxp = MAXPENS[mode];
      const total = Math.min(maxp ** n, 65536);
      for (let k = 0; k < total; k++) {
        const pens: number[] = [];
        for (let i = 0, v = k; i < n; i++, v = Math.floor(v / maxp)) pens.push(v % maxp);
        expect(decodeByte(mode, encodeByte(mode, pens))).toEqual(pens);
      }
    });

    it(`mode ${mode}: blocks round-trip, plain and masked`, () => {
      const r = rng(7 + mode);
      const w = PPB[mode] * 3, h = 5;
      const grid = Array.from({ length: h }, () =>
        Array.from({ length: w }, () => (r() < 0.2 ? null : Math.floor(r() * MAXPENS[mode]))));
      const masked = packBlock(grid, 0, 0, w, h, mode, true);
      expect(unpackBlock(masked, w, h, mode, true)).toEqual(grid.flat());
      // unmasked: transparent becomes pen 0
      const plain = packBlock(grid, 0, 0, w, h, mode, false);
      expect(unpackBlock(plain, w, h, mode, false)).toEqual(grid.flat().map((p) => p ?? 0));
    });
  }

  it('Plus packed sprite round-trips', () => {
    const r = rng(3);
    const px = Array.from({ length: 256 }, () => Math.floor(r() * 16));
    const packed = packPlusSprite(px);
    expect(packed.length).toBe(128);
    expect(unpackPlusSprite(packed)).toEqual(px);
  });
});

describe('palette helpers', () => {
  it('firmware colours', () => {
    expect(fwRgb(0)).toEqual([0, 0, 0]);
    expect(fwRgb(26)).toEqual([255, 255, 255]);
    expect(fwRgb(6)).toEqual([255, 0, 0]);
    expect(fwRgb(18)).toEqual([0, 255, 0]);
    expect(fwRgb(2)).toEqual([0, 0, 255]);
    expect(nearestFw([250, 250, 250])).toBe(26);
    expect(hwInk(0)).toBe(0x14);
    expect(hwInk(26)).toBe(0x0b);
  });
  it('12-bit colours', () => {
    expect(rgb12([0x11, 0x22, 0xff])).toEqual([1, 2, 15]);
    expect(q4(0x77)).toBe(7);
    expect(rgb12To8([1, 2, 15])).toEqual([0x11, 0x22, 0xff]);
    expect(asicEntry([15, 2, 1])).toEqual([0xf1, 2]);
    expect(asicDecode(0xf1, 2)).toEqual([15, 2, 1]);
  });
  it('palette lists', () => {
    expect(parsePalList('0,26 6\n# c\n18')).toEqual([0, 26, 6, 18]);
    expect(() => parsePalList('27')).toThrow();
  });
});
