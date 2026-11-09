/** <cb-swatch-round>: a round colour dot with an optional selection ring. Decorative (aria-hidden); the owner labels it. Left and right rings differ by line shape (solid vs double) as well as hue, but the owner must still say "left" / "right" in text (PenStrip's L / R badges). The number is never drawn on it. */
export function RoundSwatch({ colour, unset, ring, size, title }: { colour?: string; unset?: boolean; ring?: 'sel' | 'left' | 'right' | 'dashed'; size?: number; title?: string }) {
  const dim = size ? { width: `${size}px`, height: `${size}px` } : undefined;
  const dot =
    unset || !colour ? (
      <span class="cb-swatch cb-swatch-round cb-swatch-unset" style={dim} title={title} aria-hidden="true" />
    ) : (
      <span class="cb-swatch cb-swatch-round" style={{ ...dim, backgroundColor: colour }} title={title} aria-hidden="true" />
    );
  return <span class={`cb-swatch-ring${ring ? ` cb-ring-${ring}` : ''}`} aria-hidden="true">{dot}</span>;
}
