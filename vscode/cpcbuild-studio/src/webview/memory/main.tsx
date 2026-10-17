/** The memory view webview (S9): hex + ASCII window, go-to, paging, debug buttons. Read-only; the host does the reading. */
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { formatRows, fromBase64, BYTES_PER_ROW } from '../../core/memdiff';
import type { MemControl, MemEmpty, MemHostMsg, MemSnapshot, MemStatus, MemWebMsg } from '../../shared/memoryProtocol';
import { EmptyState, Notice } from '../shared/components/Notice';
import { StatusLine } from '../shared/components/StatusLine';
import { Toolbar, ToolbarGroup } from '../shared/components/Toolbar';
import './memory.css';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vs = acquireVsCodeApi();
const send = (m: MemWebMsg): void => vs.postMessage(m);

const hex4 = (n: number): string => '&' + n.toString(16).toUpperCase().padStart(4, '0');

interface Model {
  snap?: MemSnapshot;
  status: MemStatus;
  empty?: MemEmpty;
  notice?: { severity: 'info' | 'warning' | 'error'; text: string };
}

function App() {
  const [m, setM] = useState<Model>({ status: { live: false, paused: false, text: 'Waiting for the host...' } });
  const [goto, setGoto] = useState('');
  const gotoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const on = (e: MessageEvent): void => {
      const msg = e.data as MemHostMsg;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'snapshot') {
        setM((o) => ({ ...o, snap: msg.snap, status: msg.status, empty: undefined, notice: undefined }));
        setGoto((g) => (document.activeElement === gotoRef.current ? g : msg.snap.target));
      } else if (msg.type === 'status') setM((o) => ({ ...o, status: msg.status }));
      else if (msg.type === 'empty') setM((o) => ({ ...o, status: msg.status, empty: o.snap ? undefined : msg.empty }));
      else if (msg.type === 'notice') setM((o) => ({ ...o, notice: { severity: msg.severity, text: msg.text } }));
    };
    window.addEventListener('message', on);
    window.addEventListener('error', (e) => send({ type: 'error', message: e.message }));
    send({ type: 'ready' });
    return () => window.removeEventListener('message', on);
  }, []);

  const bytes = useMemo(() => (m.snap ? fromBase64(m.snap.bytes) : new Uint8Array(0)), [m.snap]);
  const rows = useMemo(() => (m.snap ? formatRows(m.snap.base, bytes, m.snap.changed) : []), [m.snap, bytes]);
  const { live, paused, stale } = m.status;
  const ctl = (id: string, label: string, icon: string, cmd: MemControl, disabled: boolean, why: string) => ({
    kind: 'button' as const, id, label, icon, disabled, why, onActivate: () => send({ type: 'control', cmd }),
  });
  const groups: ToolbarGroup[] = [
    {
      label: 'Run control',
      items: [
        ctl('pause', 'Pause', 'debug-pause', 'pause', !live || paused, live ? 'already paused' : 'no session'),
        ctl('resume', 'Resume', 'debug-continue', 'resume', !live || !paused, live ? 'already running' : 'no session'),
        ctl('step', 'Step (one instruction)', 'debug-step-into', 'step', !live || !paused, 'pause first'),
        ctl('stepOver', 'Step over', 'debug-step-over', 'stepOver', !live || !paused, 'pause first'),
        ctl('stepOut', 'Step out', 'debug-step-out', 'stepOut', !live || !paused, 'pause first'),
      ],
    },
    {
      label: 'Window',
      items: [
        { kind: 'button', id: 'prev', label: 'Previous page', icon: 'chevron-up', onActivate: () => send({ type: 'page', pages: -1 }) },
        { kind: 'button', id: 'next', label: 'Next page', icon: 'chevron-down', onActivate: () => send({ type: 'page', pages: 1 }) },
        { kind: 'button', id: 'refresh', label: 'Refresh', icon: 'refresh', onActivate: () => send({ type: 'refresh' }) },
      ],
    },
  ];
  const go = (e: Event): void => {
    e.preventDefault();
    send({ type: 'goto', text: goto });
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'PageDown') { e.preventDefault(); send({ type: 'page', pages: 1 }); }
    else if (e.key === 'PageUp') { e.preventDefault(); send({ type: 'page', pages: -1 }); }
    else if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); gotoRef.current?.focus(); gotoRef.current?.select(); }
  };

  return (
    <div class="mem">
      <Toolbar label="Memory view" groups={groups} />
      <form class="mem-go" onSubmit={go}>
        <label for="mem-goto">Go to</label>
        <input id="mem-goto" ref={gotoRef} class="mem-input" type="text" value={goto} placeholder="&4F2A or a symbol" spellcheck={false} onInput={(e) => setGoto((e.target as HTMLInputElement).value)} />
        <button type="submit" class="cb-btn">Go</button>
        {m.snap?.following && <span class="cb-muted" title="The window moves with this symbol after a rebuild">following {m.snap.following}</span>}
      </form>
      {m.notice && <Notice severity={m.notice.severity} onDismiss={() => setM((o) => ({ ...o, notice: undefined }))}>{m.notice.text}</Notice>}
      {m.empty ? (
        <EmptyState icon="chip" title={m.empty.title} text={m.empty.text} action={m.empty.action && { label: m.empty.action.label, onClick: () => send({ type: 'command', command: m.empty!.action!.command }) }} />
      ) : (
        <div class={`mem-dump${stale ? ' mem-stale' : ''}`} role="grid" aria-label="Memory" tabIndex={0} onKeyDown={onKey as never}>
          {rows.map((r, i) => (
            <div class="mem-row" role="row" key={r.start}>
              <span class="mem-addr" role="rowheader">{r.addr}</span>
              <span class="mem-bytes">
                {r.hex.map((h, j) => {
                  const a = r.start + j;
                  const cls = ['mem-b', r.changed.includes(j) ? 'mem-changed' : '', m.snap?.pc === a ? 'mem-pc' : '', m.snap?.sp === a ? 'mem-sp' : ''].filter(Boolean).join(' ');
                  return (
                    <span key={j} role="gridcell" class={cls} title={`${hex4(a)} = ${parseInt(h, 16)}${r.changed.includes(j) ? ' (changed)' : ''}${m.snap?.pc === a ? ' (PC)' : ''}${m.snap?.sp === a ? ' (SP)' : ''}`}>{h}</span>
                  );
                })}
              </span>
              <span class="mem-ascii" aria-hidden="true">{r.ascii}</span>
              <span class="mem-sym cb-muted">{m.snap?.rowNames[i] ?? ''}</span>
            </div>
          ))}
        </div>
      )}
      <StatusLine
        fields={[
          { id: 'state', value: m.status.text },
          m.snap && { id: 'range', label: 'Window', value: `${hex4(m.snap.base)}-${hex4(Math.min(0xffff, m.snap.base + bytes.length - 1))}`, title: `${BYTES_PER_ROW} bytes a row; what the Z80 sees now` },
        ]}
        hint="Read-only. Changed bytes are marked until the next refresh."
      />
    </div>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
