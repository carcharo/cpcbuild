/** Roving-tabindex arithmetic (pure): which item a key moves to. Used by TransportPod, Shelf and SegPill. */

export type RovingAxis = 'horizontal' | 'vertical' | 'both';

/**
 * The index a navigation key moves to from `cur` among `len` items, wrapping at the ends and skipping
 * items for which `disabled(i)` is true; Home / End go to the first / last enabled item. Returns undefined
 * when the key does not navigate on this axis or no enabled item exists. `wrap: false` stops at the ends.
 */
export function rovingNext(len: number, cur: number, key: string, opts: { axis?: RovingAxis; disabled?: (i: number) => boolean; wrap?: boolean } = {}): number | undefined {
  const axis = opts.axis ?? 'both';
  const off = opts.disabled ?? (() => false);
  const wrap = opts.wrap ?? true;
  if (len <= 0) return undefined;
  const fwdKeys = axis === 'horizontal' ? ['ArrowRight'] : axis === 'vertical' ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  const backKeys = axis === 'horizontal' ? ['ArrowLeft'] : axis === 'vertical' ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  const scan = (from: number, step: 1 | -1): number | undefined => {
    for (let n = 0, i = from; n < len; n++, i += step) {
      if (!wrap && (i < 0 || i >= len)) return undefined;
      const j = ((i % len) + len) % len;
      if (!off(j)) return j;
    }
    return undefined;
  };
  if (key === 'Home') return scan(0, 1);
  if (key === 'End') return scan(len - 1, -1);
  if (fwdKeys.includes(key)) return scan(cur + 1, 1);
  if (backKeys.includes(key)) return scan(cur - 1, -1);
  return undefined;
}
