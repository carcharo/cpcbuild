/**
 * <cb-pens> (UX 2.2): the pen selector. A radiogroup of slots, each a swatch with the pen number and
 * the colour number under it. Click sets the left pen, right-click or Alt+click the right pen, double-click
 * activates (colour chooser), Alt+Left/Right or drag reorders. Number text is never drawn on the swatch.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { Swatch } from './Swatch';

export interface PenSlot {
  index: number;
  /** CSS colour of the swatch; absent with `unset`. */
  colour?: string;
  /** Dashed empty slot, labelled "unset"; cannot be painted with. */
  unset?: boolean;
  /** The colour number shown under the pen number ("26"). */
  number: string;
  /** Spoken / tooltip name ("bright white"). */
  name: string;
  /** A warning for this slot (duplicate colour): shown as an icon and in the tooltip. */
  warn?: string;
  /** An error for this slot (bad token): red outline plus icon. */
  error?: string;
}

export interface PenStripProps {
  label: string;
  slots: PenSlot[];
  left: number;
  right?: number;
  /** Labelled groups for the Plus palette: each starts at slot index `from`. */
  groups?: { label: string; from: number }[];
  /** Show the colour name as a third line (wide layouts). */
  showNames?: boolean;
  /** One compact line of 32 px swatches with the pen label under each; number and name live in the tooltip. */
  compact?: boolean;
  /** Pens that exist but are not in use (above the mode's pen count): drawn dimmed, with this reason in the tooltip. */
  dim?(index: number): string | undefined;
  /** Caption under the swatch and in the accessible name; default "P3" / "Pen 3". */
  caption?(index: number): { short: string; spoken: string };
  onSelect(index: number, button: 'left' | 'right'): void;
  onActivate?(index: number): void;
  onReorder?(from: number, to: number): void;
}

export function PenStrip(p: PenStripProps) {
  const [focus, setFocus] = useState(p.left);
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | undefined>(undefined);
  const dragFrom = useRef<number | undefined>(undefined);
  useEffect(() => setFocus((f) => (p.slots.some((s) => s.index === f) ? f : p.left)), [p.slots.length, p.left]);
  useEffect(() => {
    if (refocus.current !== undefined) {
      root.current?.querySelector<HTMLElement>(`[data-pen="${refocus.current}"]`)?.focus();
      refocus.current = undefined;
    }
  });
  const cap = (i: number): { short: string; spoken: string } => p.caption?.(i) ?? { short: `P${i}`, spoken: `Pen ${i}` };
  const order = p.slots.map((s) => s.index);
  const moveFocus = (to: number): void => {
    setFocus(to);
    root.current?.querySelector<HTMLElement>(`[data-pen="${to}"]`)?.focus();
  };
  const onKeyDown = (s: PenSlot, e: KeyboardEvent): void => {
    const at = order.indexOf(s.index);
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && p.onReorder && !s.unset) {
      const to = s.index + (e.key === 'ArrowLeft' ? -1 : 1);
      if (order.includes(to) && !p.slots.find((x) => x.index === to)?.unset) {
        e.preventDefault();
        refocus.current = to;
        p.onReorder(s.index, to);
      }
      return;
    }
    if (e.key === 'ArrowRight') { e.preventDefault(); moveFocus(order[Math.min(order.length - 1, at + 1)]); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); moveFocus(order[Math.max(0, at - 1)]); }
    else if (e.key === 'Home') { e.preventDefault(); moveFocus(order[0]); }
    else if (e.key === 'End') { e.preventDefault(); moveFocus(order[order.length - 1]); }
    else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      p.onSelect(s.index, e.shiftKey || (e.altKey && e.key === 'Enter') ? 'right' : 'left');
    }
  };
  const render = (s: PenSlot) => {
    const dimWhy = p.dim?.(s.index);
    const isL = s.index === p.left;
    const isR = s.index === p.right;
    const badge = isL && isR ? 'LR' : isL ? 'L' : isR ? 'R' : '';
    const state = [isL && isR ? 'left and right button' : isL ? 'left button' : isR ? 'right button' : ''].filter(Boolean).join('');
    const aria = s.unset
      ? `${cap(s.index).spoken}, unset${state ? `, ${state}` : ''}`
      : `${cap(s.index).spoken}, colour ${s.number}${s.name ? `, ${s.name}` : ''}${state ? `, ${state}` : ''}${s.warn ? `, warning: ${s.warn}` : ''}${s.error ? `, error: ${s.error}` : ''}`;
    return (
      <button
        key={s.index}
        type="button"
        role="radio"
        aria-checked={isL}
        aria-label={aria}
        title={s.error ?? s.warn ?? dimWhy ?? (s.unset ? `${cap(s.index).short}: unset` : `${cap(s.index).short}: ${s.number}${s.name ? ` ${s.name}` : ''}`)}
        data-pen={s.index}
        tabIndex={s.index === focus ? 0 : -1}
        draggable={!!p.onReorder && !s.unset}
        class={`cb-pen${isL ? ' cb-pen-sel' : ''}${s.error ? ' cb-pen-error' : ''}${dimWhy ? ' cb-pen-dim' : ''}`}
        onFocus={() => setFocus(s.index)}
        onClick={(e) => p.onSelect(s.index, e.altKey ? 'right' : 'left')}
        onContextMenu={(e) => { e.preventDefault(); p.onSelect(s.index, 'right'); }}
        onDblClick={() => p.onActivate?.(s.index)}
        onKeyDown={(e) => onKeyDown(s, e)}
        onDragStart={(e) => { dragFrom.current = s.index; e.dataTransfer?.setData('text/plain', String(s.index)); }}
        onDragOver={(e) => { if (dragFrom.current !== undefined && !s.unset) e.preventDefault(); }}
        onDrop={(e) => {
          e.preventDefault();
          const from = dragFrom.current;
          dragFrom.current = undefined;
          if (from !== undefined && from !== s.index) p.onReorder?.(from, s.index);
        }}
      >
        <span class="cb-pen-swatch">
          <Swatch colour={s.colour} unset={s.unset} size={p.compact ? 32 : 28} />
          {badge && <span class="cb-pen-badge">{badge}</span>}
          {s.warn && !s.error && <span class="cb-pen-flag"><Icon name="warning" /></span>}
          {s.error && <span class="cb-pen-flag cb-pen-flag-error"><Icon name="error" /></span>}
        </span>
        <span class="cb-pen-num">{cap(s.index).short}</span>
        {!p.compact && <span class="cb-pen-col">{s.unset ? 'unset' : s.number}</span>}
        {!p.compact && p.showNames && <span class="cb-pen-name">{s.unset ? '' : s.name}</span>}
      </button>
    );
  };
  const groups = p.groups ?? [{ label: '', from: 0 }];
  return (
    <div class={`cb-pens${p.compact ? ' cb-pens-compact' : ''}`} role="radiogroup" aria-label={p.label} ref={root}>
      {groups.map((g, gi) => {
        const to = gi + 1 < groups.length ? groups[gi + 1].from : Infinity;
        const slots = p.slots.filter((s) => s.index >= g.from && s.index < to);
        if (!slots.length) return null;
        return (
          <div key={g.from} class="cb-pen-group" role="presentation">
            {g.label && <div class="cb-pen-group-h" aria-hidden="true">{g.label}</div>}
            <div class="cb-pen-row" role="presentation">{slots.map(render)}</div>
          </div>
        );
      })}
    </div>
  );
}
