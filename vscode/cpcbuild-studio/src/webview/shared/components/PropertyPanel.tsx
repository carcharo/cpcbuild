/** <cb-props>: the property column and its controls (UX 2.5). A property edit is one undo step, committed on blur or Enter. */
import type { ComponentChildren } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import { Icon } from './Icon';

export function PropertyPanel({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <aside class="cb-props" aria-label={label}>
      {children}
    </aside>
  );
}

/** A collapsible section: heading button with aria-expanded. */
export function Section({ title, open, onToggle, children }: { title: string; open?: boolean; onToggle?: (open: boolean) => void; children: ComponentChildren }) {
  const [own, setOwn] = useState(open ?? true);
  const isOpen = open ?? own;
  const id = useId();
  return (
    <section class="cb-section">
      <h2 class="cb-section-h">
        <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => (onToggle ? onToggle(!isOpen) : setOwn(!isOpen))}>
          <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} />
          {title}
        </button>
      </h2>
      <div id={id} class="cb-section-body" hidden={!isOpen}>
        {children}
      </div>
    </section>
  );
}

/** Label above the control, optional description and inline error. Give the control `id` and, if described, the ids below. */
export function Field({ id, label, description, error, children }: { id: string; label: string; description?: string; error?: string; children: ComponentChildren }) {
  return (
    <div class="cb-field">
      <label for={id}>{label}</label>
      {children}
      {description && <div id={`${id}-desc`} class="cb-muted">{description}</div>}
      {error && (
        <div id={`${id}-err`} class="cb-field-error" role="alert">
          <Icon name="error" /> {error}
        </div>
      )}
    </div>
  );
}

export interface NumberFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  /** Up / Down step; Shift multiplies by `bigStep` (default 8), PageUp / PageDown by `pageStep`. */
  step?: number;
  bigStep?: number;
  pageStep?: number;
  description?: string;
  /** Extra validation: return a message to refuse the value. */
  validate?(n: number): string | undefined;
  onCommit(n: number): void;
}

/** Number input: invalid values are held in the field with a message and never applied; Esc reverts. */
export function NumberField(p: NumberFieldProps) {
  const [text, setText] = useState(String(p.value));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    setText(String(p.value));
    setError(undefined);
  }, [p.value]);
  const commit = (t: string): void => {
    const n = Number(t);
    let msg: string | undefined;
    if (t.trim() === '' || !Number.isInteger(n)) msg = 'Enter a whole number';
    else if (n < p.min || n > p.max) msg = `Enter a value from ${p.min} to ${p.max}`;
    else msg = p.validate?.(n);
    setError(msg);
    if (!msg && n !== p.value) p.onCommit(n);
  };
  const bump = (d: number): void => {
    const n = Math.max(p.min, Math.min(p.max, (Number.isInteger(Number(text)) ? Number(text) : p.value) + d));
    setText(String(n));
    commit(String(n));
  };
  return (
    <Field id={p.id} label={p.label} description={p.description} error={error}>
      <input
        id={p.id}
        class="cb-input cb-number"
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[p.description ? `${p.id}-desc` : '', error ? `${p.id}-err` : ''].filter(Boolean).join(' ') || undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          const step = p.step ?? 1;
          if (e.key === 'Enter') commit(text);
          else if (e.key === 'Escape') { setText(String(p.value)); setError(undefined); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? step * (p.bigStep ?? 8) : step); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-(e.shiftKey ? step * (p.bigStep ?? 8) : step)); }
          else if (e.key === 'PageUp') { e.preventDefault(); bump(p.pageStep ?? 4); }
          else if (e.key === 'PageDown') { e.preventDefault(); bump(-(p.pageStep ?? 4)); }
        }}
      />
    </Field>
  );
}

export function SelectField<T extends string | number>({ id, label, value, options, onChange, description }: { id: string; label: string; value: T; options: { value: T; label: string }[]; onChange(v: T): void; description?: string }) {
  return (
    <Field id={id} label={label} description={description}>
      <select
        id={id}
        class="cb-select"
        value={String(value)}
        aria-describedby={description ? `${id}-desc` : undefined}
        onChange={(e) => {
          const raw = (e.target as HTMLSelectElement).value;
          const o = options.find((x) => String(x.value) === raw);
          if (o) onChange(o.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
        ))}
      </select>
    </Field>
  );
}

export function CheckField({ id, label, checked, onChange, description }: { id: string; label: string; checked: boolean; onChange(v: boolean): void; description?: string }) {
  return (
    <div class="cb-field cb-check">
      <input id={id} type="checkbox" checked={checked} aria-describedby={description ? `${id}-desc` : undefined} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <label for={id}>{label}</label>
      {description && <div id={`${id}-desc`} class="cb-muted">{description}</div>}
    </div>
  );
}

/** 2-5 options, radiogroup; the selected one has a fill and a bottom border. Arrow keys move and select. */
export function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange(v: T): void }) {
  const move = (i: number): void => {
    const o = options[(i + options.length) % options.length];
    onChange(o.value);
    queueMicrotask(() => document.querySelector<HTMLElement>(`[data-seg="${CSS.escape(label)}"][data-val="${CSS.escape(String(o.value))}"]`)?.focus());
  };
  return (
    <div class="cb-seg" role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          data-seg={label}
          data-val={String(o.value)}
          title={o.title}
          class={o.value === value ? 'cb-seg-on' : ''}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(i + 1); }
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(i - 1); }
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
