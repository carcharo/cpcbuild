/**
 * imageio.ts -- the importer's image reader: PNG, GIF and BMP to 8-bit RGBA, in pure TypeScript
 * (no canvas: a browser canvas may colour-manage or premultiply and change RGB values, which
 * would break byte identity with img2cpc.py; spec 4.4).
 *
 * The aim is Pillow's `Image.open(p).convert("RGBA")` as `load_image` in tools/img2cpc.py does it:
 *   PNG  decodePng (image.ts; gAMA / iCCP ignored, palette + tRNS, grey expanded). 16-bit PNGs are
 *        refused (Pillow reads them as "I;16" or truncates, which differs from upng); use the
 *        Python engine for those.
 *   GIF  first frame only; the transparency index of the graphic control block gives alpha 0.
 *   BMP  1, 4, 8 (palette), 16, 24 and 32 bits, bottom-up and top-down; RLE is refused.
 * src/core/imageio.test.ts compares all three with Pillow on generated images.
 *
 * No vscode or node imports.
 */
import { decodePng, type RgbaImage } from './image';

export class ImageReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageReadError';
  }
}

const bad = (msg: string): never => {
  throw new ImageReadError(msg);
};

export type ImageFormat = 'png' | 'gif' | 'bmp';

export function sniffFormat(b: Uint8Array): ImageFormat | undefined {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'bmp';
  return undefined;
}

/** Decodes a PNG, GIF or BMP to RGBA. Throws ImageReadError with a message fit for the user. */
export function decodeImage(bytes: Uint8Array): RgbaImage {
  const fmt = sniffFormat(bytes);
  if (fmt === 'png') {
    // IHDR: width(4) height(4) bit depth(1) at offset 24
    if (bytes.length > 24 && bytes[24] === 16) {
      bad('16-bit PNG images are not supported by the built-in engine (set "cpcbuild.assets.engine" to "python", or save the image as 8 bits per channel)');
    }
    try {
      return decodePng(bytes);
    } catch (e) {
      throw new ImageReadError((e as Error).message);
    }
  }
  if (fmt === 'gif') return decodeGif(bytes);
  if (fmt === 'bmp') return decodeBmp(bytes);
  return bad('not a PNG, GIF or BMP image');
}

// ------------------------------------------------------------------ GIF

function lzwDecode(data: Uint8Array, minCode: number, npix: number): Uint8Array {
  const out = new Uint8Array(npix);
  if (minCode < 1 || minCode > 11) bad('bad GIF (LZW code size)');
  const clear = 1 << minCode, eoi = clear + 1;
  const prefix = new Int16Array(4096), suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let size = minCode + 1, mask = (1 << size) - 1, next = eoi + 1, prev = -1, first = 0;
  let bits = 0, nb = 0, pos = 0, o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < npix) {
    while (nb < size && pos < data.length) {
      bits |= data[pos++] << nb;
      nb += 8;
    }
    if (nb < size) break;
    let code = bits & mask;
    bits >>>= size;
    nb -= size;
    if (code === clear) {
      size = minCode + 1; mask = (1 << size) - 1; next = eoi + 1; prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      out[o++] = suffix[code];
      prev = first = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      stack[sp++] = first;
      code = prev;
    }
    while (code >= clear) {
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    first = suffix[code];
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if ((next & mask) === 0 && next < 4096) {
        size++;
        mask = (1 << size) - 1;
      }
    }
    while (sp > 0 && o < npix) out[o++] = stack[--sp];
    prev = inCode;
  }
  return out;
}

export function decodeGif(b: Uint8Array): RgbaImage {
  if (b.length < 13) bad('not a readable GIF (truncated)');
  const u16 = (i: number): number => b[i] | (b[i + 1] << 8);
  const sw = u16(6), sh = u16(8), flags = b[10];
  let p = 13;
  const readTable = (n: number): Uint8Array => {
    if (p + n * 3 > b.length) bad('not a readable GIF (truncated palette)');
    const t = b.slice(p, p + n * 3);
    p += n * 3;
    return t;
  };
  let global: Uint8Array | undefined;
  if (flags & 0x80) global = readTable(2 << (flags & 7));
  let transparent = -1;
  for (;;) {
    if (p >= b.length) bad('not a readable GIF (no image)');
    const t = b[p++];
    if (t === 0x21) {
      const label = b[p++];
      if (label === 0xf9 && b[p] >= 4) {
        if (b[p + 1] & 1) transparent = b[p + 4];
        else transparent = -1;
      }
      while (p < b.length && b[p] !== 0) p += b[p] + 1;
      p++;
    } else if (t === 0x2c) {
      const left = u16(p), top = u16(p + 2), w = u16(p + 4), h = u16(p + 6), f = b[p + 8];
      p += 9;
      const table = f & 0x80 ? readTable(2 << (f & 7)) : global;
      const minCode = b[p++];
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (p < b.length && b[p] !== 0) {
        const n = b[p];
        chunks.push(b.subarray(p + 1, p + 1 + n));
        total += n;
        p += n + 1;
      }
      const data = new Uint8Array(total);
      let q = 0;
      for (const c of chunks) {
        data.set(c, q);
        q += c.length;
      }
      let idx = lzwDecode(data, minCode, w * h);
      if (f & 0x40) {
        // interlaced: rows come in four passes
        const de = new Uint8Array(w * h);
        let src = 0;
        for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
          for (let y = start; y < h; y += step) {
            de.set(idx.subarray(src * w, src * w + w), y * w);
            src++;
          }
        }
        idx = de;
      }
      // Pillow's canvas is the logical screen; outside the frame it holds palette index 0 (opaque)
      const W = sw || w, H = sh || h;
      const out = new Uint8Array(W * H * 4);
      const rgb = (i: number): [number, number, number] => (table && i * 3 + 2 < table.length ? [table[i * 3], table[i * 3 + 1], table[i * 3 + 2]] : [i, i, i]);
      const bgc = rgb(0);
      for (let i = 0; i < W * H; i++) {
        out[i * 4] = bgc[0]; out[i * 4 + 1] = bgc[1]; out[i * 4 + 2] = bgc[2]; out[i * 4 + 3] = transparent === 0 ? 0 : 255;
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const X = left + x, Y = top + y;
          if (X >= W || Y >= H) continue;
          const i = idx[y * w + x];
          const c = rgb(i);
          const o = (Y * W + X) * 4;
          out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = i === transparent ? 0 : 255;
        }
      }
      return { width: W, height: H, data: out };
    } else if (t === 0x3b) bad('not a readable GIF (no image)');
    else bad('not a readable GIF (bad block)');
  }
}

