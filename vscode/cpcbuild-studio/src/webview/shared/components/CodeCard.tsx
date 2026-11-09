/** <cb-codecard>: a card holding code with a Copy pill at the top right. Same copy and "Copied" announcement as Copyable. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Card } from './Card';
import { Pill } from './Pill';

export function CodeCard({ title, value, copy, multiline }: { title: string; value: string; copy: (text: string) => Promise<unknown>; multiline?: boolean }) {
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
  const action = <Pill size="sm" label={`Copy ${title}`} icon={done ? 'check' : 'copy'} text={done ? 'Copied' : 'Copy'} aria={{ 'aria-label': `Copy ${title}` }} onClick={() => void doCopy()} />;
  return (
    <div class={`cb-codecard${multiline ? ' cb-copy-multi' : ''}`}>
      <Card title={title} actions={action}>
        {multiline ? <pre class="cb-code" tabIndex={0} role="region" aria-label={title}>{value}</pre> : <code class="cb-code">{value}</code>}
        <span class="cb-visually-hidden" role="status">{done ? 'Copied' : ''}</span>
      </Card>
    </div>
  );
}
