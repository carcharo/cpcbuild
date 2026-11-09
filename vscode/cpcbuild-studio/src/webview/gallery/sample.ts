/** The 16 x 16 sample of the CPC preview mock: a circle of seven firmware colours (index into SAMPLE_PENS; 255 transparent). */
import { fromFirmware, TRANSPARENT, type IndexedImage } from '../../core/cpcPreview';

/** Firmware colours: Blue, Pink, Bright Red, Sky Blue, Bright Yellow, Bright White, Black. */
export const SAMPLE_PENS = [1, 16, 6, 11, 24, 26, 0];

export function sampleImage(): IndexedImage {
  const px = new Uint8Array(256).fill(TRANSPARENT);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const cx = x - 7.5, cy = y - 7.5, d = Math.sqrt(cx * cx + cy * cy);
      let i = TRANSPARENT;
      if (d < 7) i = 0;
      if (d >= 6.2 && d < 7) i = 6;
      if (d < 5.5) i = 2;
      if (y >= 4 && y <= 8 && x >= 4 && x <= 11) i = 1;
      if (y === 6 && (x === 6 || x === 9)) i = 5;
      if (y >= 11 && x >= 5 && x <= 10 && d < 7) i = 3;
      if (y === 2 && x >= 6 && x <= 9) i = 4;
      px[y * 16 + x] = i;
    }
  }
  return fromFirmware(16, 16, px, SAMPLE_PENS);
}