// ------------------------------------------------------------------ BMP

export function decodeBmp(b: Uint8Array): RgbaImage {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 26) bad('not a readable BMP (truncated)');
  const dataOff = dv.getUint32(10, true);
  const hdr = dv.getUint32(14, true);
  let w: number, h: number, bpp: number, comp = 0, ncol = 0, palEntry = 4;
  if (hdr === 12) {
    w = dv.getUint16(18, true);
    h = dv.getUint16(20, true);
    bpp = dv.getUint16(24, true);
    palEntry = 3;
  } else if (hdr >= 40) {
    w = dv.getInt32(18, true);
    h = dv.getInt32(22, true);
    bpp = dv.getUint16(28, true);
    comp = dv.getUint32(30, true);
    ncol = dv.getUint32(46, true);
  } else {
    return bad('not a readable BMP (unknown header)');
  }
  const topDown = h < 0;
  h = Math.abs(h);
  if (w <= 0 || h === 0) bad('not a readable BMP (bad size)');
  if (comp === 1 || comp === 2) bad('RLE-compressed BMP files are not supported by the built-in engine (save the BMP uncompressed, or use the Python engine)');
  if (comp !== 0 && comp !== 3) bad(`unsupported BMP compression ${comp}`);
  const out = new Uint8Array(w * h * 4);
  const stride = ((w * bpp + 31) >> 5) * 4;
  if (dataOff + stride * h > b.length) bad('not a readable BMP (truncated pixel data)');
  let masks: number[] | undefined;
  if (comp === 3) {
    if (hdr >= 52) masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true), hdr >= 56 ? dv.getUint32(66, true) : 0];
    else masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true), 0];
  }
  let pal: Uint8Array | undefined;
  if (bpp <= 8) {
    const n = ncol || 1 << bpp;
    const at = 14 + hdr;
    pal = new Uint8Array(256 * 3);
    for (let i = 0; i < Math.min(n, 256); i++) {
      const o = at + i * palEntry;
      pal[i * 3] = b[o + 2]; pal[i * 3 + 1] = b[o + 1]; pal[i * 3 + 2] = b[o];
    }
  }
  const scale = (v: number, mask: number): number => {
    if (!mask) return 0;
    let s = 0;
    while (!((mask >>> s) & 1)) s++;
    const max = mask >>> s;
    return Math.round(((v & mask) >>> s) * 255 / max);
  };
  for (let y = 0; y < h; y++) {
    const row = dataOff + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (bpp <= 8) {
        const per = 8 / bpp;
        const byte = b[row + Math.floor(x / per)];
        const shift = 8 - bpp - (x % per) * bpp;
        const i = (byte >> shift) & ((1 << bpp) - 1);
        out[o] = pal![i * 3]; out[o + 1] = pal![i * 3 + 1]; out[o + 2] = pal![i * 3 + 2]; out[o + 3] = 255;
      } else if (bpp === 24) {
        const q = row + x * 3;
        out[o] = b[q + 2]; out[o + 1] = b[q + 1]; out[o + 2] = b[q]; out[o + 3] = 255;
      } else if (bpp === 32) {
        const q = row + x * 4;
        if (masks) {
          const v = dv.getUint32(q, true);
          out[o] = scale(v, masks[0]); out[o + 1] = scale(v, masks[1]); out[o + 2] = scale(v, masks[2]);
          out[o + 3] = masks[3] ? scale(v, masks[3]) : 255;
        } else {
          out[o] = b[q + 2]; out[o + 1] = b[q + 1]; out[o + 2] = b[q]; out[o + 3] = 255;
        }
      } else if (bpp === 16) {
        const v = dv.getUint16(row + x * 2, true);
        const m = masks ?? [0x7c00, 0x03e0, 0x001f, 0];
        out[o] = scale(v, m[0]); out[o + 1] = scale(v, m[1]); out[o + 2] = scale(v, m[2]); out[o + 3] = m[3] ? scale(v, m[3]) : 255;
      } else {
        bad(`unsupported BMP depth ${bpp}`);
      }
    }
  }
  return { width: w, height: h, data: out };
}
