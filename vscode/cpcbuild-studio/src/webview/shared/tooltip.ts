/** Tooltip text and placement (pure; the component is components/Tooltip.tsx). */

/** "Label (shortcut)", or "Label (why)" while disabled with a reason. */
export function tipText(i: { label: string; shortcut?: string; disabled?: boolean; why?: string }): string {
  const extra = i.disabled && i.why ? i.why : i.shortcut;
  return extra ? `${i.label} (${extra})` : i.label;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Hover delay before a tooltip shows (ms). */
export const TIP_DELAY = 500;

/**
 * Where the tooltip goes: centred below the anchor, 4 px away, kept inside the viewport (a margin of 4 px);
 * above the anchor when there is no room below.
 */
export function placeTip(anchor: Box, tip: { width: number; height: number }, view: { width: number; height: number }): { left: number; top: number } {
  const gap = 4;
  const edge = 4;
  const left = Math.max(edge, Math.min(anchor.left + anchor.width / 2 - tip.width / 2, view.width - tip.width - edge));
  const below = anchor.top + anchor.height + gap;
  const top = below + tip.height + edge <= view.height ? below : Math.max(edge, anchor.top - gap - tip.height);
  return { left, top };
}
