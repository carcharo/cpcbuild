/** <cb-copy>: monospace text with a copy button. Copies through the host clipboard and announces it. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export function Copyable({ value, label, multiline, copy }: { value: string; label: string; multiline?: boolean; copy: (text: string) => Promise<unknown> }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const doCopy = async (): Promise<void> => {
    try {
      await copy(value);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 1200);
    } catch {
      setDone(false);
    }
  };
  return (
    <div class={`cb-copy${multiline ? ' cb-copy-multi' : ''}`}>
      {multiline ? <pre class="cb-code" tabIndex={0} aria-label={label}>{value}</pre> : <code class="cb-code">{value}</code>}
      <button type="button" class="cb-icon-btn" title={`Copy ${label}`} aria-label={`Copy ${label}`} onClick={() => void doCopy()}>
        <Icon name={done ? 'check' : 'copy'} />
      </button>
      <span class="cb-visually-hidden" role="status">{done ? 'Copied' : ''}</span>
    </div>
  );
}
