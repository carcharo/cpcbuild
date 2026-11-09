/** <cb-chip>: a toggle button in the pill look; aria-pressed, with a check glyph when on (never colour alone). */
import { tipText } from '../tooltip';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

export function ToggleChip({ label, pressed, onChange, icon, shortcut }: { label: string; pressed: boolean; onChange(v: boolean): void; icon?: string; shortcut?: string }) {
  const tt = useTooltip();
  const tp = tt.props('chip', tipText({ label, shortcut }));
  return (
    <>
      <button type="button" class="cb-pill cb-chip" aria-pressed={pressed} {...tp} onClick={() => { tp.onClick(); onChange(!pressed); }}>
        {pressed ? <Icon name="check" /> : icon ? <Icon name={icon} /> : null}
        <span>{label}</span>
      </button>
      {tt.node}
    </>
  );
}
