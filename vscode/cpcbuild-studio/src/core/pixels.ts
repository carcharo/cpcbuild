/**
 * pixels.ts -- CPC screen-byte pixel packing, both directions.
 *
 * Mode 0: 2 pixels per byte, 16 pens; mode 1: 4 pixels, 4 pens; mode 2: 8
 * pixels, 2 pens. The bits of a pixel are interleaved as the Gate Array
 * wants them (see tools/img2cpc.py):
 *   mode 0  left pixel: pen bits 0..3 in byte bits 7,3,5,1; right pixel one bit lower
 *   mode 1  pixel n: pen bit 0 in byte bit 7-n, pen bit 1 in byte bit 3-n
 *   mode 2  pixel n: byte bit 7-n
 * Plus sprites (16x16, ASIC): one byte per pixel (low nibble), or packed two
 * per byte with the left pixel in the high nibble.
 *
 * Pure TypeScript, no vscode or node imports.
 */

export type Mode = 0 | 1 | 2;

/** Pens per mode. */
export const MAXPENS: Record<Mode, number> = { 0: 16, 1: 4, 2: 2 };
/** Pixels per screen byte. */
export const PPB: Record<Mode, number> = { 0: 2, 1: 4, 2: 8 };

/** The tile widths (pixels) a mode allows: 1, 2 or 4 bytes. */
export const tileWidthsOf = (mode: Mode): number[] => [1, 2, 4].map((b) => b * PPB[mode]);

/** The tool's message for a tile width the mode does not allow, or undefined when it is fine. */
export function tileWidthError(tw: number, mode: Mode): string | undefined {
  const ok = tileWidthsOf(mode);
  return ok.includes(tw) ? undefined : `tile width ${tw} must be ${ok[0]}, ${ok[1]} or ${ok[2]} pixels in mode ${mode} (1, 2 or 4 bytes)`;
}

const M0_BITS = [7, 3, 5, 1];

/** The screen-byte bits of pixel n (0 = leftmost) holding `pen`. */
export function pixelBits(mode: Mode, n: number, pen: number): number {
  if (mode === 0) {
    let b = 0;
    for (let plane = 0; plane < 4; plane++) if ((pen >> plane) & 1) b |= 1 << (M0_BITS[plane] - n);
    return b;
  }
  if (mode === 1) return ((pen & 1) << (7 - n)) | (((pen >> 1) & 1) << (3 - n));
  return (pen & 1) << (7 - n);
}

/** All the bits of pixel n (the mask of one pixel). */
export function pixelMask(mode: Mode, n: number): number {
  return pixelBits(mode, n, MAXPENS[mode] - 1);
}

/** One screen byte from its PPB[mode] pens, leftmost first. */
export function encodeByte(mode: Mode, pens: readonly number[]): number {
  let b = 0;
  for (let n = 0; n < pens.length; n++) b |= pixelBits(mode, n, pens[n]);
  return b;
}

/** The PPB[mode] pens of a screen byte, leftmost first (inverse of encodeByte). */
export function decodeByte(mode: Mode, byte: number): number[] {
  const out: number[] = [];
  for (let n = 0; n < PPB[mode]; n++) {
    let pen = 0;
    if (mode === 0) {
      for (let plane = 0; plane < 4; plane++) pen |= ((byte >> (M0_BITS[plane] - n)) & 1) << plane;
    } else if (mode === 1) {
      pen = ((byte >> (7 - n)) & 1) | (((byte >> (3 - n)) & 1) << 1);
    } else {
      pen = (byte >> (7 - n)) & 1;
    }
    out.push(pen);
  }
  return out;
}

/** Pen grid cell: a pen number, or null where transparent. */
export type PenGrid = (number | null)[][];

/**
 * Bytes of the wpx x hpx pixel block at (x0, y0): rows top first, each row's
 * bytes left to right; (mask, pixel) pairs when masked (mask bit 1 keeps the
 * background, set where the pixel is transparent).
 */
export function packBlock(
  grid: PenGrid, x0: number, y0: number, wpx: number, hpx: number, mode: Mode, masked: boolean,
): number[] {
  const ppb = PPB[mode];
  const out: number[] = [];
  for (let y = y0; y < y0 + hpx; y++) {
    for (let bx = x0; bx < x0 + wpx; bx += ppb) {
      const pens: number[] = [];
      let mask = 0;
      for (let n = 0; n < ppb; n++) {
        let p = grid[y][bx + n];
        if (p === null) {
          mask |= pixelMask(mode, n);
          p = 0;
        }
        pens.push(p);
      }
      if (masked) out.push(mask);
      out.push(encodeByte(mode, pens));
    }
  }
  return out;
}

/**
 * Inverse of packBlock for a w-pixel-wide block: pens row-major (w x h). With
 * `masked` the data holds (mask, pixel) pairs and masked-out pixels come back
 * as null.
 */
export function unpackBlock(data: ArrayLike<number>, wpx: number, hpx: number, mode: Mode, masked: boolean): (number | null)[] {
  const ppb = PPB[mode];
  const out: (number | null)[] = [];
  let i = 0;
  for (let y = 0; y < hpx; y++) {
    for (let bx = 0; bx < wpx; bx += ppb) {
      const mask = masked ? data[i++] : 0;
      const pens = decodeByte(mode, data[i++]);
      for (let n = 0; n < ppb; n++) out.push(mask & pixelMask(mode, n) ? null : pens[n]);
    }
  }
  return out;
}

/** Plus sprite: 256 pixels (0 = transparent, 1-15) packed two per byte, left pixel in the high nibble. */
export function packPlusSprite(px: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < px.length; i += 2) out.push(((px[i] & 15) << 4) | (px[i + 1] & 15));
  return out;
}

/** Inverse of packPlusSprite. */
export function unpackPlusSprite(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) out.push(data[i] >> 4, data[i] & 15);
  return out;
}
