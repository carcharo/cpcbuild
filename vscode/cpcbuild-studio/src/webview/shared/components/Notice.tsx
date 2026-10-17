/** Notices, empty states and error states (UX 2.6). */
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';

export interface NoticeAction {
  label: string;
  onClick(): void;
  secondary?: boolean;
}

const ICON = { info: 'info', warning: 'warning', error: 'error' } as const;

export function Notice({ severity, children, actions, onDismiss }: { severity: 'info' | 'warning' | 'error'; children: ComponentChildren; actions?: NoticeAction[]; onDismiss?: () => void }) {
  return (
    <div class={`cb-notice cb-notice-${severity}`} role={severity === 'info' ? 'status' : 'alert'}>
      <Icon name={ICON[severity]} />
      <div class="cb-notice-text">{children}</div>
      <div class="cb-notice-actions">
        {actions?.map((a) => (
          <button key={a.label} type="button" class={a.secondary ? 'cb-btn cb-btn-secondary' : 'cb-btn'} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
        {onDismiss && (
          <button type="button" class="cb-icon-btn" aria-label="Dismiss" title="Dismiss" onClick={onDismiss}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: NoticeAction }) {
  return (
    <div class="cb-empty">
      <span class={`codicon codicon-${icon} cb-empty-icon`} aria-hidden="true" />
      <p class="cb-empty-title">{title}</p>
      {text && <p class="cb-muted">{text}</p>}
      {action && (
        <button type="button" class="cb-btn" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}

/** Replaces the editor content (document will not parse, host connection lost). */
export function ErrorState({ title, message, actions }: { title: string; message: string; actions: NoticeAction[] }) {
  return (
    <div class="cb-empty cb-error-state" role="alert">
      <span class="codicon codicon-error cb-empty-icon cb-error-icon" aria-hidden="true" />
      <p class="cb-empty-title">{title}</p>
      <p class="cb-error-message">{message}</p>
      <div class="cb-row">
        {actions.map((a) => (
          <button key={a.label} type="button" class={a.secondary ? 'cb-btn cb-btn-secondary' : 'cb-btn'} onClick={a.onClick}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
