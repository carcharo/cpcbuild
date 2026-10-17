/** A codicon (bundled font; the glyph is decoration, never the only label). */
export function Icon({ name, spin }: { name: string; spin?: boolean }) {
  return <span class={`codicon codicon-${name}${spin ? ' codicon-modifier-spin' : ''}`} aria-hidden="true" />;
}
