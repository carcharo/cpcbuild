/** <cb-shelf>: a vertical listbox of identity-coloured cards (badge ring, name, meta, mini shape). Roving tabindex; arrows select, Enter activates, Alt+Up/Down moves. */
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import { tipText } from '../tooltip';
import { useTooltip } from './Tooltip';
import { rovingNext } from '../roving';
import { shapePath } from '../shape';
import { idVar } from '../theme';

export interface ShelfItem {
  id: string;
  badge: string;
  /** Identity colour index 1..12 (never part of the accessible name). */
  colour: number;
  name: string;
  meta?: string;
  /** Values 0..1 drawn as a polyline. */
  shape?: number[];
  title?: string;
}

export interface ShelfProps {
  label: string;
  items: ShelfItem[];
  selected: string | undefined;
  onSelect(id: string): void;
  onActivate?(id: string): void;
  onMove?(id: string, delta: -1 | 1): void;
  actions?: ComponentChildren;
  /** Below 720px the shelf becomes a scrolling row of chips (badge and name only). */
  narrowChips?: boolean;
}

export function Shelf(p: ShelfProps) {
  const root = useRef<HTMLDivElement>(null);
  const tt = useTooltip();
  const sel = p.items.findIndex((i) => i.id === p.selected);
  const tabbable = sel >= 0 ? sel : 0;
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const it = p.items[i];
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && p.onMove) {
      e.preventDefault();
      p.onMove(it.id, e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.key === 'Enter' && p.onActivate) { e.preventDefault(); p.onActivate(it.id); return; }
    const n = rovingNext(p.items.length, i, e.key, { axis: 'vertical', wrap: false });
    // in the narrow chip row left / right move too
    const m = n ?? (e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? rovingNext(p.items.length, i, e.key, { axis: 'horizontal', wrap: false }) : undefined);
    if (m === undefined) return;
    e.preventDefault();
    p.onSelect(p.items[m].id);
    root.current?.querySelectorAll<HTMLElement>('[role="option"]')[m]?.focus();
  };
  return (
    <div class="cb-shelf-wrap">
      <div class={`cb-shelf${p.narrowChips ? ' cb-shelf-narrow-chips' : ''}`} role="listbox" aria-label={p.label} ref={root}>
        {p.items.map((it, i) => (
          <div
            key={it.id}
            role="option"
            class="cb-shelf-card"
            aria-selected={it.id === p.selected}
            aria-label={`${it.badge} ${it.name}${it.meta ? `, ${it.meta}` : ''}`}
            {...(it.title ? tt.props(it.id, tipText({ label: it.title })) : {})}
            tabIndex={i === tabbable ? 0 : -1}
            style={{ '--cb-id': idVar(it.colour) } as never}
            onClick={() => p.onSelect(it.id)}
            onDblClick={() => p.onActivate?.(it.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span class="cb-badge-ring" aria-hidden="true">{it.badge}</span>
            <span class="cb-shelf-text" aria-hidden="true">
              <span class="cb-shelf-name">{it.name}</span>
              {it.meta && <span class="cb-shelf-meta">{it.meta}</span>}
            </span>
            {it.shape && (
              <svg class="cb-shelf-shape" viewBox="0 0 28 12" aria-hidden="true">
                <path d={shapePath(it.shape)} />
              </svg>
            )}
          </div>
        ))}
      </div>
      {tt.node}
      {p.actions && <div class="cb-shelf-actions">{p.actions}</div>}
    </div>
  );
}
