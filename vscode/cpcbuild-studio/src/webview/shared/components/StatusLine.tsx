/** <cb-status>: one row at the bottom of an editor; fields in a fixed order, empty fields omitted. */
import type { ComponentChildren } from 'preact';

export interface StatusField {
  id: string;
  label?: string;
  value: ComponentChildren;
  title?: string;
}

export function StatusLine({ fields, hint }: { fields: (StatusField | undefined | false)[]; hint?: string }) {
  const shown = fields.filter((f): f is StatusField => !!f && f.value !== undefined && f.value !== '');
  return (
    <div class="cb-status" role="status">
      <div class="cb-status-fields">
        {shown.map((f) => (
          <span key={f.id} class="cb-status-field" title={f.title}>
            {f.label && <span class="cb-status-label">{f.label} </span>}
            <span class="cb-status-value">{f.value}</span>
          </span>
        ))}
      </div>
      {hint && <div class="cb-status-hint">{hint}</div>}
    </div>
  );
}
