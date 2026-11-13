/** The sound-effects editor webview (.cpcsfx): effect list, pitch / volume / noise curves, properties, AY preview. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOCKS, PRESET_KINDS, PresetKind, PresetParams, SfxFrame, lengthMs, nameProblem, noteName, period } from '../../core/sfxDoc';
import { sfxConstName } from '../../core/sfxBuild';
import { DEFAULT_PARAMS, MAX_LENGTH, MIN_LENGTH, PRESET_LABELS } from '../../core/sfxPresets';
import { vt2Problems } from '../../core/vt2';
import type { SfxOp, SfxRequests, SfxView } from '../../shared/protocol';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Icon } from '../shared/components/Icon';
import { Notice } from '../shared/components/Notice';
import { Field, NumberField, PropertyPanel, SelectField } from '../shared/components/PropertyPanel';
import { Card } from '../shared/components/Card';
import { Pill } from '../shared/components/Pill';
import { SegPill } from '../shared/components/SegPill';
import { Shelf, type ShelfItem } from '../shared/components/Shelf';
import { StatPill } from '../shared/components/StatPill';
import { TransportPod } from '../shared/components/TransportPod';
import { rovingNext } from '../shared/roving';
import { tipText } from '../shared/tooltip';
import { useTooltip } from '../shared/components/Tooltip';
import { StatusLine } from '../shared/components/StatusLine';
import { Toolbar, ToolbarGroup } from '../shared/components/Toolbar';
import { createSfxPlayer, type SfxPlayer } from '../shared/audio/sfxPlayer';
import { Lanes } from '../shared/lanes/Lanes';
import { fitPitchRange, shelfShape, type DrawMode } from './curve';
import './sfx.css';

type Host = EditorHost<SfxRequests, SfxView>;

/** Older saved state may also hold a `target` (the removed Spectrum clock choice); it is ignored. */
interface Persisted {
  cellW?: number;
}
interface Msg {
  severity: 'info' | 'warning' | 'error';
  text: string;
}

const ZOOMS = [2, 3, 4, 6, 8, 12, 16, 24, 32];
const FULL_RANGE = { lo: 24, hi: 107 };

/** The AudioWorklet URL the host put in the page (#boot). */
function workletUrl(): string {
  try {
    return (JSON.parse(document.getElementById('boot')?.textContent || '{}') as { worklet?: string }).worklet ?? '';
  } catch {
    return '';
  }
}

const inField = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select');

