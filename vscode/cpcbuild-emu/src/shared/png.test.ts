import { describe, expect, it } from 'vitest';
import { inflateSync } from 'zlib';
import { encodePng } from './png';

describe('encodePng', () => {
  it('writes a decodable RGB PNG', () => {
    const w = 3, h = 2, rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([i * 10, i * 20, i * 30, 255], i * 4);
    const png = encodePng(rgba, w, h);
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(w);
    expect(png.readUInt32BE(20)).toBe(h);
    const idatLen = png.readUInt32BE(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe(h * (1 + w * 3));
    expect([...raw.subarray(1, 4)]).toEqual([0, 0, 0]);
    expect([...raw.subarray(4, 7)]).toEqual([10, 20, 30]);
    expect([...raw.subarray(11, 14)]).toEqual([30, 60, 90]);
  });
});
