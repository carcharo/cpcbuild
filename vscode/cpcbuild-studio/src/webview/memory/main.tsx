/**
 * The memory view webview (S9, R6): hex + ASCII window with go-to, recent addresses and paging, the run pod, and the CPU
 * panel (registers, flags, alternate set, stack). Read-only; the host does the reading and the arithmetic
 * (src/core/debugModel.ts); this draws what it is sent.
 */
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { CpuReg } from '../../core/debugModel';
import { formatRows, fromBase64, BYTES_PER_ROW } from '../../core/memdiff';
import type { MemControl, MemCpu, MemEmpty, MemHostMsg, MemSnapshot, MemStatus, MemWebMsg } from '../../shared/memoryProtocol';
import { Card } from '../shared/components/Card';
import { Icon } from '../shared/components/Icon';
import { EmptyState, Notice } from '../shared/components/Notice';
import { Pill } from '../shared/components/Pill';
import { StatPill } from '../shared/components/StatPill';
import { StatusLine } from '../shared/components/StatusLine';
import { TransportPod, type PodButton } from '../shared/components/TransportPod';
import './memory.css';

declare function acquireVsCodeApi(): { postMessage(m: unknown): void };
const vs = acquireVsCodeApi();
const send = (m: MemWebMsg): void => vs.postMessage(m);

const hex4 = (n: number): string => '&' + n.toString(16).toUpperCase().padStart(4, '0');
const GROUPS = [0, 4, 8, 12] as const;
const narrow = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 720px)').matches;

interface Model {
  snap?: MemSnapshot;
  status: MemStatus;
  empty?: MemEmpty;
  notice?: { severity: 'info' | 'warning' | 'error'; text: string };
}

