/** <cb-swatch>: a square of one colour with an outline so black and white stay visible on any theme. */
export function Swatch({ colour, size, unset, title }: { colour?: string; size?: number; unset?: boolean; title?: string }) {
  const style = size ? { width: `${size}px`, height: `${size}px` } : undefined;
  if (unset || !colour) return <span class="cb-swatch cb-swatch-unset" style={style} title={title} aria-hidden="true" />;
  return <span class="cb-swatch" style={{ ...style, backgroundColor: colour }} title={title} aria-hidden="true" />;
}

export const rgbCss = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
