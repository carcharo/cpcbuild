/** Small parts of the tracker editor: a compact number field, the tempo field, pattern tabs, the pattern sequencer, the help dialog and the status row. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { patternLetter, type SongDoc } from '../../core/songDoc';
import { Icon } from '../shared/components/Icon';
import { Pill } from '../shared/components/Pill';
import { rovingNext } from '../shared/roving';
import { MAX_TEMPO_SPEED, MIN_TEMPO_SPEED, speedFromTyped, stepSpeed, tempoLabel, ticksLabel } from './logic';

/** A labelled whole-number field on one line: commit on Enter or blur, Esc reverts, Up / Down step, an invalid value is held with a message. */
export function MiniNumber(p: { id: string; label: string; value: number; min: number; max: number; width?: number; onCommit(n: number): void }) {
  const [text, setText] = useState(String(p.value));
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(String(p.value)); setError(undefined); }, [p.value]);
  const commit = (t: string): void => {
    const n = Number(t);
    let msg: string | undefined;
    if (t.trim() === '' || !Number.isInteger(n)) msg = 'Enter a whole number';
    else if (n < p.min || n > p.max) msg = `Enter ${p.min} to ${p.max}`;
    setError(msg);
    if (!msg && n !== p.value) p.onCommit(n);
  };
  const bump = (d: number): void => {
    const n = Math.max(p.min, Math.min(p.max, (Number.isInteger(Number(text)) ? Number(text) : p.value) + d));
    setText(String(n));
    commit(String(n));
  };
  return (
    <div class="tk-num">
      <label for={p.id} class="cb-label">{p.label}</label>
      <input
        id={p.id}
        class="cb-input cb-number tk-num-in"
        style={p.width ? { width: `${p.width}px` } : undefined}
        type="text"
        inputMode="numeric"
        value={text}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${p.id}-err` : undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(text);
          else if (e.key === 'Escape') { setText(String(p.value)); setError(undefined); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
        }}
      />
      {error && <span id={`${p.id}-err`} class="cb-field-error" role="alert">{error}</span>}
    </div>
  );
}

/** Tempo: - / + step through speeds 3-15 at the song's rows per beat, a typed BPM snaps to the nearest speed, and the ticks per row are shown. */
export function TempoField({ speed, rowsPerBeat, onSpeed }: { speed: number; rowsPerBeat: number; onSpeed(s: number): void }) {
  const shown = tempoLabel(speed, rowsPerBeat);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(shown); setError(undefined); }, [shown]);
  const commit = (): void => {
    const s = speedFromTyped(text, rowsPerBeat);
    if (s === undefined) { setError('Enter a tempo in beats per minute'); return; }
    setError(undefined);
    setText(tempoLabel(s, rowsPerBeat));
    if (s !== speed) onSpeed(s);
  };
  const slower = stepSpeed(speed, false);
  const faster = stepSpeed(speed, true);
  return (
    <div class="tk-tempo" role="group" aria-label="Tempo">
      <span class="cb-label" id="tk-tempo-l">Tempo</span>
      <Pill size="sm" icon="remove" label="Slower" disabled={slower === speed} why={`speed ${MAX_TEMPO_SPEED} is the slowest`} onClick={() => onSpeed(slower)} />
      <input
        class="cb-input cb-number tk-num-in tk-bpm"
        type="text"
        inputMode="decimal"
        aria-labelledby="tk-tempo-l"
        aria-describedby="tk-ticks"
        aria-invalid={error ? 'true' : undefined}
        value={text}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') { setText(shown); setError(undefined); }
        }}
      />
      <Pill size="sm" icon="add" label="Faster" disabled={faster === speed} why={`speed ${MIN_TEMPO_SPEED} is the fastest`} onClick={() => onSpeed(faster)} />
      <span class="cb-muted">BPM</span>
      <span class="cb-muted" id="tk-ticks">{ticksLabel(speed)}</span>
      {error && <span class="cb-field-error" role="alert">{error}</span>}
    </div>
  );
}

/** Pattern tabs A-P: a tablist with a roving tab stop; arrows move and select. */
export function PatternTabs({ doc, selected, onSelect }: { doc: SongDoc; selected: number; onSelect(i: number): void }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div class="tk-tabs" role="tablist" aria-label="Patterns" ref={root}>
      {doc.patterns.map((pt, i) => (
        <button
          key={i}
          type="button"
          role="tab"
          id={`tk-tab-${i}`}
          class="cb-pill cb-chip cb-pill-sm cb-pill-mono tk-tab"
          aria-selected={i === selected}
          aria-controls="tk-grid"
          aria-label={`Pattern ${patternLetter(i)}, ${pt.rows} rows`}
          tabIndex={i === selected ? 0 : -1}
          onClick={() => onSelect(i)}
          onKeyDown={(e) => {
            const n = rovingNext(doc.patterns.length, i, e.key, { axis: 'horizontal' });
            if (n === undefined) return;
            e.preventDefault();
            onSelect(n);
            root.current?.querySelectorAll<HTMLElement>('[role="tab"]')[n]?.focus();
          }}
        >
          {i === selected && <Icon name="check" />}
          {patternLetter(i)}
        </button>
      ))}
    </div>
  );
}

export interface SequencerProps {
  order: number[];
  loop: number;
  /** The selected step. */
  step: number;
  /** The step that is playing, or -1. */
  playing: number;
  onSelect(at: number): void;
  onRemove(at: number): void;
  onLoop(at: number): void;
  onMove(at: number, delta: -1 | 1): void;
}

/** The order list as chips: letter, a loop mark on the loop step, a remove button. Click selects, Alt+arrows move, L loops, Delete removes. */
export function Sequencer(p: SequencerProps) {
  const root = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(0);
  const tab = Math.min(focused, p.order.length - 1);
  const focusChip = (i: number): void => { setTimeout(() => root.current?.querySelectorAll<HTMLElement>('[data-seq]')[i]?.focus(), 0); };
  const onKeyDown = (e: KeyboardEvent, i: number): void => {
    if (e.ctrlKey || e.metaKey) return;
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const d = e.key === 'ArrowLeft' ? -1 : 1;
      const to = i + d;
      if (to >= 0 && to < p.order.length) { p.onMove(i, d); setFocused(to); focusChip(to); }
      return;
    }
    if (e.altKey || e.shiftKey) return;
    if (e.key === 'l' || e.key === 'L') { e.preventDefault(); p.onLoop(i); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); p.onRemove(i); focusChip(Math.max(0, Math.min(i, p.order.length - 2))); return; }
    const n = rovingNext(p.order.length, i, e.key, { axis: 'horizontal', wrap: false });
    if (n === undefined) return;
    e.preventDefault();
    setFocused(n);
    focusChip(n);
  };
  return (
    <div class="tk-seq" role="group" aria-label="Pattern sequencer" aria-labelledby="tk-seq-l" ref={root}>
      {p.order.map((pi, k) => {
        const sel = k === p.step;
        const letter = patternLetter(pi);
        return (
          <span key={k} class={`tk-chipwrap${k === p.playing ? ' tk-chip-playing' : ''}`}>
            <button
              type="button"
              class="cb-pill cb-chip cb-pill-sm cb-pill-mono tk-chip"
              data-seq={k}
              aria-pressed={sel}
              aria-current={k === p.playing ? 'true' : undefined}
              aria-label={`Step ${k + 1}, pattern ${letter}${k === p.loop ? ', loop point' : ''}${k === p.playing ? ', playing' : ''}`}
              tabIndex={k === tab ? 0 : -1}
              onFocus={() => setFocused(k)}
              onClick={() => p.onSelect(k)}
              onKeyDown={(e) => onKeyDown(e, k)}
            >
              {k === p.playing ? <Icon name="play" /> : sel ? <Icon name="check" /> : null}
              {letter}
              {k === p.loop && <Icon name="sync" />}
            </button>
            <button type="button" class="tk-chip-x" tabIndex={-1} aria-label={`Remove step ${k + 1} (pattern ${letter}) from the sequencer`} title="Remove from the sequencer" onClick={() => p.onRemove(k)}>
              <Icon name="close" />
            </button>
          </span>
        );
      })}
    </div>
  );
}

/** The status row of an editor, without the live-region role: a cursor move must not be read out (the grid names its cells itself). */
export function QuietStatus({ fields, hint }: { fields: { id: string; value: string }[]; hint: string }) {
  return (
    <div class="cb-status">
      <div class="cb-status-fields">
        {fields.filter((f) => f.value).map((f) => (
          <span key={f.id} class="cb-status-field"><span class="cb-status-value">{f.value}</span></span>
        ))}
      </div>
      <span class="cb-status-hint" tabIndex={0} role="note" title={hint} aria-label={hint}>?</span>
    </div>
  );
}

const HELP: [string, string][] = [
  ['Z S X D C V G B H N J M', 'Enter a note, C to B of the octave (the physical keys, so AZERTY and QWERTZ keep the layout)'],
  ['Q 2 W 3 E R 5 T 6 Y 7 U I', 'Enter a note, C to C of the octave above'],
  ['1', 'Enter a note off'],
  ['[ ]', 'Octave down / up'],
  ['Arrows', 'Move in the grid (left and right change channel; Tab leaves the grid)'],
  ['PgUp, PgDn, Home, End', 'A bar up / down, first row, last row'],
  ['Delete, Backspace', 'Clear the square (or the selected squares)'],
  ['Shift+arrows, Shift+click', 'Select a block of squares: one channel, or several next to each other'],
  ['Ctrl+C, Ctrl+X, Ctrl+V', 'Copy, cut and paste squares (Cmd on a Mac); a paste is cut off at the end of the pattern'],
  ['Ctrl+Up, Ctrl+Down', 'Transpose the selection (or the square) a semitone; add Shift for an octave'],
  ['Alt+Up, Alt+Down', 'Louder / quieter note in the square (adds a volume)'],
  ['Alt+M', 'Mute or unmute the cursor\'s channel (plain M is the note B)'],
  ['Space, Shift+Space', 'Play from the selected step / from the first step; Space again stops'],
  ['Esc', 'Stop (or close this help, or drop the selection)'],
  ['Ctrl+Alt+K', 'Show or hide the keycap board; typing notes works either way'],
  ['Sequencer chip: Alt+Left, Alt+Right', 'Move the step earlier / later'],
  ['Sequencer chip: L, Delete', 'Loop here / remove the step'],
  ['Instrument editor: note keys', 'Hear the instrument at that note (T and N toggle tone and noise while a lane has the focus)'],
  ['Instrument editor: Space, Shift+Space', 'Play C-4 / keep C-4 sounding while the keys are held'],
  ['Instrument editor lanes: L, Shift+L', 'Set the loop start at the cursor tick / remove the loop'],
];

export function Help({ onClose }: { onClose(): void }) {
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => btn.current?.focus(), []);
  return (
    <div class="tk-help" role="dialog" aria-label="Keyboard shortcuts" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div class="tk-help-h">
        <strong>Keyboard shortcuts</strong>
        <button type="button" class="cb-icon-btn" aria-label="Close shortcuts" onClick={onClose} ref={btn}><Icon name="close" /></button>
      </div>
      <dl>{HELP.map(([k, d]) => <div key={k}><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}</dl>
      <p class="cb-muted">Notes go in with the current instrument and then the cursor moves down by Step. Undo, Redo and Save are VS Code's: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S.</p>
    </div>
  );
}
