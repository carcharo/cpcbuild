/** Which firmware colours are in use: by pens and by the border (palette editor, F9). Pure. */
export interface ColourUse {
  /** Pen numbers (ascending) that hold the colour. */
  pens: number[];
  border: boolean;
}

/** Use of every colour that appears in `entries` or as the border; colours not used are absent. */
export function colourUse(entries: readonly number[], border: number | null): Map<number, ColourUse> {
  const m = new Map<number, ColourUse>();
  const at = (c: number): ColourUse => {
    let u = m.get(c);
    if (!u) m.set(c, (u = { pens: [], border: false }));
    return u;
  };
  entries.forEach((v, i) => { if (v >= 0) at(v).pens.push(i); });
  if (border !== null) at(border).border = true;
  return m;
}

/** "used by pen 1, 4", "used by the border" or "used by pen 2; used by the border"; '' when unused. */
export function usedByText(u: ColourUse | undefined): string {
  if (!u) return '';
  const parts: string[] = [];
  if (u.pens.length) parts.push(`used by pen ${u.pens.join(', ')}`);
  if (u.border) parts.push('used by the border');
  return parts.join('; ');
}
