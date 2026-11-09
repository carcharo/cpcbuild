/** Mini-graph path (pure): values 0..1 become an SVG path `d` string for a small polyline (shelf cards). */

const r = (n: number): string => String(Math.round(n * 100) / 100);

/** Values are clamped to 0..1, 1 at the top. Empty gives ''; one value gives a horizontal line; points spread over the width. */
export function shapePath(values: readonly number[], w = 28, h = 12): string {
  if (!values.length) return '';
  const pad = 1; // keep the stroke inside the box
  const y = (v: number): number => pad + (1 - Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))) * (h - 2 * pad);
  if (values.length === 1) return `M${r(pad)} ${r(y(values[0]))}L${r(w - pad)} ${r(y(values[0]))}`;
  return values.map((v, i) => `${i ? 'L' : 'M'}${r(pad + (i * (w - 2 * pad)) / (values.length - 1))} ${r(y(v))}`).join('');
}
