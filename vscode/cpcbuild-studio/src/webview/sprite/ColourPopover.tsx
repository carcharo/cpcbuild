/** The colour chooser popover (UX 2.2): firmware colours for a CPC pen, three hex digits for a Plus colour. Esc closes. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { FW_NAMES, fwRgb } from '../../core/palette';
import { Swatch } from '../shared/components/Swatch';

const css = (c: readonly [number, number, number]): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const hexRgb = (h: string): string => css([parseInt(h[0], 16) * 17, parseInt(h[1], 16) * 17, parseInt(h[2], 16) * 17]);

export function ColourPopover(p: { kind: 'cpc' | 'plus'; title: string; current: string; onPick(value: string): void; onClose(): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [rgb, setRgb] = useState(p.current.length === 3 ? p.current : '000');
  useEffect(() => {
    root.current?.querySelector<HTMLElement>('button, select')?.focus();
  }, []);
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); p.onClose(); }
  };
  if (p.kind === 'plus') {
    const set = (i: number, d: string): void => setRgb(rgb.slice(0, i) + d + rgb.slice(i + 1));
    return (
      <div class="sp-pop" role="dialog" aria-label={p.title} ref={root} onKeyDown={key as never}>
        <div class="sp-pop-row">
          {['Red', 'Green', 'Blue'].map((n, i) => (
            <label key={n}>{n}
              <select class="cb-select" value={rgb[i]} onChange={(e) => set(i, (e.target as HTMLSelectElement).value)}>
                {'0123456789ABCDEF'.split('').map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          ))}
          <Swatch colour={hexRgb(rgb)} size={28} title={`#${rgb}`} />
        </div>
        <div class="sp-pop-row">
          <button type="button" class="cb-btn" onClick={() => p.onPick(rgb)}>Set colour {rgb}</button>
          <button type="button" class="cb-btn cb-btn-secondary" onClick={p.onClose}>Cancel</button>
        </div>
      </div>
    );
  }
  return (
    <div class="sp-pop" role="dialog" aria-label={p.title} ref={root} onKeyDown={key as never}>
      <div class="sp-pop-grid" role="listbox" aria-label="Firmware colours">
        {Array.from({ length: 27 }, (_, n) => (
          <button key={n} type="button" role="option" aria-selected={String(n) === p.current} aria-label={`Colour ${n}, ${FW_NAMES[n].toLowerCase()}`} title={`${n} ${FW_NAMES[n].toLowerCase()}`} class="sp-pop-cell" onClick={() => p.onPick(String(n))}>
            <Swatch colour={css(fwRgb(n))} size={22} />
            <span>{n}</span>
          </button>
        ))}
      </div>
      <div class="sp-pop-row"><button type="button" class="cb-btn cb-btn-secondary" onClick={p.onClose}>Cancel</button></div>
    </div>
  );
}