function App() {
  const [m, setM] = useState<Model>({ status: { live: false, paused: false, text: 'Waiting for the host...' } });
  const [goto, setGoto] = useState('');
  // the CPU cards start collapsed in the narrow layout (they sit under the hex panel there); the fold keeps its state across snapshots
  // open above 720px, collapsed below; once the user toggles a card, that choice stands for the life of the view
  const [isNarrow, setIsNarrow] = useState(narrow);
  const [regsUser, setRegsUser] = useState<boolean | undefined>();
  const [stackUser, setStackUser] = useState<boolean | undefined>();
  const regsOpen = regsUser ?? !isNarrow;
  const stackOpen = stackUser ?? !isNarrow;
  const setRegsOpen = setRegsUser;
  const setStackOpen = setStackUser;
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 720px)');
    const on = (): void => setIsNarrow(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [altOpen, setAltOpen] = useState(false);
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
  const running = live && !paused;
  const cpu = m.snap?.cpu;

  const ctl = (id: string, label: string, icon: string, cmd: MemControl, disabled: boolean, why: string, main?: boolean): PodButton => ({
    id, label, icon, main, disabled, why, onActivate: () => send({ type: 'control', cmd }),
  });
  const noStep = !live || !paused;
  const stepWhy = live ? 'pause first' : 'no session';
  const pod: PodButton[] = [
    paused || !live ? ctl('run', 'Resume', 'debug-continue', 'resume', !live, 'no session', true) : ctl('run', 'Pause', 'debug-pause', 'pause', false, '', true),
    ctl('step', 'Step (one instruction)', 'debug-step-into', 'step', noStep, stepWhy),
    ctl('stepOver', 'Step over', 'debug-step-over', 'stepOver', noStep, stepWhy),
    ctl('stepOut', 'Step out', 'debug-step-out', 'stepOut', noStep, stepWhy),
  ];

  const go = (e?: Event): void => {
    e?.preventDefault();
    send({ type: 'goto', text: goto });
  };
  const gotoText = (text: string): void => send({ type: 'goto', text });
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'PageDown') { e.preventDefault(); send({ type: 'page', pages: 1 }); }
    else if (e.key === 'PageUp') { e.preventDefault(); send({ type: 'page', pages: -1 }); }
    else if ((e.key === 'g' || e.key === 'G') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); gotoRef.current?.focus(); gotoRef.current?.select(); }
  };

  const pcMain = cpu?.model.main.find((r) => r.name === 'PC');
  const podState: { state: 'ok' | 'warn' | 'neutral'; text: string } = !live ? { state: 'neutral', text: stale ? 'Session ended' : 'No session' } : paused ? { state: 'warn', text: 'Paused' } : { state: 'ok', text: 'Running' };
  const showPc = !running && m.snap?.pc !== undefined;
  // the status line is a live region: it says Paused / Running, never the address, so a step does not make it speak
  const stateLine = live ? (paused ? 'Paused' : 'Running') : m.status.text;
  const cpuNote = running ? 'Running: values from the last pause' : stale ? 'Session ended: the last values' : undefined;

  return (
    <div class="mem">
      <div class="mem-go">
        <form class="mem-goform" onSubmit={go}>
          <label for="mem-goto" class="cb-label">Go to</label>
          <input id="mem-goto" ref={gotoRef} class="mem-input" type="text" value={goto} placeholder="&4F2A or a symbol" title="Go to an address or a symbol (press g to jump here)" spellcheck={false} onInput={(e) => setGoto((e.target as HTMLInputElement).value)} />
          <Pill label="Go" text="Go" size="sm" onClick={() => go()} />
        </form>
        {m.snap?.following && <StatPill state="ok" title="The window moves with this symbol after a rebuild">following {m.snap.following}</StatPill>}
        {m.snap && m.snap.recent.length > 0 && (
          <div class="mem-recent" role="group" aria-label="Recent addresses">
            {m.snap.recent.map((r) => (
              <Pill key={r.addr} size="xs" mono variant="ghost" label={`Go to ${r.text}`} text={r.text} onClick={() => gotoText(r.text)} />
            ))}
          </div>
        )}
        <span class="mem-spacer" />
        <div class="mem-pager" role="group" aria-label="Window">
          <Pill label="Previous page" shortcut="Page Up" icon="chevron-up" size="sm" variant="ghost" onClick={() => send({ type: 'page', pages: -1 })} />
          <Pill label="Next page" shortcut="Page Down" icon="chevron-down" size="sm" variant="ghost" onClick={() => send({ type: 'page', pages: 1 })} />
          <Pill label="Refresh" icon="refresh" size="sm" variant="ghost" onClick={() => send({ type: 'refresh' })} />
        </div>
      </div>
      {m.notice && <Notice severity={m.notice.severity} onDismiss={() => setM((o) => ({ ...o, notice: undefined }))}>{m.notice.text}</Notice>}
      {m.empty ? (
        <EmptyState icon="chip" title={m.empty.title} text={m.empty.text} action={m.empty.action && { label: m.empty.action.label, onClick: () => send({ type: 'command', command: m.empty!.action!.command }) }} />
      ) : (
        <div class="mem-body">
          <div class="mem-main">
            <div class={`mem-panel${stale ? ' mem-stale' : ''}`}>
              <div class="mem-dump" role="table" aria-label="Memory" tabIndex={0} onKeyDown={onKey as never}>
                <div class="mem-head" aria-hidden="true">
                  <span class="mem-addr">Address</span>
                  <span class="mem-bytes">
                    {GROUPS.map((g) => <span key={g} class="mem-grp mem-grp-h">+{g.toString(16).toUpperCase()}</span>)}
                  </span>
                  <span class="mem-ascii">Text</span>
                </div>
                {rows.map((r, i) => {
                  const pc = m.snap?.pc;
                  const isPc = !running && pc !== undefined && pc >= r.start && pc < r.start + BYTES_PER_ROW;
                  const names = m.snap?.rowNames[i];
                  return (
                    <div class={`mem-row${isPc ? ' mem-row-pc' : ''}`} role="row" key={r.start}>
                      <span class="mem-addr" role="rowheader">
                        {r.addr}
                        {isPc && <span class="mem-pcmark">PC</span>}
                      </span>
                      <span class="mem-bytes">
                        {GROUPS.map((g) => (
                          <span key={g} class="mem-grp">
                            {r.hex.slice(g, g + 4).map((h, k) => {
                              const j = g + k;
                              const a = r.start + j;
                              const ch = r.changed.includes(j);
                              const isP = m.snap?.pc === a;
                              const isS = m.snap?.sp === a;
                              const cls = ['mem-b', ch ? 'mem-changed' : '', isP ? 'mem-pc' : '', isS ? 'mem-sp' : ''].filter(Boolean).join(' ');
                              return (
                                <span key={j} role="cell" class={cls} title={`${hex4(a)} = ${parseInt(h, 16)}${ch ? ' (changed)' : ''}${isP ? ' (PC)' : ''}${isS ? ' (SP)' : ''}`}>
                                  {h}
                                  {(ch || isP || isS) && <span class="cb-visually-hidden">{`${ch ? ' changed' : ''}${isP ? ' PC' : ''}${isS ? ' SP' : ''}`}</span>}
                                </span>
                              );
                            })}
                          </span>
                        ))}
                      </span>
                      <span class="mem-ascii" aria-hidden="true">{r.ascii}</span>
                      <span class="mem-sym" role="cell" title={names ? names.split(', ').join(', ') : undefined}>
                        {names && <SymChips names={names.split(', ')} />}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
            <div class="mem-podrow">
              <TransportPod label="Run control" buttons={pod}>
                <StatPill state={podState.state}>{podState.text}</StatPill>
                {showPc && (
                  <span class="cb-pod-readout">
                    <span class="cb-pod-unit">PC</span>
                    <span class="cb-pod-big">{hex4(m.snap!.pc!)}</span>
                    {pcMain?.note && pcMain.value === m.snap!.pc && <span class="cb-pod-unit">· {pcMain.note}</span>}
                  </span>
                )}
              </TransportPod>
            </div>
          </div>
          <div class={`mem-cpu${cpuNote ? ' mem-cpu-stale' : ''}`}>
            <Card title="Registers" collapsible open={regsOpen} onToggle={setRegsOpen} actions={cpuNote ? <span class="cb-muted">{cpuNote}</span> : undefined}>
              {cpu ? <Registers cpu={cpu} altOpen={altOpen} onAlt={setAltOpen} onGoto={gotoText} /> : <p class="cb-muted mem-none">{live ? 'Pause the program (or hit a breakpoint) to see the registers.' : 'No values yet.'}</p>}
            </Card>
            <Card title="Stack" collapsible open={stackOpen} onToggle={setStackOpen}>
              {cpu ? <Stack cpu={cpu} /> : <p class="cb-muted mem-none">{live ? 'Pause the program to see the top of the stack.' : 'No values yet.'}</p>}
            </Card>
            <p class="cb-muted mem-foot">Same data as the Registers view in the sidebar.</p>
          </div>
        </div>
      )}
      <StatusLine
        fields={[
          { id: 'state', value: stateLine },
          m.snap && { id: 'range', label: 'Window', value: `${hex4(m.snap.base)}-${hex4(Math.min(0xffff, m.snap.base + bytes.length - 1))}`, title: `${BYTES_PER_ROW} bytes a row; what the Z80 sees now` },
        ]}
        hint="Read-only. Changed bytes are marked until the next refresh."
      />
    </div>
  );
}

/** A row's symbols on one line: the first as a dashed chip, "+N" for the rest (all of them in the tooltip and the spoken text). */
function SymChips({ names }: { names: string[] }) {
  return (
    <>
      <span class="mem-chip">{names[0]}</span>
      {names.length > 1 && <span class="mem-more" aria-hidden="true">+{names.length - 1}</span>}
      {names.length > 1 && <span class="cb-visually-hidden">{`, and ${names.slice(1).join(', ')}`}</span>}
    </>
  );
}

/** A mono value pill; a value changed by the last step gets a heavier orange ring, a dot, and "changed" in its name. */
function Val({ text, changed }: { text: string; changed: boolean }) {
  return (
    <span class={`cpu-val${changed ? ' cpu-changed' : ''}`}>
      {changed && <Icon name="circle-filled" />}
      <span>{text}</span>
      {changed && <span class="cb-visually-hidden"> changed</span>}
    </span>
  );
}

function RegRow({ r, onGoto }: { r: CpuReg; onGoto?(text: string): void }) {
  return (
    <tr>
      <th scope="row" class="cpu-name">{r.name}</th>
      <td><Val text={r.text} changed={r.changed} /></td>
      <td class="cpu-note cb-muted">{r.note}</td>
      <td class="cpu-go">
        {r.goto && onGoto && <Pill size="xs" variant="ghost" icon="arrow-right" label={`Show ${r.text} in memory`} onClick={() => onGoto(r.text)} />}
      </td>
    </tr>
  );
}

function Registers({ cpu, altOpen, onAlt, onGoto }: { cpu: MemCpu; altOpen: boolean; onAlt(open: boolean): void; onGoto(text: string): void }) {
  const mdl = cpu.model;
  return (
    <>
      <table class="cpu-table" aria-label="Registers">
        <tbody>{mdl.main.map((r) => <RegRow key={r.name} r={r} onGoto={onGoto} />)}</tbody>
      </table>
      <ul class="cpu-flags" aria-label="Flags">
        {mdl.flags.map((f) => (
          <li key={f.name} class={`cpu-flag${f.set ? ' cpu-flag-set' : ''}${f.changed ? ' cpu-changed' : ''}`} title={`${f.title} flag: ${f.set ? 'set' : 'clear'}${f.changed ? ' (changed)' : ''}`}>
            <span>{f.name}</span>
            {f.set && <Icon name="check" />}
            <span class="cb-visually-hidden">{` ${f.title} ${f.set ? 'set' : 'clear'}${f.changed ? ' changed' : ''}`}</span>
          </li>
        ))}
      </ul>
      <ul class="cpu-cpu" aria-label="CPU state">
        {mdl.cpu.map((r) => (
          <li key={r.name} class="cpu-item">
            <span class="cpu-name">{r.name}</span>
            <Val text={r.text} changed={r.changed} />
          </li>
        ))}
      </ul>
      <details class="cpu-alt" open={altOpen} onToggle={(e) => onAlt((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          Alternate set (AF' BC' DE' HL')
          {mdl.altChanged > 0 && <span class="cpu-altcount"><Icon name="circle-filled" />{` ${mdl.altChanged} changed`}</span>}
        </summary>
        <table class="cpu-table" aria-label="Alternate registers">
          <tbody>{mdl.alt.map((r) => <RegRow key={r.name} r={r} />)}</tbody>
        </table>
      </details>
    </>
  );
}

function Stack({ cpu }: { cpu: MemCpu }) {
  const n = cpu.stack.length;
  return (
    <>
      <p class="cpu-stackh cb-mono">SP {hex4(cpu.sp)} · top {n} {n === 1 ? 'word' : 'words'}</p>
      {n === 0 ? (
        <p class="cb-muted mem-none">No stack words could be read.</p>
      ) : (
        <table class="cpu-table" aria-label="Stack">
          <tbody>
            {cpu.stack.map((s, i) => (
              <tr key={s.addr} class={i === 0 ? 'cpu-top' : undefined}>
                <th scope="row" class="cpu-name cb-mono">
                  {hex4(s.addr)}
                  {i === 0 && <span class="cb-visually-hidden"> top of stack</span>}
                </th>
                <td><Val text={hex4(s.word)} changed={false} /></td>
                <td class="cpu-note cb-muted">{s.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

const root = document.getElementById('root');
if (root) render(<App />, root);
