/** <cb-stat>: a read-only readout pill; ok / warn / bad print a glyph as well as colour, and a hidden prefix announces the state. */
import type { ComponentChildren } from 'preact';
import { Icon } from './Icon';
import { useTooltip } from './Tooltip';

const GLYPH = { ok: 'pass', warn: 'warning', bad: 'error' } as const;
const SPOKEN = { ok: 'OK: ', warn: 'Warning: ', bad: 'Error: ' } as const;

export function StatPill({ state = 'neutral', children, title }: { state?: 'ok' | 'warn' | 'bad' | 'neutral'; children: ComponentChildren; title?: string }) {
  const tt = useTooltip();
  return (
    <>
      <span class={`cb-stat cb-stat-${state}`} {...(title ? tt.props('stat', title) : {})}>
        {state !== 'neutral' && <Icon name={GLYPH[state]} />}
        {state !== 'neutral' && <span class="cb-visually-hidden">{SPOKEN[state]}</span>}
        <span>{children}</span>
      </span>
      {tt.node}
    </>
  );
}
