/**
 * palette.ts -- the Amstrad CPC colours, and the colour matching img2cpc.py
 * uses (tools/img2cpc.py is the reference; the vitest suite compares the two).
 *
 * Pure TypeScript, no vscode or node imports: runs in the extension host and
 * in webviews.
 *
 * Firmware colour numbers 0-26 are 9*G + 3*R + B, each of R, G, B being
 * 0/1/2 for 0x00/0x80/0xFF. The Gate Array has its own 5-bit ink numbers;
 * HW_COL is the library's table (runtime/gacolour.asm, __CPC_HWCOL) from one
 * to the other. CPC Plus colours are 12-bit: 4 bits per channel.
 */

export type RGB = readonly [number, number, number];

/** Firmware colour names, indexed by firmware colour number 0-26. */
export const FW_NAMES: readonly string[] = [
  'Black', 'Blue', 'Bright Blue', 'Red', 'Magenta', 'Mauve', 'Bright Red', 'Purple', 'Bright Magenta',
  'Green', 'Cyan', 'Sky Blue', 'Yellow', 'White', 'Pastel Blue', 'Orange', 'Pink', 'Pastel Magenta',
  'Bright Green', 'Sea Green', 'Bright Cyan', 'Lime', 'Pastel Green', 'Pastel Cyan', 'Bright Yellow',
  'Pastel Yellow', 'Bright White',
];

/** Firmware colour number -> Gate Array colour byte (&40 + hardware ink). */
export const HW_COL: readonly number[] = [
  0x54, 0x44, 0x55, 0x5c, 0x58, 0x5d, 0x4c, 0x45, 0x4d, // 0-8
  0x56, 0x46, 0x57, 0x5e, 0x40, 0x5f, 0x4e, 0x47, 0x4f, // 9-17
  0x52, 0x42, 0x53, 0x5a, 0x59, 0x5b, 0x4a, 0x43, 0x4b, // 18-26
];

/** Hardware ink number (0-31, as in the Gate Array colour byte's low 5 bits) of firmware colour n. */
export function hwInk(fw: number): number {
  return HW_COL[fw] & 0x1f;
}

/** 8-bit RGB of firmware colour n (0-26). */
export function fwRgb(n: number): RGB {
  const lv = [0x00, 0x80, 0xff];
  const g = Math.floor(n / 9);
  const r = Math.floor(n / 3) % 3;
  const b = n % 3;
  return [lv[r], lv[g], lv[b]];
}

/** The 27 firmware colours as 8-bit RGB. */
export const FW_TABLE: readonly RGB[] = Array.from({ length: 27 }, (_, n) => fwRgb(n));

export function dist2(a: RGB, b: RGB): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Index of the nearest entry by squared RGB distance; ties go to the lowest index. */
export function nearest(rgb: RGB, table: readonly RGB[]): number {
  let best = 0;
  let bestd = -1;
  for (let i = 0; i < table.length; i++) {
    const d = dist2(rgb, table[i]);
    if (bestd < 0 || d < bestd) {
      best = i;
      bestd = d;
    }
  }
  return best;
}

/** Nearest firmware colour (0-26) of an 8-bit RGB colour. */
export function nearestFw(rgb: RGB): number {
  return nearest(rgb, FW_TABLE);
}

// ------------------------------------------------------------- CPC Plus

/** 8-bit channel to 4 bits: round(c * 15 / 255), exact for multiples of 0x11. */
export function q4(c: number): number {
  return Math.floor((c * 15 + 127) / 255);
}

/** 8-bit RGB to a 4-bit-per-channel colour. */
export function rgb12(p: RGB): RGB {
  return [q4(p[0]), q4(p[1]), q4(p[2])];
}

/** 4-bit channels back to 8 bits (n * 0x11). */
export function rgb12To8(c: RGB): RGB {
  return [c[0] * 0x11, c[1] * 0x11, c[2] * 0x11];
}

/** The two palette-RAM bytes of a 4-bit (r, g, b) colour: red<<4 | blue, then green. */
export function asicEntry(c: RGB): [number, number] {
  return [(c[0] << 4) | c[2], c[1]];
}

/** Inverse of asicEntry (the high nibble of the green byte is ignored). */
export function asicDecode(lo: number, hi: number): RGB {
  return [(lo >> 4) & 15, hi & 15, lo & 15];
}

/** `&H0RGB` word of a 4-bit colour, as SetPalette12 takes it. */
export function rgb12Word(c: RGB): number {
  return (c[0] << 8) | (c[1] << 4) | c[2];
}

// ------------------------------------------------------------- list parsing

function tokens(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r\n|\r|\n/)) {
    const t = line.split('#', 1)[0].replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    out.push(...t);
  }
  return out;
}

/** Firmware colour list ("0,26,6,18", whitespace or commas, # comments). Throws on a bad entry. */
export function parsePalList(text: string): number[] {
  return tokens(text).map((tok) => {
    if (!/^[+-]?\d+$/.test(tok)) throw new Error(`bad palette entry '${tok}'`);
    const v = parseInt(tok, 10);
    if (v < 0 || v > 26) throw new Error(`palette colour ${v} is not a firmware colour (0-26)`);
    return v;
  });
}

/** 12-bit colour list: three hex digits RGB each ("F00,0F0"). Throws on a bad entry. */
export function parseRgb12List(text: string): RGB[] {
  return tokens(text).map((tok) => {
    if (!/^[0-9a-fA-F]{3}$/.test(tok)) throw new Error(`bad 12-bit colour '${tok}' (expected three hex digits RGB)`);
    return [parseInt(tok[0], 16), parseInt(tok[1], 16), parseInt(tok[2], 16)] as RGB;
  });
}
