/** <cb-pill>: the rounded button of the redesign (secondary, primary or ghost; three sizes). Icon-only pills are named by aria-label. */
import { tipText } from '../tooltip';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export interface PillProps {
  /** Accessible name and tooltip base. Shown as the text when there is no icon and no `text`. */
  label: string;
  icon?: string;
  /** Visible text next to the icon. */
  text?: string;
  variant?: 'secondary' | 'primary' | 'ghost';
  size?: 'md' | 'sm' | 'xs';
  mono?: boolean;
  disabled?: boolean;
  /** Why it is disabled; shown in the tooltip. */
  why?: string;
  shortcut?: string;
  onClick(): void;
  /** Extra aria attributes (aria-haspopup, aria-expanded ...). */
  aria?: Record<string, string | boolean | undefined>;
}

export function Pill(p: PillProps) {
  const tt = useTooltip();
  const tip = tipText(p);
  const visible = p.text ?? (p.icon ? undefined : p.label);
  const cls = ['cb-pill', p.variant === 'primary' && 'cb-pill-primary', p.variant === 'ghost' && 'cb-pill-ghost', p.size === 'sm' && 'cb-pill-sm', p.size === 'xs' && 'cb-pill-xs', p.mono && 'cb-pill-mono', !visible && 'cb-pill-icon'].filter(Boolean).join(' ');
  const tp = tt.props('pill', tip);
  return (
    <>
      <button
        type="button"
        class={cls}
        aria-label={visible ? undefined : tip}
        aria-disabled={p.disabled ? 'true' : undefined}
        {...(p.aria as Record<string, never> | undefined)}
        {...tp}
        onClick={(e) => {
          tp.onClick();
          if (!p.disabled) p.onClick();
          else e.preventDefault();
        }}
      >
        {p.icon && <Icon name={p.icon} />}
        {visible && <span>{visible}</span>}
      </button>
      {tt.node}
    </>
  );
}