function Help({ onClose }: { onClose(): void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  const rows: [string, string][] = [
    ['Space, Esc', 'Play the selected effect, stop it (the first press or click also switches the sound on)'],
    ['Click, drag', 'On a lane: set the value of a frame, or draw along it. On the tone and noise strips: switch frames on or off'],
    ['Shift+drag', 'Draw a straight line from the last point you set on that lane (in Line mode, Shift draws freely instead)'],
    ['Draw, Line', 'The mode switch above the lanes: Line makes every click or drag a straight line from the last point'],
    ['Alt+drag', 'Pitch: do not snap to semitones (0.01 steps)'],
    ['Left, Right, Home, End', 'Lanes: move to the previous / next / first / last frame (Shift: 10 frames)'],
    ['Up, Down', 'Lanes: change the value at the frame. Pitch: a semitone (Shift an octave, Alt a tenth). Volume and noise period: 1 (Shift 4)'],
    ['T, N', 'Lanes: switch tone, or noise, on or off at the frame'],
    ['Insert, Delete', 'Lanes: duplicate / remove the frame. Effect list: add / delete an effect'],
    ['Up, Down, Alt+Up, Alt+Down', 'Effect list: select the previous / next effect, move the effect up / down'],
    ['D', 'Effect list: duplicate the effect'],
    ['= -, F', 'Zoom the time axis in / out; pitch range: fit the effect / show all notes'],
    ['?', 'This help'],
  ];
  return (
    <div class="sx-help" role="dialog" aria-label="Keyboard shortcuts" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div class="sx-help-h">
        <strong>Keyboard shortcuts</strong>
        <button type="button" class="cb-icon-btn" aria-label="Close shortcuts" onClick={onClose} ref={btn}><Icon name="close" /></button>
      </div>
      <dl>{rows.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
      <p class="cb-muted">Drawing any frame by hand removes the effect's preset. Undo, Redo and Save are VS Code's: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S.</p>
    </div>
  );
}

/** A slider that shows its value (in a small pill next to the label) while it moves and edits the document when released. */
function ParamSlider(p: { id: string; label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onCommit(v: number): void }) {
  const [live, setLive] = useState(p.value);
  useEffect(() => setLive(p.value), [p.value]);
  const show = p.format ?? String;
  return (
    <div class="cb-field">
      <div class="sx-slider-h">
        <label for={p.id}>{p.label}</label>
        <StatPill>{show(live)}</StatPill>
      </div>
      <input
        id={p.id}
        type="range"
        class="sx-range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={live}
        aria-valuetext={show(live)}
        onInput={(e) => setLive(Number((e.target as HTMLInputElement).value))}
        onChange={(e) => p.onCommit(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

/** The preset kinds as a 4-column grid of chips with radio semantics: one tab stop, arrows move and select. */
function KindGrid({ value, onChange }: { value: PresetKind; onChange(k: PresetKind): void }) {
  const root = useRef<HTMLDivElement>(null);
  const tt = useTooltip();
  const cur = PRESET_KINDS.indexOf(value);
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    let n: number | undefined;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const j = i + (e.key === 'ArrowUp' ? -4 : 4);
      n = j >= 0 && j < PRESET_KINDS.length ? j : undefined;
    } else n = rovingNext(PRESET_KINDS.length, i, e.key, { axis: 'horizontal' });
    if (n === undefined) return;
    e.preventDefault();
    onChange(PRESET_KINDS[n]);
    root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
  };
  return (
    <div class="sx-kinds" role="radiogroup" aria-label="Preset kind" ref={root}>
      {PRESET_KINDS.map((k, i) => (
        <button
          key={k}
          type="button"
          role="radio"
          class="cb-pill cb-chip cb-pill-xs sx-kind"
          aria-checked={k === value}
          tabIndex={i === cur ? 0 : -1}
          {...tt.props(k, PRESET_LABELS[k])}
          onClick={() => onChange(k)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          {PRESET_LABELS[k]}
        </button>
      ))}
      {tt.node}
    </div>
  );
}

/** "Add" with a drop-down of the presets and Blank: a small pill that opens a menu (arrows, Home/End, type-ahead, Esc). */
function AddMenu({ disabled, why, items }: { disabled: boolean; why: string; items: { id: string; label: string; onActivate(): void }[] }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const tt = useTooltip();
  const tp = tt.props('add', tipText({ label: 'Add effect', disabled, why }));
  const close = (restore = true): void => {
    setOpen(false);
    if (restore) btn.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const away = (e: MouseEvent): void => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const menuKey = (e: KeyboardEvent): void => {
    const els = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number): void => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(els.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key.length === 1) {
      const n = els.findIndex((el, k) => k > i && (el.textContent ?? '').trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (n >= 0) go(n);
    }
  };
  return (
    <div class="cb-menu-wrap" ref={wrap}>
      <button
        ref={btn}
        type="button"
        class="cb-pill cb-pill-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled ? 'true' : undefined}
        {...tp}
        onClick={() => { tp.onClick(); if (!disabled) setOpen(!open); }}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !disabled) { e.preventDefault(); e.stopPropagation(); setOpen(true); } }}
      >
        <Icon name="add" />
        <span>Add</span>
        <Icon name="chevron-down" />
      </button>
      {tt.node}
      {open && (
        <div class="cb-menu" role="menu" aria-label="Add effect" onKeyDown={menuKey as never}>
          {items.map((m) => (
            <button key={m.id} type="button" role="menuitem" tabIndex={-1} class="cb-menu-item" onClick={() => { close(); m.onActivate(); }}>
              <span class="cb-menu-check" />
              <span>{m.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The read-only bank name in the toolbar. */
function BankPill({ bank }: { bank: string }) {
  const tt = useTooltip();
  return (
    <>
      <span class="cb-pill cb-pill-mono sx-bank" {...tt.props('bank', 'Bank name comes from the file name')}>{bank}</span>
      {tt.node}
    </>
  );
}

function NameField({ value, taken, onCommit }: { value: string; taken: (n: string) => string | undefined; onCommit(n: string): void }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(value); setError(undefined); }, [value]);
  const commit = (): void => {
    const msg = nameProblem(text) ?? taken(text);
    setError(msg);
    if (!msg && text !== value) onCommit(text);
  };
  return (
    <Field id="sx-name" label="Name" error={error}>
      <input
        id="sx-name"
        class="cb-input"
        value={text}
        maxLength={24}
        spellcheck={false}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? 'sx-name-err' : undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { setText(value); setError(undefined); }
        }}
      />
    </Field>
  );
}

function SfxApp({ client, view }: Host) {
  const doc = view.doc;
  const saved = client.getState<Persisted>() ?? {};
  const [sel, setSel] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [cellW, setCellW] = useState(ZOOMS.includes(saved.cellW ?? 0) ? (saved.cellW as number) : 8);
  const [mode, setMode] = useState<DrawMode>('draw');
  const [narrow, setNarrow] = useState(window.innerWidth <= 720);
  const [live, setLive] = useState('');
  const [full, setFull] = useState(false);
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [playFrame, setPlayFrame] = useState<number | null>(null);
  const [audioOn, setAudioOn] = useState(false);
  const version = useRef(view.version);
  version.current = view.version;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const audio = useRef<{ ctx: AudioContext; player: SfxPlayer } | null>(null);

  const si = Math.min(sel, doc.effects.length - 1);
  const effect = doc.effects[si];
  useEffect(() => { void client.request('select', { effect: si }).catch(() => undefined); }, [si]);
  const frames = effect.frames;
  const cur = Math.min(cursor, frames.length - 1);
  const presetKey = effect.preset ? JSON.stringify(effect.preset) : '';
  const [fitted, setFitted] = useState(() => fitPitchRange(frames));
  const range = full ? FULL_RANGE : fitted;

  useEffect(() => client.setState({ cellW } satisfies Persisted), [cellW]);
  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth <= 720);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  // refit the pitch range when another effect is chosen or a preset changes (not while drawing)
  useEffect(() => setFitted(fitPitchRange(effect.frames)), [si, presetKey]);
  useEffect(() => { if (cursor > frames.length - 1) setCursor(frames.length - 1); }, [frames.length]);

  /** Sends an edit; edits are chained so each one quotes the version the previous one produced. */
  const edit = (op: SfxOp): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      try {
        const r = await client.request('edit', { baseVersion: version.current, op });
        version.current = r.version;
        return true;
      } catch (e) {
        setMsg({ severity: 'error', text: (e as Error).message });
        return false;
      }
    };
    const p = chain.current.then(run);
    chain.current = p;
    return p;
  };

  // -------------------------------------------------------------- sound
  const ensureAudio = (): boolean => {
    if (audio.current) return true;
    try {
      const url = workletUrl();
      if (!url) throw new Error('the sound preview was not loaded');
      const ctx = new AudioContext();
      const player = createSfxPlayer(ctx, url);
      player.onFrame((n) => setPlayFrame(n));
      player.onEnded(() => { setPlayFrame(null); setLive((l) => (l.startsWith('Playing') ? 'Stopped' : l)); });
      audio.current = { ctx, player };
      setAudioOn(true);
      return true;
    } catch (e) {
      setMsg({ severity: 'error', text: `Sound is not available: ${(e as Error).message}` });
      return false;
    }
  };
  const play = (): void => {
    if (!ensureAudio()) return;
    setPlayFrame(0);
    setLive(`Playing ${effect.name}`);
    audio.current?.player.play(frames).catch((e: Error) => {
      setPlayFrame(null);
      setLive('');
      setMsg({ severity: 'error', text: `Cannot play: ${e.message}` });
    });
  };
  const stop = (): void => {
    audio.current?.player.stop();
    setPlayFrame(null);
    setLive((l) => (l.startsWith('Playing') ? 'Stopped' : l));
  };
  useEffect(() => () => { void audio.current?.ctx.close(); }, []);
  // the first click or key press anywhere switches the sound on (browsers need a gesture)
  useEffect(() => {
    if (audioOn) return;
    const on = (): void => { ensureAudio(); };
    window.addEventListener('pointerdown', on, { once: true });
    window.addEventListener('keydown', on, { once: true });
    return () => { window.removeEventListener('pointerdown', on); window.removeEventListener('keydown', on); };
  }, [audioOn]);

  // ------------------------------------------------------------- actions
  const select = (i: number): void => {
    stop();
    setSel(Math.max(0, Math.min(doc.effects.length - 1, i)));
    setCursor(0);
  };
  const addPreset = (kind: PresetKind): void => {
    void edit({ op: 'addPreset', kind, after: si }).then((ok) => ok && select(si + 1));
  };
  const addBlank = (): void => { void edit({ op: 'addBlank', after: si }).then((ok) => ok && select(si + 1)); };
  const duplicate = (): void => { void edit({ op: 'duplicate', effect: si }).then((ok) => ok && select(si + 1)); };
  const remove = (): void => { void edit({ op: 'delete', effect: si }).then((ok) => ok && setSel(Math.max(0, si - 1))); };
  const focusSelected = (): void => { setTimeout(() => document.querySelector<HTMLElement>('.cb-shelf-card[aria-selected="true"]')?.focus(), 0); };
  const move = (to: number, refocus = false): void => {
    if (to < 0 || to >= doc.effects.length) return;
    void edit({ op: 'move', from: si, to }).then((ok) => { if (ok) { setSel(to); if (refocus) focusSelected(); } });
  };
  const setParams = (params: PresetParams): void => {
    if (effect.preset) void edit({ op: 'setPreset', effect: si, kind: effect.preset.kind, params });
  };
  const commitFrames = async (start: number, next: SfxFrame[], label: string): Promise<void> => {
    await edit({ op: 'setFrames', effect: si, start, frames: next, label });
  };
  const zoom = (d: number): void => {
    const i = ZOOMS.indexOf(cellW);
    setCellW(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + d))]);
  };
  const togglePitchRange = (): void => {
    if (full) { setFull(false); setFitted(fitPitchRange(frames)); } else setFull(true);
  };

  // ------------------------------------------------------------ keyboard
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement;
      if (e.key === 'Escape') {
        if (help) { setHelp(false); return; }
        stop();
        return;
      }
      if (inField(t)) return;
      if (e.key === ' ') {
        if (t.closest('button, [role="menuitem"], [role="menuitemradio"]')) return;
        e.preventDefault();
        if (!e.repeat) play();
      } else if (e.altKey || e.shiftKey) return;
      else if (e.key === '?') { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(1); }
      else if (e.key === '-') { e.preventDefault(); zoom(-1); }
      else if (e.key === 'f' || e.key === 'F') { e.preventDefault(); togglePitchRange(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  /** The keys of the effect list that the shelf does not handle itself (it does arrows, Alt+arrows, Home / End, Enter). */
  const listKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || !(e.target as HTMLElement).closest('[role="option"]')) return;
    if (e.key === 'Insert') { e.preventDefault(); addPreset('blip'); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(); }
    else if (!e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicate(); }
  };

  // ------------------------------------------------------------- toolbar
  const groups: ToolbarGroup[] = [
    {
      label: 'Sound',
      items: [
        { kind: 'button', id: 'emu', label: 'Play in emulator', text: 'Play in emulator', icon: 'vm-running', onActivate: () => void client.request('playInEmulator', { effect: si }).catch((e: Error) => setMsg({ severity: 'error', text: e.message })) },
        { kind: 'button', id: 'use', label: 'Insert in code: a SfxPlay of this effect at the cursor of the open .bas (and the includes and SfxInit, once)', text: 'Insert in code', icon: 'symbol-snippet', onActivate: () => void client.request('insertUse', { effect: si }).catch((e: Error) => setMsg({ severity: 'error', text: e.message })) },
      ],
    },
    {
      label: 'Help',
      items: [{ kind: 'button', id: 'help', label: 'Keyboard shortcuts', icon: 'question', shortcut: '?', onActivate: () => setHelp(true) }],
    },
    {
      label: 'More',
      items: [{ kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis', items: [{ id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) }] }],
    },
  ];

  // ------------------------------------------------------------- notices
  const notices = [];
  if (view.saveProblem) notices.push(<Notice key="save" severity="error">{view.saveProblem}. Saving is disabled until this is fixed.</Notice>);
  const problems = vt2Problems(doc);
  for (const text of problems.slice(0, 3)) notices.push(<Notice key={`p${text}`} severity="warning">{text}. The build cannot make this bank until it is fixed.</Notice>);
  if (problems.length > 3) notices.push(<Notice key="pmore" severity="warning">{problems.length - 3} more problems.</Notice>);
  if (msg) notices.push(<Notice key="msg" severity={msg.severity} onDismiss={() => setMsg(null)}>{msg.text}</Notice>);

  // --------------------------------------------------------------- props
  const takenName = (n: string): string | undefined => {
    const clash = doc.effects.findIndex((x, k) => k !== si && x.name.toLowerCase() === n.toLowerCase());
    return clash >= 0 ? `Already used by effect ${clash + 1}` : undefined;
  };
  const preset = effect.preset;
  const pr = preset?.params;
  const sidebar = (
    <PropertyPanel label="Effect properties">
      <div class="cb-card-stack">
        <Card title="Effect">
          <NameField value={effect.name} taken={takenName} onCommit={(name) => void edit({ op: 'rename', effect: si, name })} />
          <div class="sx-const">
            <span class="cb-label" id="sx-const-l">Constant</span>
            <StatPill title="The build makes this constant from the bank and effect names; SfxPlay takes it">{`${sfxConstName(view.bank, effect.name)} = ${si + 1}`}</StatPill>
          </div>
          {!preset && (
            <NumberField id="sx-len" label="Length (frames)" value={frames.length} min={1} max={250} pageStep={10} bigStep={10} description="Longer copies the last frame." onCommit={(n) => void edit({ op: 'resize', effect: si, length: n })} />
          )}
        </Card>
        <Card title={preset ? 'Preset' : 'Drawn by hand'}>
          {preset && pr ? (
            <>
              <KindGrid value={preset.kind} onChange={(kind) => { if (kind !== preset.kind) void edit({ op: 'setPreset', effect: si, kind, params: pr }); }} />
              <ParamSlider id="sx-start" label="Start note" value={pr.start} min={24} max={107} step={1} format={(v) => `${noteName(v)} (${v})`} onCommit={(v) => setParams({ ...pr, start: v })} />
              <ParamSlider id="sx-slide" label="Slide" value={pr.slide} min={-83} max={83} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} semitones`} onCommit={(v) => setParams({ ...pr, slide: v })} />
              <ParamSlider id="sx-length" label="Length" value={pr.length} min={MIN_LENGTH} max={MAX_LENGTH} step={1} format={(v) => `${v} frames`} onCommit={(v) => setParams({ ...pr, length: v })} />
              <ParamSlider id="sx-noise" label="Noise" value={pr.noise} min={0} max={1} step={0.05} format={(v) => (v === 0 ? 'none' : v === 1 ? 'noise only' : `${Math.round(v * 100)}%`)} onCommit={(v) => setParams({ ...pr, noise: v })} />
              <ParamSlider id="sx-rough" label="Roughness" value={pr.rough} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setParams({ ...pr, rough: v })} />
              <div class="cb-row">
                <Pill size="sm" icon="discard" text="Reset sliders" label="Reset sliders" onClick={() => void edit({ op: 'setPreset', effect: si, kind: preset.kind, params: DEFAULT_PARAMS[preset.kind] })} />
              </div>
              <p class="cb-muted">Drawing any frame by hand removes the preset.</p>
            </>
          ) : (
            <>
              <p class="cb-muted">The frames were edited by hand, so there are no sliders.</p>
              <SelectField
                id="sx-from"
                label="Replace the frames with a preset"
                value=""
                options={[{ value: '', label: 'Choose a preset...' }, ...PRESET_KINDS.map((k) => ({ value: k as string, label: PRESET_LABELS[k] }))]}
                onChange={(k) => { if (k) void edit({ op: 'setPreset', effect: si, kind: k as PresetKind, params: DEFAULT_PARAMS[k as PresetKind] }); }}
              />
            </>
          )}
        </Card>
        <p class="cb-muted">The preview is a model of the CPC's AY chip: close, not exact.</p>
      </div>
    </PropertyPanel>
  );

  const f = frames[cur];
  const status = [
    { id: 'effect', value: `effect ${si + 1} of ${doc.effects.length}` },
    { id: 'frame', value: `frame ${cur + 1} of ${frames.length}` },
    { id: 'note', value: `${noteName(f.pitch)} ${f.pitch.toFixed(2)}, period ${period(f.pitch, CLOCKS.cpc)}` },
    { id: 'vol', value: `volume ${f.volume}` },
    { id: 'mix', value: `${f.tone ? 'tone' : ''}${f.tone && f.noise ? ' + ' : ''}${f.noise ? `noise ${f.noisePeriod}` : f.tone ? '' : 'silent'}` },
  ];

  const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
  const items: ShelfItem[] = doc.effects.map((e, i) => ({
    id: String(i),
    badge: String(i + 1),
    colour: i + 1,
    name: e.name,
    meta: `${plural(e.frames.length, 'frame')} \u00b7 ${e.preset ? PRESET_LABELS[e.preset.kind] : 'drawn'}`,
    shape: shelfShape(e.frames),
  }));
  const full9 = doc.effects.length >= 9;
  const shelfActions = (
    <>
      <AddMenu
        disabled={full9}
        why="a bank has at most 9 effects"
        items={[
          ...PRESET_KINDS.map((k) => ({ id: `add-${k}`, label: PRESET_LABELS[k], onActivate: () => addPreset(k) })),
          { id: 'add-blank', label: 'Blank (draw it yourself)', onActivate: addBlank },
        ]}
      />
      <Pill size="sm" icon="copy" text="Duplicate" label="Duplicate effect" shortcut="D in the list" disabled={full9} why="a bank has at most 9 effects" onClick={duplicate} />
      <Pill size="sm" icon="trash" label="Delete effect" shortcut="Delete in the list" disabled={doc.effects.length <= 1} why="a bank needs one effect" onClick={remove} />
      <Pill size="sm" icon="arrow-up" label="Move effect up" shortcut="Alt+Up in the list" disabled={si === 0} why="it is the first" onClick={() => move(si - 1)} />
      <Pill size="sm" icon="arrow-down" label="Move effect down" shortcut="Alt+Down in the list" disabled={si >= doc.effects.length - 1} why="it is the last" onClick={() => move(si + 1)} />
    </>
  );

  const hint = mode === 'line' ? 'Click or drag draws a straight line from the last point. Hold Shift to draw freely.' : 'Click or drag to draw. Hold Shift for a straight line from the last point.';
  const cellIdx = ZOOMS.indexOf(cellW);

  return (
    <div class="sx">
      <h1 class="cb-visually-hidden">Sound effects {view.fileName}</h1>
      <div class="sx-top">
        <div class="sx-top-l">
          <BankPill bank={view.bank} />
          <span class="cb-muted">{doc.effects.length} of 9 effects</span>
        </div>
        <Toolbar label="Sound effects editor" groups={groups} look="pills" onEscape={() => document.querySelector<HTMLElement>('.cb-shelf-card[aria-selected="true"]')?.focus()} />
      </div>
      {notices}
      {help && <Help onClose={() => setHelp(false)} />}
      <div class="sx-body">
        <div class="sx-shelf" onKeyDown={listKey as never}>
          <Shelf
            label="Effects"
            items={items}
            selected={String(si)}
            narrowChips={narrow}
            onSelect={(id) => select(Number(id))}
            onMove={(_id, d) => move(si + d, true)}
            actions={shelfActions}
          />
          <p class="cb-muted sx-foot">The number is the index for SfxPlay. A bank holds up to 9 effects.</p>
        </div>
        <div class="sx-main">
          <div class="sx-lanebar">
            <SegPill<DrawMode> label="Drawing mode" size="sm" value={mode} options={[{ value: 'draw', label: 'Draw' }, { value: 'line', label: 'Line' }]} onChange={setMode} />
            <span class="cb-muted sx-hint">{hint}</span>
            <span class="sx-lanebar-gap" />
            <span class="cb-label" id="sx-zoom-l">Zoom</span>
            <Pill size="sm" icon="zoom-out" label="Zoom time axis out" shortcut="-" disabled={cellIdx <= 0} why="smallest zoom" onClick={() => zoom(-1)} />
            <Pill size="sm" icon="zoom-in" label="Zoom time axis in" shortcut="=" disabled={cellIdx >= ZOOMS.length - 1} why="largest zoom" onClick={() => zoom(1)} />
            <SegPill<string> label="Pitch range" size="sm" value={full ? 'all' : 'fit'} options={[{ value: 'fit', label: 'Fit', title: 'Fit the pitch range to the effect (F)' }, { value: 'all', label: 'All notes', title: 'Show all notes, C-1 to B-7 (F)' }]} onChange={(v) => { if ((v === 'all') !== full) togglePitchRange(); }} />
          </div>
          <Lanes
            key={si}
            frames={frames}
            name={effect.name}
            cellW={cellW}
            range={range}
            mode={mode}
            cursor={cur}
            playFrame={playFrame}
            onCursor={setCursor}
            onCommit={commitFrames}
            onInsertFrame={(at) => void edit({ op: 'insertFrame', effect: si, at }).then((ok) => ok && setCursor(at + 1))}
            onDeleteFrame={(at) => void edit({ op: 'deleteFrame', effect: si, at })}
          />
          <div class="sx-podrow">
            <TransportPod
              label="Playback"
              buttons={[
                { id: 'play', label: 'Play', icon: 'play', main: true, shortcut: 'Space', onActivate: play },
                { id: 'stop', label: 'Stop', icon: 'debug-stop', shortcut: 'Esc', disabled: playFrame === null, why: 'nothing is playing', onActivate: stop },
              ]}
            >
              <span class="cb-pod-readout">
                <span class="cb-pod-big">{frames.length}</span>
                <span class="cb-pod-unit">{frames.length === 1 ? 'frame =' : 'frames ='}</span>
                <span class="cb-pod-big">{lengthMs(effect)}</span>
                <span class="cb-pod-unit">ms</span>
              </span>
            </TransportPod>
            <span class="sx-playing">
              {audioOn ? (playFrame === null ? 'Space plays, Esc stops' : `playing frame ${playFrame + 1} of ${frames.length}`) : 'Click or press Space for sound'}
            </span>
            <span class="cb-visually-hidden" role="status" aria-live="polite">{live}</span>
          </div>
        </div>
        <div class="sx-side">{sidebar}</div>
      </div>
      <StatusLine fields={status} hint="Click or drag the lanes; Shift flips Draw and Line; arrows move and change values; Space plays; ? lists every key" />
    </div>
  );
}

startEditor(createClient<SfxRequests, SfxView>(), SfxApp);
