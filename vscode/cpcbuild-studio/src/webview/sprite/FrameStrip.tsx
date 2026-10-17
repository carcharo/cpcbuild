/**
 * <cb-frames> (UX 3.2, 4.3): the frame strip of the sprite editor and the tile sheet of the tile editor.
 * A listbox with a roving tabindex that follows focus; arrows select, Alt+Arrow reorders, Delete deletes,
 * Insert adds, Enter moves focus to the canvas. Drag reorders too.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../shared/components/Icon';
import { Thumb } from './Thumb';

export interface FrameStripProps {
  thumbs: Uint8ClampedArray[];
  w: number;
  h: number;
  selected: number;
  noun: 'frame' | 'tile';
  /** 'strip' = a single row / column (frames); 'grid' = wraps (tile sheet). */
  layout: 'strip' | 'grid';
  horizontal: boolean;
  canDelete: boolean;
  canAdd: boolean;
  addWhy?: string;
  /** Tile numbers drawn on the thumbnails. */
  numbers?: boolean;
  /** Indices that duplicate an earlier tile (the info icon). */
  duplicates?: Set<number>;
  onSelect(i: number): void;
  onAdd(): void;
  onDuplicate(i: number): void;
  onDelete(i: number): void;
  onMove(from: number, to: number): void;
  onEnter(): void;
  onColumns?(n: number): void;
}

export function FrameStrip(p: FrameStripProps) {
  const root = useRef<HTMLDivElement>(null);
  const refocus = useRef<number | undefined>(undefined);
  const dragFrom = useRef<number | undefined>(undefined);
  const [cols, setCols] = useState(p.layout === 'grid' ? 8 : 1);
  const n = p.thumbs.length;

  // columns of the wrapped sheet: how many children share the first row
  useLayoutEffect(() => {
    if (p.layout !== 'grid') return;
    const measure = (): void => {
      const cells = [...(root.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
      if (!cells.length) return;
      const top = cells[0].offsetTop;
      const k = cells.findIndex((c) => c.offsetTop !== top);
      const c = k < 0 ? cells.length : k;
      setCols(c);
      p.onColumns?.(c);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [p.layout, n]);

  useEffect(() => {
    if (refocus.current !== undefined) {
      root.current?.querySelector<HTMLElement>(`[data-i="${refocus.current}"]`)?.focus();
      refocus.current = undefined;
    }
  });

  const go = (to: number): void => {
    const t = Math.max(0, Math.min(n - 1, to));
    refocus.current = t;
    p.onSelect(t);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!n) return;
    const i = p.selected;
    const grid = p.layout === 'grid';
    const step: Record<string, number> = grid ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols } : p.horizontal ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 } : { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 };
    if (step[e.key] !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      if (e.altKey) {
        const to = i + step[e.key];
        if (to >= 0 && to < n) {
          refocus.current = to;
          p.onMove(i, to);
          p.onSelect(to);
        }
      } else go(i + step[e.key]);
    } else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); go(i + (grid ? cols * 3 : 5)); }
    else if (e.key === 'PageUp') { e.preventDefault(); go(i - (grid ? cols * 3 : 5)); }
    else if (e.key === 'Delete' && p.canDelete) { e.preventDefault(); e.stopPropagation(); p.onDelete(i); }
    else if (e.key === 'Insert' && p.canAdd) { e.preventDefault(); p.onAdd(); }
    else if (e.key === 'Enter') { e.preventDefault(); p.onEnter(); }
  };
  const cap = p.noun === 'tile' ? 'Tile' : 'Frame';
  return (
    <div class={`sp-strip sp-strip-${p.layout}${p.horizontal ? ' sp-strip-h' : ''}`}>
      <div
        class="sp-strip-list"
        role="listbox"
        aria-label={`${cap}s`}
        aria-orientation={p.horizontal ? 'horizontal' : 'vertical'}
        ref={root}
        onKeyDown={onKeyDown as never}
      >
        {p.thumbs.map((t, i) => (
          <div
            key={i}
            role="option"
            aria-selected={i === p.selected}
            aria-label={`${cap} ${i}${p.duplicates?.has(i) ? ', duplicate of an earlier tile' : ''}`}
            data-i={i}
            tabIndex={i === p.selected ? 0 : -1}
            class={`sp-strip-item${i === p.selected ? ' sp-strip-sel' : ''}`}
            draggable
            onClick={() => p.onSelect(i)}
            onDragStart={(e) => { dragFrom.current = i; e.dataTransfer?.setData('text/plain', String(i)); }}
            onDragOver={(e) => { if (dragFrom.current !== undefined) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const from = dragFrom.current;
              dragFrom.current = undefined;
              if (from !== undefined && from !== i) { p.onMove(from, i); p.onSelect(i); }
            }}
          >
            <Thumb rgba={t} w={p.w} h={p.h} box={p.layout === 'grid' ? 40 : 56} />
            {(p.layout === 'strip' || p.numbers) && <span class="sp-strip-n">{i}</span>}
            {p.duplicates?.has(i) && <span class="sp-strip-dup" title={`Tile ${i} duplicates an earlier tile`}><Icon name="info" /></span>}
          </div>
        ))}
      </div>
      <div class="sp-strip-actions" role="group" aria-label={`${cap} actions`}>
        <button type="button" class="cb-icon-btn" title={p.canAdd ? `Add ${p.noun} (N)` : `Add ${p.noun} (${p.addWhy ?? 'not possible'})`} aria-label={`Add ${p.noun}`} aria-disabled={p.canAdd ? undefined : 'true'} onClick={() => p.canAdd && p.onAdd()}><Icon name="add" /></button>
        <button type="button" class="cb-icon-btn" title={p.canAdd ? `Duplicate ${p.noun} (Shift+N)` : `Duplicate ${p.noun} (${p.addWhy ?? 'not possible'})`} aria-label={`Duplicate ${p.noun}`} aria-disabled={p.canAdd && n ? undefined : 'true'} onClick={() => p.canAdd && n && p.onDuplicate(p.selected)}><Icon name="copy" /></button>
        <button type="button" class="cb-icon-btn" title={p.canDelete ? `Delete ${p.noun} (Delete)` : `Delete ${p.noun} (a sprite keeps at least one frame)`} aria-label={`Delete ${p.noun}`} aria-disabled={p.canDelete ? undefined : 'true'} onClick={() => p.canDelete && p.onDelete(p.selected)}><Icon name="trash" /></button>
      </div>
    </div>
  );
}
