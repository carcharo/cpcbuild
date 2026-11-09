/** <cb-segpill>: a pill-shaped radiogroup (same semantics as Segmented): roving tabindex, arrows move and select, Home/End, disabled options skipped. */
import { useRef, useState } from 'preact/hooks';
import { tipText } from '../tooltip';
import { useTooltip } from './Tooltip';
import { rovingNext } from '../roving';

export interface SegOption<T> {
  value: T;
  label: string;
  title?: string;
  disabled?: boolean;
}

export function SegPill<T extends string | number>({ label, value, options, onChange, size }: { label: string; value: T; options: SegOption<T>[]; onChange(v: T): void; size?: 'md' | 'sm' }) {
  const root = useRef<HTMLDivElement>(null);
  const tt = useTooltip();
  const [focused, setFocused] = useState<number | undefined>();
  const cur = options.findIndex((o) => o.value === value);
  const firstOn = options.findIndex((o) => !o.disabled);
  // the tab stop follows focus, then the checked option, then the first enabled one
  const tabbable = focused !== undefined && options[focused] && !options[focused].disabled ? focused : cur >= 0 && !options[cur].disabled ? cur : firstOn;
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    const n = rovingNext(options.length, i, e.key, { disabled: (k) => !!options[k].disabled });
    if (n === undefined) return;
    e.preventDefault();
    onChange(options[n].value);
    root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <div class={`cb-segpill${size === 'sm' ? ' cb-segpill-sm' : ''}`} role="radiogroup" aria-label={label} ref={root}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-disabled={o.disabled ? 'true' : undefined}
          tabIndex={i === tabbable ? 0 : -1}
          {...(o.title ? tt.props(String(o.value), tipText({ label: o.title })) : {})}
          onFocus={() => setFocused(i)}
          onClick={() => !o.disabled && onChange(o.value)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {o.label}
        </button>
      ))}
      {tt.node}
    </div>
  );
}
