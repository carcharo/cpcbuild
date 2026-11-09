/** The palette editor webview (S1): .cpcpal firmware palettes and .cpcpal12 Plus palettes. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PaletteRequests, PaletteView, PaletteOp } from '../../shared/protocol';
import { FW_NAMES } from '../../core/palette';
import { MAX_RGB12_ENTRIES, MODE_PENS, duplicatePens, entryRgb } from '../../core/paletteDoc';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Card } from '../shared/components/Card';
import { CodeCard } from '../shared/components/CodeCard';
import { Icon } from '../shared/components/Icon';
import { EmptyState, Notice, NoticeAction } from '../shared/components/Notice';
import { PenSlot, PenStrip } from '../shared/components/PenStrip';
import { PixelCanvas } from '../shared/components/PixelCanvas';
import { Pill } from '../shared/components/Pill';
import { Field, NumberField } from '../shared/components/PropertyPanel';
import { RoundSwatch } from '../shared/components/RoundSwatch';
import { SegPill } from '../shared/components/SegPill';
import { StatusLine } from '../shared/components/StatusLine';
import { Swatch, rgbCss } from '../shared/components/Swatch';
import { Toolbar, ToolbarGroup } from '../shared/components/Toolbar';
import { colourUse, usedByText, type ColourUse } from '../../core/paletteUse';
import { rovingNext } from '../shared/roving';
import { aspectWidth, byteGridEvery, nearestZoom } from '../shared/geometry';
import './palette.css';

type Mode = 0 | 1 | 2;
interface Persisted {
  mode?: Mode;
  fmt?: string;
}

/** The border's slot in the pen strip (firmware palettes): after every pen, never a pen number. */
const BORDER_SLOT = 100;

const hex3 = (v: number): string => v.toString(16).toUpperCase().padStart(3, '0');
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const colourLabel = (n: number): string => FW_NAMES[n]?.toLowerCase() ?? '';

function inferMode(n: number): Mode {
  return n > 4 ? 0 : 1;
}

type Host = EditorHost<PaletteRequests, PaletteView>;
interface Msg {
  severity: 'info' | 'warning' | 'error';
  text: string;
}

