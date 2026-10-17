/** The palette editor webview (S1): .cpcpal firmware palettes and .cpcpal12 Plus palettes. */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { PaletteRequests, PaletteView, PaletteOp } from '../../shared/protocol';
import { FW_NAMES } from '../../core/palette';
import { MAX_RGB12_ENTRIES, MODE_PENS, duplicatePens, entryRgb } from '../../core/paletteDoc';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Copyable } from '../shared/components/Copyable';
import { Icon } from '../shared/components/Icon';
import { EmptyState, Notice, NoticeAction } from '../shared/components/Notice';
import { PenSlot, PenStrip } from '../shared/components/PenStrip';
import { PixelCanvas } from '../shared/components/PixelCanvas';
import { Field, PropertyPanel, NumberField, Section, SelectField } from '../shared/components/PropertyPanel';
import { StatusLine } from '../shared/components/StatusLine';
import { Swatch, rgbCss } from '../shared/components/Swatch';
import { Toolbar, ToolbarGroup } from '../shared/components/Toolbar';
import { aspectWidth, byteGridEvery, nearestZoom } from '../shared/geometry';
import './palette.css';

type Mode = 0 | 1 | 2;
interface Persisted {
  mode?: Mode;
  fmt?: string;
}

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
  const selClamped = Math.min(sel, slotCount - 1);
  const selValue = selClamped < entries.length ? entries[selClamped] : -1;

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

  const caption = plus
    ? (i: number) => (i < 16 ? { short: `P${i}`, spoken: `Pen ${i}` } : i === 16 ? { short: 'B', spoken: 'Border' } : { short: `S${i - 16}`, spoken: `Sprite colour ${i - 16}` })
    : undefined;

  // -------- actions
  const setColour = (n: number): void => {
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
    if (sel >= lim) setSel(lim - 1);
  };
  const dropPens = (): void => {
    const m = pending ?? mode;
    void edit({ op: 'truncate', count: MODE_PENS[m] }).then(() => {
      setMode(m);
      setPending(null);
      setSel(Math.min(sel, MODE_PENS[m] - 1));
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
      else if (!plus && !e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') { document.getElementById('pal-border')?.focus(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // -------- toolbar
  const groups: ToolbarGroup[] = [];
  if (!plus)
    groups.push({
      label: 'Mode',
      radio: true,
      items: ([0, 1, 2] as Mode[]).map((m) => ({ kind: 'radio' as const, id: `mode${m}`, label: `Mode ${m}, ${MODE_PENS[m]} pens`, text: `Mode ${m}`, shortcut: `Alt+${m + 1}`, checked: (pending ?? mode) === m, onActivate: () => chooseMode(m) })),
    });
  groups.push(
    {
      label: 'History',
      items: [
        { kind: 'button', id: 'undo', label: 'Undo', icon: 'discard', disabled: !view.canUndo, why: 'nothing to undo', onActivate: () => void client.request('history', { action: 'undo' }) },
        { kind: 'button', id: 'redo', label: 'Redo', icon: 'redo', disabled: !view.canRedo, why: 'nothing to redo', onActivate: () => void client.request('history', { action: 'redo' }) },
        { kind: 'button', id: 'reset', label: 'Reset to the last loaded palette', text: 'Reset', icon: 'debug-restart', onActivate: () => void edit({ op: 'reset' }) },
      ],
    },
    {
      label: 'Palette',
      items: [
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
      ],
    },
    {
      label: 'More',
      items: [{ kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis', items: [{ id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) }] }],
    },
  );

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
    if (selValue < 0) return <p class="cb-muted">{selClamped < entries.length ? 'This entry is not a valid colour.' : 'This pen is unset: pick a colour to set it.'}</p>;
    if (plus) return null;
    const [r, g, b] = entryRgb('fw', selValue);
    const using = entries.filter((v) => v === selValue).length;
    return (
      <dl class="pal-detail">
        <dt>Colour</dt><dd>{selValue}, {colourLabel(selValue)}</dd>
        <dt>RGB</dt><dd>#{hex2(r)}{hex2(g)}{hex2(b)} ({r}, {g}, {b})</dd>
        <dt>Pens using it</dt><dd>{using}</dd>
      </dl>
    );
  })();

  const selSlot = slots[selClamped];
  const border = view.border;
  const status = [
    { id: 'count', value: `${entries.length} ${plus ? (entries.length === 1 ? 'entry' : 'entries') : entries.length === 1 ? 'pen' : 'pens'}` },
    { id: 'mode', value: plus ? 'Plus palette, 12-bit' : `mode ${mode} limit ${limit}` },
    dups.length ? { id: 'dup', value: dups.map(([a, b]) => `pens ${a} and ${b} are the same colour`).join('; ') } : undefined,
  ];

  const sidebar = (
    <PropertyPanel label="Colour details and copy">
      <Section title={plus ? 'Entry details' : 'Colour details'} open={narrow ? detailsOpen : true} onToggle={setDetailsOpen}>
        {detail}
        {!plus && (
          <SelectField
            id="pal-border"
            label="Border colour (optional)"
            description="Used only by the SetBorder line of the copied snippets; stored as a # border comment."
            value={border === null ? -1 : border}
            options={[{ value: -1, label: 'none' }, ...Array.from({ length: 27 }, (_, n) => ({ value: n, label: `${n} ${colourLabel(n)}` }))]}
            onChange={(v) => void edit({ op: 'setBorder', value: v < 0 ? null : v })}
          />
        )}
      </Section>
      <Section title="Copy as">
        <div class="pal-formats" role="radiogroup" aria-label="Copy format">
          {view.snippets.map((s) => (
            <label key={s.id}>
              <input type="radio" name="fmt" checked={s.id === snippet?.id} onChange={() => setFmt(s.id)} /> {s.label}
            </label>
          ))}
        </div>
        {snippet && <Copyable value={snippet.text.replace(/\n$/, '')} label={snippet.label} multiline copy={copy} />}
      </Section>
    </PropertyPanel>
  );

  return (
    <div class="pal">
      <h1 class="cb-visually-hidden">Palette {view.fileName}</h1>
      <Toolbar label="Palette editor" groups={groups} onEscape={() => mainRef.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"], [role="option"][tabindex="0"]')?.focus()} />
      {notices}
      <div class="pal-body">
        <div class="pal-main" ref={mainRef}>
          <section aria-labelledby="pal-pens-h">
            <h2 class="pal-h" id="pal-pens-h">{plus ? 'Entries' : 'Pens'}</h2>
            {entries.length || plus ? (
              <div class="pal-strip-row">
                <PenStrip
                  label={plus ? 'Entries' : 'Pens'}
                  slots={slots}
                  left={selClamped}
                  groups={plus ? [{ label: 'Pens 0-15', from: 0 }, { label: 'Border (16)', from: 16 }, { label: 'Sprite colours 1-15 (17-31)', from: 17 }] : undefined}
                  showNames={!narrow}
                  dim={(i) => (!plus && i >= limit ? `not used in mode ${mode} (${limit} pens)` : undefined)}
                  caption={caption}
                  onSelect={(i) => setSel(i)}
                  onReorder={(from, to) => void edit({ op: 'moveEntry', from, to }).then(() => setSel(to))}
                />
                <div class="cb-row" role="group" aria-label="Add or remove pens">
                  <button type="button" class="cb-icon-btn" title="Add pen (Ins)" aria-label="Add pen (Ins)" aria-disabled={entries.length >= limit ? 'true' : undefined} onClick={addPen}><Icon name="add" /></button>
                  <button type="button" class="cb-icon-btn" title="Remove selected pen (Del)" aria-label="Remove selected pen (Del)" aria-disabled={selSlot?.unset ? 'true' : undefined} onClick={removePen}><Icon name="trash" /></button>
                </div>
              </div>
            ) : (
              <EmptyState icon="symbol-color" title="This palette has no colours" text="Add a pen, then pick its colour." action={{ label: 'Add pen', onClick: addPen }} />
            )}
          </section>

          {!plus && entries.length > 0 && (
            <section aria-labelledby="pal-grid-h">
              <h2 class="pal-h" id="pal-grid-h">Firmware colours{selSlot && !selSlot.unset ? ` (pick one for pen ${selClamped})` : selSlot ? ` (pick the colour of pen ${selClamped})` : ''}</h2>
              <ColourGrid current={selValue} onPick={setColour} />
            </section>
          )}
          {plus && <RgbEditor value={selValue < 0 ? 0 : selValue} unset={selValue < 0} index={selClamped} bytes={view.asic[selClamped]} onSet={setColour} />}

          {entries.length > 0 && (
            <section aria-labelledby="pal-prev-h" class="pal-preview">
              <h2 class="pal-h" id="pal-prev-h">Preview</h2>
              <PixelCanvas
                image={preview}
                zoom={nearestZoom(settings.defaultZoom, aw)}
                aw={aw}
                grid={{ pixel: true, byteEvery: settings.showByteGrid ? byteGridEvery(aspMode) : 0 }}
                label={`Pens 0 to ${previewN - 1} drawn as pixels${plus ? '' : `, mode ${mode}`}`}
              />
              <p class="cb-muted">{plus ? 'Pens 0-15 as pixels.' : `The pens as pixels in mode ${mode}; heavy lines mark byte boundaries (${byteGridEvery(mode)} pixels).`}</p>
            </section>
          )}
        </div>
        <div class="pal-side">{sidebar}</div>
      </div>
      <StatusLine fields={status} hint="Arrows move, Enter or Space picks, Alt+Left/Right reorders pens" />
    </div>
  );
}

/** The 27 firmware colours: a listbox in numeric order, number and name under every swatch. */
function ColourGrid({ current, onPick }: { current: number; onPick(n: number): void }) {
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
      {Array.from({ length: 27 }, (_, n) => (
        <button
          key={n}
          type="button"
          role="option"
          aria-selected={n === current}
          aria-label={`Colour ${n}, ${colourLabel(n)}${n === current ? ', current' : ''}`}
          title={`${n} ${colourLabel(n)}`}
          data-col={n}
          tabIndex={n === focus ? 0 : -1}
          class="pal-cell"
          onFocus={() => setFocus(n)}
          onClick={() => onPick(n)}
        >
          <Swatch colour={rgbCss(entryRgb('fw', n))} />
          <span class="pal-cell-n">{n}</span>
          <span class="pal-cell-name">{colourLabel(n)}</span>
        </button>
      ))}
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
    <section aria-labelledby="pal-rgb-h">
      <h2 class="pal-h" id="pal-rgb-h">Colour of entry {index}{unset ? ' (unset)' : ''}</h2>
      <div class="cb-row" style={{ alignItems: 'flex-start', gap: '24px' }}>
        <div class="pal-rgb">
          <NumberField id="pal-r" label="Red" value={r} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((n << 8) | (g << 4) | b)} />
          <NumberField id="pal-g" label="Green" value={g} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((r << 8) | (n << 4) | b)} />
          <NumberField id="pal-b" label="Blue" value={b} min={0} max={15} pageStep={4} bigStep={4} onCommit={(n) => onSet((r << 8) | (g << 4) | n)} />
        </div>
        <Field id="pal-hex" label="RGB (hex)" error={hexErr}>
          <input
            id="pal-hex"
            class="cb-input cb-number"
            style={{ width: '6ch' }}
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
      <p class="cb-muted" style={{ marginTop: '8px' }}>
        Displayed as #{hex2(rgb[0])}{hex2(rgb[1])}{hex2(rgb[2])} (each digit n shows as n x 17).
        {bytes && !unset && <> Bytes: byte 0 = &amp;H{hex2(bytes[0])} (red&lt;&lt;4 | blue), byte 1 = &amp;H{hex2(bytes[1])} (green).</>}
      </p>
    </section>
  );
}

startEditor(createClient<PaletteRequests, PaletteView>(), PaletteApp);
