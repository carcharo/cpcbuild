/**
 * image.ts -- a minimal RGBA image and PNG decoding.
 *
 * Pure JS (upng-js, which brings pako): no node:zlib, so it runs in the
 * extension host and in webviews. Only PNG is decoded for now; GIF and BMP
 * (which Pillow reads for img2cpc.py) may come later.
 */
import * as UPNG from 'upng-js';

/** width x height pixels, `data` is 4 bytes per pixel (R, G, B, A), rows top first. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Decodes a PNG (any colour type or depth; palette, grey and tRNS expanded) to 8-bit RGBA. */
export function decodePng(bytes: Uint8Array): RgbaImage {
  // upng wants an ArrayBuffer of exactly the file's bytes
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  let png: UPNG.Image;
  try {
    png = UPNG.decode(buf);
  } catch (e) {
    throw new Error(`not a readable PNG (${e instanceof Error ? e.message : String(e)})`);
  }
  const frames = UPNG.toRGBA8(png);
  return { width: png.width, height: png.height, data: new Uint8Array(frames[0]) };
}

/** Encodes RGBA pixels as a PNG (for previews and tests). */
export function encodePng(img: RgbaImage): Uint8Array {
  const raw = img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength) as ArrayBuffer;
  return new Uint8Array(UPNG.encode([raw], img.width, img.height, 0));
}

/** A blank (transparent) image. */
export function newImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/** RGBA of pixel (x, y). */
export function getPixel(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

/** Sets pixel (x, y). */
export function setPixel(img: RgbaImage, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
}
