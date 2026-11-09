/** <cb-pod>: the transport pod. A toolbar of round buttons (one tab stop, roving tabindex; arrows, Home/End) and, after a separator, readouts. */
import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { rovingNext } from '../roving';
import { tipText } from '../tooltip';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export interface PodButton {
  id: string;
  label: string;
  icon: string;
  main?: boolean;
  disabled?: boolean;
  why?: string;
  shortcut?: string;
  pressed?: boolean;
  onActivate(): void;
}

export function TransportPod({ label, buttons, children }: { label: string; buttons: PodButton[]; children?: ComponentChildren }) {
  const [active, setActive] = useState(buttons.find((b) => b.main)?.id ?? buttons[0]?.id ?? '');
  const act = buttons.some((b) => b.id === active) ? active : (buttons[0]?.id ?? '');
  const root = useRef<HTMLDivElement>(null);
  const tt = useTooltip();
  const onKeyDown = (e: KeyboardEvent): void => {
    const cur = buttons.findIndex((b) => b.id === (e.target as HTMLElement).closest<HTMLElement>('[data-pod]')?.dataset.pod);
    if (cur < 0) return;
    const n = rovingNext(buttons.length, cur, e.key, { axis: 'horizontal' });
    if (n === undefined) return;
    e.preventDefault();
    setActive(buttons[n].id);
    root.current?.querySelectorAll<HTMLElement>('[data-pod]')[n]?.focus();
  };
  return (
    <div class="cb-pod" role="toolbar" aria-label={label} aria-orientation="horizontal" ref={root} onKeyDown={onKeyDown as never}>
      {buttons.map((b) => {
        const tip = tipText(b);
        const tp = tt.props(b.id, tip);
        return (
          <button
            key={b.id}
            type="button"
            class={b.main ? 'cb-pod-main' : 'cb-pod-btn'}
            data-pod={b.id}
            tabIndex={b.id === act ? 0 : -1}
            aria-label={tip}
            aria-pressed={b.pressed === undefined ? undefined : b.pressed}
            aria-disabled={b.disabled ? 'true' : undefined}
            {...tp}
            onFocus={() => setActive(b.id)}
            onClick={() => { tp.onClick(); if (!b.disabled) b.onActivate(); }}
          >
            <Icon name={b.icon} />
          </button>
        );
      })}
      {children && <span class="cb-pod-sep" aria-hidden="true" />}
      {children}
      {tt.node}
    </div>
  );
}