function PaletteApp({ client, settings, view }: Host) {
  const plus = view.kind === 'rgb12';
  const saved = client.getState<Persisted>() ?? {};
  const [mode, setMode] = useState<Mode>(saved.mode ?? inferMode(view.entries.length));
  const [pending, setPending] = useState<Mode | null>(null);
  const [sel, setSel] = useState(0);
  const [fmt, setFmt] = useState<string>(saved.fmt ?? '');
  const [msg, setMsg] = useState<Msg | null>(null);
  const [narrow, setNarrow] = useState(window.innerWidth <= 720);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const version = useRef(view.version);
  version.current = view.version;
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth <= 720);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  useEffect(() => client.setState({ mode, fmt } satisfies Persisted), [mode, fmt]);

  const entries = view.entries;
  const limit = plus ? MAX_RGB12_ENTRIES : MODE_PENS[mode];
  const slotCount = plus ? MAX_RGB12_ENTRIES : Math.max(limit, entries.length);
  const onBorder = !plus && sel === BORDER_SLOT;
  const selClamped = onBorder ? BORDER_SLOT : Math.min(sel, slotCount - 1);
  const selValue = onBorder ? (view.border ?? -1) : selClamped < entries.length ? entries[selClamped] : -1;
  const use = useMemo(() => colourUse(entries, plus ? null : view.border), [entries, view.border, plus]);

  const edit = async (op: PaletteOp): Promise<void> => {
    try {
      const r = await client.request('edit', { baseVersion: version.current, op });
      version.current = r.version;
    } catch (e) {
      setMsg({ severity: 'error', text: (e as Error).message });
    }
  };

  // -------- slots
  const dups = useMemo(() => duplicatePens(entries, plus ? 16 : limit), [entries, limit, plus]);
  const dupOf = new Map<number, number>(dups.map(([lo, hi]) => [hi, lo]));
  const dupLow = new Set(dups.map(([lo]) => lo));
  const slots: PenSlot[] = Array.from({ length: slotCount }, (_, i) => {
    const v = i < entries.length ? entries[i] : -1;
    const err = view.errors.find((e) => e.index === i);
    const warn = dupOf.has(i) ? `Same colour as pen ${dupOf.get(i)}: the importer maps image colours to the lower pen` : dupLow.has(i) ? `Same colour as pen ${dups.find(([lo]) => lo === i)?.[1]}` : undefined;
    if (v < 0 && !err) return { index: i, unset: true, number: '', name: '' };
    if (err) return { index: i, number: err.token, name: 'bad entry', colour: undefined, error: err.message };
    const rgb = entryRgb(view.kind, v);
    return { index: i, colour: rgbCss(rgb), number: plus ? hex3(v) : String(v), name: plus ? `red ${v >> 8}, green ${(v >> 4) & 15}, blue ${v & 15}` : colourLabel(v), warn };
  }).map((s) => (s.error ? { ...s, unset: false } : s));
  if (!plus)
    slots.push(
      view.border === null
        ? { index: BORDER_SLOT, unset: true, fixed: true, number: '', name: '' }
        : { index: BORDER_SLOT, fixed: true, colour: rgbCss(entryRgb('fw', view.border)), number: String(view.border), name: colourLabel(view.border) },
    );

  const caption = plus
    ? (i: number) => (i < 16 ? { short: `P${i}`, spoken: `Pen ${i}` } : i === 16 ? { short: 'B', spoken: 'Border' } : { short: `S${i - 16}`, spoken: `Sprite colour ${i - 16}` })
    : (i: number) => (i === BORDER_SLOT ? { short: 'Border', spoken: 'Border' } : { short: `Pen ${i}`, spoken: `Pen ${i}` });

  // -------- actions
  const setColour = (n: number): void => {
    if (onBorder) {
      void edit({ op: 'setBorder', value: n });
      return;
    }
    if (selClamped >= slotCount) return;
    void edit({ op: 'setEntry', index: selClamped, value: n });
  };
  const addPen = (): void => {
    if (entries.length >= limit) {
      setMsg({ severity: 'info', text: `${plus ? 'A Plus palette' : `Mode ${mode}`} has at most ${limit} ${plus ? 'entries' : 'pens'}.` });
      return;
    }
    void edit({ op: 'addEntry' }).then(() => setSel(entries.length));
  };
  const removePen = (): void => {
    if (onBorder) {
      if (view.border !== null) void edit({ op: 'setBorder', value: null });
      return;
    }
    if (selValue === -1 && !view.errors.some((e) => e.index === selClamped)) return;
    if (plus && selClamped !== entries.length - 1) {
      setMsg({ severity: 'info', text: 'Plus palette entries are positional: only the last entry can be removed. Set the others to 000 instead.' });
      return;
    }
    void edit({ op: 'removeEntry', index: selClamped }).then(() => setSel(Math.max(0, selClamped - 1)));
  };
  const chooseMode = (m: Mode): void => {
    const lim = MODE_PENS[m];
    if (entries.length > lim) {
      setPending(m);
      return;
    }
    setPending(null);
    setMode(m);
    if (sel !== BORDER_SLOT && sel >= lim) setSel(lim - 1);
  };
  const dropPens = (): void => {
    const m = pending ?? mode;
    void edit({ op: 'truncate', count: MODE_PENS[m] }).then(() => {
      setMode(m);
      setPending(null);
      setSel(sel === BORDER_SLOT ? sel : Math.min(sel, MODE_PENS[m] - 1));
    });
  };
  const loadPng = async (): Promise<void> => {
    try {
      const r = await client.request('loadPng', { baseVersion: version.current, limit });
      if (!r.loaded) {
        if (r.message) setMsg({ severity: 'warning', text: r.message });
        return;
      }
      const name = (r.file ?? '').split(/[\\/]/).pop();
      if (r.total !== undefined && r.used !== undefined && r.total > r.used)
        setMsg({ severity: 'warning', text: `${name} has ${r.total} colours; ${plus ? 'a Plus palette' : `mode ${mode}`} has ${limit} ${plus ? 'entries' : 'pens'}, so only the first ${r.used} (in order of first appearance) were taken.` });
      else setMsg({ severity: 'info', text: `Took ${r.used} colour${r.used === 1 ? '' : 's'} from ${name}. The image was not changed.` });
      setSel(0);
    } catch (e) {
      setMsg({ severity: 'error', text: (e as Error).message });
    }
  };
  const copy = (text: string): Promise<unknown> => client.request('copy', { text });
  const snippet = view.snippets.find((s) => s.id === fmt) ?? view.snippets[0];

  // -------- keyboard (single keys only outside text fields; undo/redo/save belong to VS Code)
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select')) return;
      if (e.altKey && !plus && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); chooseMode((Number(e.key) - 1) as Mode); }
      else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Insert') { e.preventDefault(); addPen(); }
      else if (!e.altKey && !e.ctrlKey && !e.metaKey && e.key === 'Delete') { e.preventDefault(); removePen(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c' && snippet) { e.preventDefault(); void copy(snippet.text); setMsg({ severity: 'info', text: `Copied ${snippet.label}.` }); }
      else if (!plus && !e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') { { const b = document.querySelector<HTMLElement>(`[data-pen="${BORDER_SLOT}"]`); b?.focus(); } }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // -------- toolbar (pills look); the Mode radio group is a segmented pill beside it
  const groups: ToolbarGroup[] = [
    {
      label: 'Palette',
      items: [
        { kind: 'button', id: 'reset', label: 'Reset to the last loaded palette', text: 'Reset', icon: 'debug-restart', onActivate: () => void edit({ op: 'reset' }) },
        { kind: 'button', id: 'png', label: 'Take colours from a PNG', text: 'Load from PNG', icon: 'file-media', onActivate: () => void loadPng() },
        {
          kind: 'menu',
          id: 'copyas',
          label: 'Copy as',
          shortcut: 'Ctrl+Shift+C',
          text: 'Copy as',
          icon: 'copy',
          items: view.snippets.map((s) => ({ id: s.id, label: s.label, checked: s.id === snippet?.id, onActivate: () => { setFmt(s.id); void copy(s.text); setMsg({ severity: 'info', text: `Copied ${s.label}.` }); } })),
        },
        { kind: 'button', id: 'help', label: 'Help', icon: 'question', pressed: helpOpen, onActivate: () => setHelpOpen(!helpOpen) },
      ],
    },
    {
      label: 'More',
      items: [{ kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis', items: [{ id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) }] }],
    },
  ];

  // -------- notices
  const notices = [];
  const dropAction: NoticeAction[] = [{ label: 'Drop pens', onClick: dropPens }, { label: 'Cancel', secondary: true, onClick: () => setPending(null) }];
  if (pending !== null)
    notices.push(<Notice key="pending" severity="warning" actions={dropAction}>Mode {pending} has {MODE_PENS[pending]} pens: pens {MODE_PENS[pending]}-{entries.length - 1} will be dropped.</Notice>);
  else if (!plus && entries.length > limit)
    notices.push(<Notice key="over" severity="warning" actions={[{ label: 'Drop pens', onClick: dropPens }]}>palette has {entries.length} pens, mode {mode} has {limit}</Notice>);
  for (const e of view.errors.slice(0, 3))
    notices.push(<Notice key={`e${e.index}`} severity="error">{e.message} (entry {e.index}, '{e.token}'). Saving is disabled until this is fixed.</Notice>);
  if (view.errors.length > 3) notices.push(<Notice key="more" severity="error">{view.errors.length - 3} more bad entries.</Notice>);
  if (!entries.length) notices.push(<Notice key="empty" severity="error">empty palette</Notice>);
  if (helpOpen)
    notices.push(
      <Notice key="help" severity="info" onDismiss={() => setHelpOpen(false)}>
        Arrows move between pens, Enter or Space picks, Alt+Left/Right reorders pens, Insert adds a pen, Delete removes the selected pen (or clears the border), B jumps to the border. Undo and Redo are VS Code's own: Ctrl+Z and Ctrl+Y (Cmd+Z and Cmd+Shift+Z on macOS).
      </Notice>,
    );
  if (msg) notices.push(<Notice key="msg" severity={msg.severity} onDismiss={() => setMsg(null)}>{msg.text}</Notice>);

  // -------- preview image: the pens as pixels
  const previewN = Math.min(16, plus ? 16 : Math.max(1, Math.min(limit, entries.length || limit)));
  const preview = useMemo(() => {
    const rgba = new Uint8ClampedArray(previewN * 4);
    for (let i = 0; i < previewN; i++) {
      const v = i < entries.length ? entries[i] : -1;
      if (v < 0) continue;
      const c = entryRgb(view.kind, v);
      rgba.set([c[0], c[1], c[2], 255], i * 4);
    }
    return { width: previewN, height: 1, rgba };
  }, [entries, previewN, view.kind]);
  const aspMode = plus ? 'plus' : mode;
  const aw = aspectWidth(aspMode, settings.pixelAspect, 2, 1);

  // -------- detail card
  const detail = (() => {
    if (selValue < 0) return <p class="cb-muted">{onBorder ? 'The border is not set: pick a colour to set it.' : selClamped < entries.length ? 'This entry is not a valid colour.' : 'This pen is unset: pick a colour to set it.'}</p>;
    const [r, g, b] = entryRgb(plus ? 'rgb12' : 'fw', selValue);
    const u = plus ? undefined : use.get(selValue);
    const pensUsing = u ? `${u.pens.length}${u.pens.length ? ` (pen ${u.pens.join(', ')})` : ''}${u.border ? `${u.pens.length ? ', ' : ' '}and the border` : ''}` : '0';
    return (
      <div class="pal-rows">
        <div class="pal-prow">
          <span class="pal-prow-k">Colour</span>
          <span class="pal-prow-v"><RoundSwatch colour={rgbCss([r, g, b])} size={18} />{plus ? hex3(selValue) : `${selValue} ${colourLabel(selValue)}`}</span>
        </div>
        <div class="pal-prow">
          <span class="pal-prow-k">RGB</span>
          <span class="pal-prow-v pal-mono">#{hex2(r)}{hex2(g)}{hex2(b)} ({r}, {g}, {b})</span>
        </div>
        {!plus && (
          <div class="pal-prow">
            <span class="pal-prow-k">Pens using it</span>
            <span class="pal-prow-v pal-mono">{pensUsing}</span>
          </div>
        )}
      </div>
    );
  })();

  const selSlot = slots.find((s) => s.index === selClamped);
  const status = [
    { id: 'count', value: `${entries.length} ${plus ? (entries.length === 1 ? 'entry' : 'entries') : entries.length === 1 ? 'pen' : 'pens'}` },
    { id: 'mode', value: plus ? 'Plus palette, 12-bit' : `mode ${mode} limit ${limit}` },
    dups.length ? { id: 'dup', value: dups.map(([a, b]) => `pens ${a} and ${b} are the same colour`).join('; ') } : undefined,
  ];

  const sidebar = (
    <div class="cb-card-stack">
      <Card title={plus ? 'Entry details' : onBorder ? 'Border details' : 'Colour details'} collapsible={narrow} open={narrow ? detailsOpen : true} onToggle={setDetailsOpen}>
        {detail}
      </Card>
      <Card title="Copy as">
        <FormatChips snippets={view.snippets} current={snippet?.id} onChange={setFmt} />
      </Card>
      {snippet && <CodeCard title={snippet.label} value={snippet.text.replace(/\n$/, '')} multiline copy={copy} />}
    </div>
  );

  const gridTitle = onBorder ? 'Firmware colours (pick the border colour)' : `Firmware colours${selSlot && !selSlot.unset ? ` (pick one for pen ${selClamped})` : selSlot ? ` (pick the colour of pen ${selClamped})` : ''}`;

  return (
    <div class="pal">
      <h1 class="cb-visually-hidden">Palette {view.fileName}</h1>
      <div class="pal-bar">
        {!plus && (
          <SegPill
            label="Mode"
            value={pending ?? mode}
            options={([0, 1, 2] as Mode[]).map((m) => ({ value: m, label: `Mode ${m} · ${MODE_PENS[m]}`, title: `Mode ${m}, ${MODE_PENS[m]} pens (Alt+${m + 1})` }))}
            onChange={chooseMode}
          />
        )}
        <Toolbar look="pills" label="Palette editor" groups={groups} onEscape={() => mainRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"], [role="option"][tabindex="0"]')?.focus()} />
      </div>
      {notices}
      <div class="pal-body">
        <div class="pal-main" ref={mainRef}>
          {entries.length || plus ? (
            <Card title={plus ? 'Entries' : 'Pens'}>
              <PenStrip
                label={plus ? 'Entries' : 'Pens'}
                slots={slots}
                left={selClamped}
                round
                groups={plus ? [{ label: 'Pens 0-15', from: 0 }, { label: 'Border (16)', from: 16 }, { label: 'Sprite colours 1-15 (17-31)', from: 17 }] : [{ label: '', from: 0 }, { label: '', from: BORDER_SLOT }]}
                showNames
                dim={(i) => (!plus && i !== BORDER_SLOT && i >= limit ? `not used in mode ${mode} (${limit} pens)` : undefined)}
                caption={caption}
                onSelect={(i) => setSel(i)}
                onReorder={(from, to) => void edit({ op: 'moveEntry', from, to }).then(() => setSel(to))}
              />
              <div class="cb-row" role="group" aria-label="Add or remove pens">
                <Pill size="sm" icon="add" text="Add pen" label="Add pen" shortcut="Ins" disabled={entries.length >= limit} why={`at most ${limit} ${plus ? 'entries' : 'pens'}`} onClick={addPen} />
                <Pill
                  size="sm"
                  icon="trash"
                  text={onBorder ? 'Clear border' : 'Remove pen'}
                  label={onBorder ? 'Clear the border colour' : 'Remove selected pen'}
                  shortcut="Del"
                  disabled={!!selSlot?.unset}
                  why={onBorder ? 'the border is not set' : 'this pen is unset'}
                  onClick={removePen}
                />
              </div>
            </Card>
          ) : (
            <EmptyState icon="symbol-color" title="This palette has no colours" text="Add a pen, then pick its colour." action={{ label: 'Add pen', onClick: addPen }} />
          )}

          {!plus && entries.length > 0 && (
            <Card title={gridTitle}>
              <ColourGrid current={selValue} use={use} onPick={setColour} />
            </Card>
          )}
          {plus && <RgbEditor value={selValue < 0 ? 0 : selValue} unset={selValue < 0} index={selClamped} bytes={view.asic[selClamped]} onSet={setColour} />}

          {entries.length > 0 && (
            <Card title="Preview">
              <div class="pal-prev-panel">
                <PixelCanvas
                  image={preview}
                  zoom={nearestZoom(settings.defaultZoom, aw)}
                  aw={aw}
                  grid={{ pixel: true, byteEvery: settings.showByteGrid ? byteGridEvery(aspMode) : 0 }}
                  label={`Pens 0 to ${previewN - 1} drawn as pixels${plus ? '' : `, mode ${mode}`}`}
                />
              </div>
              <p class="cb-muted">{plus ? 'Pens 0-15 as pixels.' : `The pens as pixels in mode ${mode}; heavy lines mark byte boundaries (${byteGridEvery(mode)} pixels).`}</p>
            </Card>
          )}
        </div>
        <div class="pal-side">{sidebar}</div>
      </div>
      <StatusLine fields={status} hint="Arrows move, Enter or Space picks, Alt+Left/Right reorders pens" />
    </div>
  );
}

/** The Copy as formats: a radiogroup of chips with a roving tab stop (arrows move and select). */
function FormatChips({ snippets, current, onChange }: { snippets: { id: string; label: string }[]; current?: string; onChange(id: string): void }) {
  const root = useRef<HTMLDivElement>(null);
  const cur = Math.max(0, snippets.findIndex((s) => s.id === current));
  return (
    <div
      class="pal-formats"
      role="radiogroup"
      aria-label="Copy format"
      ref={root}
      onKeyDown={(e) => {
        const n = rovingNext(snippets.length, cur, e.key);
        if (n === undefined) return;
        e.preventDefault();
        onChange(snippets[n].id);
        root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
      }}
    >
      {snippets.map((s, i) => (
        <button key={s.id} type="button" role="radio" class="cb-pill cb-chip" aria-checked={i === cur} tabIndex={i === cur ? 0 : -1} onClick={() => onChange(s.id)}>
          {i === cur && <Icon name="check" />}
          <span>{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/** The 27 firmware colours: a listbox in numeric order; each tile has a round swatch, number and name, and says which pens (or the border) use it. */
function ColourGrid({ current, use, onPick }: { current: number; use: Map<number, ColourUse>; onPick(n: number): void }) {
  const [focus, setFocus] = useState(current >= 0 ? current : 0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (current >= 0) setFocus(current); }, [current]);
  const go = (n: number): void => {
    const c = Math.max(0, Math.min(26, n));
    setFocus(c);
    root.current?.querySelector<HTMLElement>(`[data-col="${c}"]`)?.focus();
  };
  const columns = (): number => {
    const cells = [...(root.current?.children ?? [])] as HTMLElement[];
    if (!cells.length) return 9;
    const top = cells[0].offsetTop;
    const n = cells.findIndex((c) => c.offsetTop !== top);
    return n < 0 ? cells.length : n;
  };
  return (
    <div
      class="pal-grid"
      role="listbox"
      aria-label="Firmware colours"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); go(focus + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(focus - 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); go(focus + columns()); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); go(focus - columns()); }
        else if (e.key === 'Home') { e.preventDefault(); go(0); }
        else if (e.key === 'End') { e.preventDefault(); go(26); }
      }}
    >
      {Array.from({ length: 27 }, (_, n) => {
        const used = usedByText(use.get(n));
        return (
        <button
          key={n}
          type="button"
          role="option"
          aria-selected={n === current}
          aria-label={`Colour ${n}, ${colourLabel(n)}${used ? `, ${used}` : ''}${n === current ? ', current' : ''}`}
          title={`${n} ${colourLabel(n)}${used ? `, ${used}` : ''}`}
          data-col={n}
          tabIndex={n === focus ? 0 : -1}
          class="pal-cell"
          onFocus={() => setFocus(n)}
          onClick={() => onPick(n)}
        >
          <RoundSwatch colour={rgbCss(entryRgb('fw', n))} size={30} />
          <span class="pal-cell-text">
            <span class="pal-cell-n">{n}</span>
            <span class="pal-cell-name">{colourLabel(n)}</span>
          </span>
          {used && <span class="pal-cell-used" aria-hidden="true" />}
        </button>
        );
      })}
    </div>
  );
}

/** Plus: three 0-15 steppers, a three-digit hex box, the 96 px result, and the ASIC bytes from the host's codec. */
function RgbEditor({ value, unset, index, bytes, onSet }: { value: number; unset: boolean; index: number; bytes?: [number, number]; onSet(v: number): void }) {
  const r = value >> 8, g = (value >> 4) & 15, b = value & 15;
  const [hex, setHex] = useState(hex3(value));
  const [hexErr, setHexErr] = useState<string | undefined>();
  useEffect(() => { setHex(hex3(value)); setHexErr(undefined); }, [value, index]);
  const commitHex = (t: string): void => {
    if (!/^[0-9a-fA-F]{3}$/.test(t)) { setHexErr('Enter three hex digits RGB, for example F80'); return; }
    setHexErr(undefined);
    const v = parseInt(t, 16);
    if (v !== value || unset) onSet(v);
  };
  const rgb = entryRgb('rgb12', value);
  return (
    <Card title={`Colour of entry ${index}${unset ? ' (unset)' : ''}`}>
      <div class="cb-row pal-rgb-row">
        <div class="pal-rgb">
          <NumberField id="pal-r" label="Red" value={r} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((n << 8) | (g << 4) | b)} />
          <NumberField id="pal-g" label="Green" value={g} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((r << 8) | (n << 4) | b)} />
          <NumberField id="pal-b" label="Blue" value={b} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((r << 8) | (g << 4) | n)} />
        </div>
        <Field id="pal-hex" label="RGB (hex)" error={hexErr}>
          <input
            id="pal-hex"
            class="cb-input cb-number pal-hex"
            maxLength={3}
            value={hex}
            aria-invalid={hexErr ? 'true' : undefined}
            aria-describedby={hexErr ? 'pal-hex-err' : undefined}
            onInput={(e) => setHex((e.target as HTMLInputElement).value)}
            onBlur={() => commitHex(hex)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitHex(hex); else if (e.key === 'Escape') { setHex(hex3(value)); setHexErr(undefined); } }}
          />
        </Field>
        <div>
          <Swatch colour={rgbCss(rgb)} size={96} unset={unset} title={`#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`} />
        </div>
      </div>
      <p class="cb-muted">
        Displayed as #{hex2(rgb[0])}{hex2(rgb[1])}{hex2(rgb[2])} (each digit n shows as n x 17).
        {bytes && !unset && <> Bytes: byte 0 = &amp;H{hex2(bytes[0])} (red&lt;&lt;4 | blue), byte 1 = &amp;H{hex2(bytes[1])} (green).</>}
      </p>
    </Card>
  );
}

startEditor(createClient<PaletteRequests, PaletteView>(), PaletteApp);
