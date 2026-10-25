/** The sound-effects editor webview (.cpcsfx): effect list, pitch / volume / noise curves, properties, AY preview. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CLOCKS, PRESET_KINDS, PresetKind, PresetParams, SfxFrame, SfxTarget, lengthMs, nameProblem, noteName, period } from '../../core/sfxDoc';
import { DEFAULT_PARAMS, MAX_LENGTH, MIN_LENGTH, PRESET_LABELS } from '../../core/sfxPresets';
import { vt2Problems } from '../../core/vt2';
import type { SfxOp, SfxRequests, SfxView } from '../../shared/protocol';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Icon } from '../shared/components/Icon';
import { Notice } from '../shared/components/Notice';
import { Field, NumberField, PropertyPanel, Section, SelectField, Segmented } from '../shared/components/PropertyPanel';
import { StatusLine } from '../shared/components/StatusLine';
import { Toolbar, ToolbarGroup } from '../shared/components/Toolbar';
import { createSfxPlayer, type SfxPlayer } from '../shared/audio/sfxPlayer';
import { Curves } from './Curves';
import { fitPitchRange } from './curve';
import './sfx.css';

type Host = EditorHost<SfxRequests, SfxView>;

interface Persisted {
  target?: SfxTarget;
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
    ['Shift+drag', 'Draw a straight line from the last point you set on that lane'],
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

/** A slider that shows its value while it moves and edits the document when released. */
function ParamSlider(p: { id: string; label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onCommit(v: number): void }) {
  const [live, setLive] = useState(p.value);
  useEffect(() => setLive(p.value), [p.value]);
  const show = p.format ?? String;
  return (
    <Field id={p.id} label={`${p.label}: ${show(live)}`}>
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
    </Field>
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
    <Field id="sx-name" label="Name" description="The build makes the constant BANK_NAME from it." error={error}>
      <input
        id="sx-name"
        class="cb-input"
        value={text}
        maxLength={24}
        spellcheck={false}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={['sx-name-desc', error ? 'sx-name-err' : ''].filter(Boolean).join(' ')}
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
  const [target, setTarget] = useState<SfxTarget>(saved.target === 'spectrum' ? 'spectrum' : 'cpc');
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
  const frames = effect.frames;
  const cur = Math.min(cursor, frames.length - 1);
  const presetKey = effect.preset ? JSON.stringify(effect.preset) : '';
  const [fitted, setFitted] = useState(() => fitPitchRange(frames));
  const range = full ? FULL_RANGE : fitted;

  useEffect(() => client.setState({ target, cellW } satisfies Persisted), [target, cellW]);
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
      player.onEnded(() => setPlayFrame(null));
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
    audio.current?.player.play(frames, target).catch((e: Error) => {
      setPlayFrame(null);
      setMsg({ severity: 'error', text: `Cannot play: ${e.message}` });
    });
  };
  const stop = (): void => {
    audio.current?.player.stop();
    setPlayFrame(null);
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
  const move = (to: number): void => {
    if (to < 0 || to >= doc.effects.length) return;
    void edit({ op: 'move', from: si, to }).then((ok) => ok && setSel(to));
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

  const listKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const d = e.key === 'ArrowUp' ? -1 : 1;
      if (e.altKey) move(si + d);
      else select(si + d);
      queueMicrotask(() => document.querySelector<HTMLElement>('.sx-eff[aria-selected="true"]')?.focus());
    } else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); select(e.key === 'Home' ? 0 : doc.effects.length - 1); }
    else if (e.key === 'Insert') { e.preventDefault(); addPreset('blip'); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(); }
    else if (!e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicate(); }
  };

  // ------------------------------------------------------------- toolbar
  const emulatorWhy = 'Available after the build step';
  const groups: ToolbarGroup[] = [
    {
      label: 'History',
      items: [
        { kind: 'button', id: 'undo', label: 'Undo', icon: 'discard', disabled: !view.canUndo, why: 'nothing to undo', onActivate: () => void client.request('history', { action: 'undo' }) },
        { kind: 'button', id: 'redo', label: 'Redo', icon: 'redo', disabled: !view.canRedo, why: 'nothing to redo', onActivate: () => void client.request('history', { action: 'redo' }) },
      ],
    },
    {
      label: 'Effects',
      items: [
        {
          kind: 'menu',
          id: 'add',
          label: 'Add effect',
          text: 'Add',
          icon: 'add',
          disabled: doc.effects.length >= 9,
          why: 'a bank has at most 9 effects',
          items: [
            ...PRESET_KINDS.map((k) => ({ id: `add-${k}`, label: PRESET_LABELS[k], onActivate: () => addPreset(k) })),
            { id: 'add-blank', label: 'Blank (draw it yourself)', onActivate: addBlank },
          ],
        },
        { kind: 'button', id: 'dup', label: 'Duplicate effect', icon: 'copy', shortcut: 'D in the list', disabled: doc.effects.length >= 9, why: 'a bank has at most 9 effects', onActivate: duplicate },
        { kind: 'button', id: 'del', label: 'Delete effect', icon: 'trash', shortcut: 'Delete in the list', disabled: doc.effects.length <= 1, why: 'a bank needs one effect', onActivate: remove },
        { kind: 'button', id: 'up', label: 'Move effect up', icon: 'arrow-up', shortcut: 'Alt+Up in the list', disabled: si === 0, why: 'it is the first', onActivate: () => move(si - 1) },
        { kind: 'button', id: 'down', label: 'Move effect down', icon: 'arrow-down', shortcut: 'Alt+Down in the list', disabled: si >= doc.effects.length - 1, why: 'it is the last', onActivate: () => move(si + 1) },
      ],
    },
    {
      label: 'Sound',
      items: [
        { kind: 'button', id: 'play', label: 'Play', text: 'Play', icon: 'play', shortcut: 'Space', onActivate: play },
        { kind: 'button', id: 'stop', label: 'Stop', icon: 'debug-stop', shortcut: 'Esc', disabled: playFrame === null, why: 'nothing is playing', onActivate: stop },
        { kind: 'button', id: 'emu', label: 'Play in emulator', text: 'Play in emulator', icon: 'vm-running', disabled: true, why: emulatorWhy, onActivate: () => void client.request('playInEmulator', { effect: si }).catch((e: Error) => setMsg({ severity: 'info', text: e.message })) },
      ],
    },
    {
      label: 'View',
      items: [
        { kind: 'button', id: 'zout', label: 'Zoom time axis out', icon: 'zoom-out', shortcut: '-', disabled: cellW === ZOOMS[0], why: 'smallest zoom', onActivate: () => zoom(-1) },
        { kind: 'button', id: 'zin', label: 'Zoom time axis in', icon: 'zoom-in', shortcut: '=', disabled: cellW === ZOOMS[ZOOMS.length - 1], why: 'largest zoom', onActivate: () => zoom(1) },
        { kind: 'button', id: 'range', label: full ? 'Fit the pitch range to the effect' : 'Show all notes (C-1 to B-7)', icon: 'screen-full', shortcut: 'F', pressed: full, onActivate: togglePitchRange },
        { kind: 'button', id: 'help', label: 'Keyboard shortcuts', icon: 'question', shortcut: '?', onActivate: () => setHelp(true) },
      ],
    },
    {
      label: 'More',
      items: [{ kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis', items: [{ id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) }] }],
    },
  ];

  // ------------------------------------------------------------- notices
  const notices = [];
  if (view.saveProblem) notices.push(<Notice key="save" severity="error">{view.saveProblem}. Saving is disabled until this is fixed.</Notice>);
  const problems = vt2Problems(doc, target);
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
      <Section title="Effect">
        <NameField value={effect.name} taken={takenName} onCommit={(name) => void edit({ op: 'rename', effect: si, name })} />
        <p class="sx-length" aria-live="polite">{frames.length} {frames.length === 1 ? 'frame' : 'frames'} = {lengthMs(effect)} ms</p>
        {!preset && (
          <NumberField id="sx-len" label="Length (frames)" value={frames.length} min={1} max={250} pageStep={10} bigStep={10} description="Longer copies the last frame." onCommit={(n) => void edit({ op: 'resize', effect: si, length: n })} />
        )}
      </Section>
      <Section title={preset ? 'Preset' : 'Drawn by hand'}>
        {preset && pr ? (
          <>
            <SelectField id="sx-kind" label="Kind" value={preset.kind} options={PRESET_KINDS.map((k) => ({ value: k, label: PRESET_LABELS[k] }))} onChange={(kind) => void edit({ op: 'setPreset', effect: si, kind, params: pr })} />
            <ParamSlider id="sx-start" label="Start note" value={pr.start} min={24} max={107} step={1} format={(v) => `${noteName(v)} (${v})`} onCommit={(v) => setParams({ ...pr, start: v })} />
            <ParamSlider id="sx-slide" label="Slide" value={pr.slide} min={-83} max={83} step={1} format={(v) => `${v > 0 ? '+' : ''}${v} semitones`} onCommit={(v) => setParams({ ...pr, slide: v })} />
            <ParamSlider id="sx-length" label="Length" value={pr.length} min={MIN_LENGTH} max={MAX_LENGTH} step={1} format={(v) => `${v} frames`} onCommit={(v) => setParams({ ...pr, length: v })} />
            <ParamSlider id="sx-noise" label="Noise" value={pr.noise} min={0} max={1} step={0.05} format={(v) => (v === 0 ? 'none' : v === 1 ? 'noise only' : `${Math.round(v * 100)}%`)} onCommit={(v) => setParams({ ...pr, noise: v })} />
            <ParamSlider id="sx-rough" label="Roughness" value={pr.rough} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onCommit={(v) => setParams({ ...pr, rough: v })} />
            <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void edit({ op: 'setPreset', effect: si, kind: preset.kind, params: DEFAULT_PARAMS[preset.kind] })}>Reset sliders</button>
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
      </Section>
      <Section title="Preview">
        <Segmented<SfxTarget> label="Sound chip clock" value={target} options={[{ value: 'cpc', label: 'CPC 1 MHz' }, { value: 'spectrum', label: 'Spectrum 1.77 MHz' }]} onChange={setTarget} />
        <p class="cb-muted">The preview uses a model of the AY chip; it is close to the real sound, not the same.</p>
      </Section>
    </PropertyPanel>
  );

  const f = frames[cur];
  const status = [
    { id: 'effect', value: `effect ${si + 1} of ${doc.effects.length}` },
    { id: 'frame', value: `frame ${cur + 1} of ${frames.length}` },
    { id: 'note', value: `${noteName(f.pitch)} ${f.pitch.toFixed(2)}, period ${period(f.pitch, CLOCKS[target])}` },
    { id: 'vol', value: `volume ${f.volume}` },
    { id: 'mix', value: `${f.tone ? 'tone' : ''}${f.tone && f.noise ? ' + ' : ''}${f.noise ? `noise ${f.noisePeriod}` : f.tone ? '' : 'silent'}` },
  ];

  return (
    <div class="sx">
      <h1 class="cb-visually-hidden">Sound effects {view.fileName}</h1>
      <Toolbar label="Sound effects editor" groups={groups} onEscape={() => document.querySelector<HTMLElement>('.sx-eff[aria-selected="true"]')?.focus()} />
      {notices}
      {help && <Help onClose={() => setHelp(false)} />}
      <div class="sx-body">
        <div class="sx-list-wrap">
          <h2 class="sx-h" id="sx-list-h">Effects</h2>
          <div class="sx-list" role="listbox" aria-labelledby="sx-list-h" aria-orientation="vertical" onKeyDown={listKey as never}>
            {doc.effects.map((e, i) => (
              <div
                key={i}
                role="option"
                aria-selected={i === si}
                aria-label={`Effect ${i + 1}, ${e.name}, ${e.frames.length} frames`}
                tabIndex={i === si ? 0 : -1}
                class={`sx-eff${i === si ? ' sx-eff-on' : ''}`}
                onClick={() => select(i)}
              >
                <span class="sx-eff-n">{i + 1}</span>
                <span class="sx-eff-name">{e.name}</span>
                <span class="sx-eff-len">{e.frames.length} fr</span>
              </div>
            ))}
          </div>
        </div>
        <div class="sx-main">
          <div class="sx-audio" role="status">
            {audioOn ? (playFrame === null ? 'Space plays, Esc stops' : `Playing frame ${playFrame + 1} of ${frames.length}`) : 'Click or press Space for sound'}
          </div>
          <Curves
            key={si}
            frames={frames}
            effectName={effect.name}
            cellW={cellW}
            range={range}
            target={target}
            cursor={cur}
            playFrame={playFrame}
            onCursor={setCursor}
            onCommit={commitFrames}
            onInsertFrame={(at) => void edit({ op: 'insertFrame', effect: si, at }).then((ok) => ok && setCursor(at + 1))}
            onDeleteFrame={(at) => void edit({ op: 'deleteFrame', effect: si, at })}
          />
        </div>
        <div class="sx-side">{sidebar}</div>
      </div>
      <StatusLine fields={status} hint="Click or drag the lanes; Shift+drag draws a line; arrows move and change values; Space plays; ? lists every key" />
    </div>
  );
}

startEditor(createClient<SfxRequests, SfxView>(), SfxApp);
