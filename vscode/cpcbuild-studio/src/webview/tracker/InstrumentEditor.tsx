/**
 * The instrument editor of the tracker: a view that replaces the grid area. Left, the custom instruments (New,
 * Duplicate, Delete) and the built-ins to start from; centre, the lanes (pitch offset, volume, tone, noise, noise
 * period) with a loop band; right, the instrument's name, description, colour, length, loop and a test note.
 * Built-ins are shown read-only. Every change goes through the `updateInstrument` op, one undo step per gesture.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { INSTRUMENT_COLOURS, MAX_DESCRIPTION, MAX_FRAMES, MAX_NAME, songNoteName, type InstrumentColour, type SongDoc, type SongInstrument } from '../../core/songDoc';
import { BUILTINS, instrumentOf } from '../../core/songInstruments';
import type { InstrumentPatch, SongOp } from '../../core/songOps';
import { Icon } from '../shared/components/Icon';
import { Field, NumberField, PropertyPanel } from '../shared/components/PropertyPanel';
import { Card } from '../shared/components/Card';
import { Pill } from '../shared/components/Pill';
import { SegPill } from '../shared/components/SegPill';
import { Shelf, type ShelfItem } from '../shared/components/Shelf';
import { Lanes } from '../shared/lanes/Lanes';
import { MAX_OFFSET, fitOffsetRange, type DrawMode } from '../shared/lanes/curve';
import { rovingNext } from '../shared/roving';
import { idIndex, idVar } from '../shared/theme';
import {
  deleteFramePatch, durationLabel, insertFramePatch, instrumentNameProblem, instrumentUsage, loopSummary, loopText, nextCustomId, parseLoopText, replaceFrames, resizePatch, usageLabel,
} from './instLogic';
import { envelopeShape, keyNoteLabel, noteForCode } from './logic';
import './instrument.css';

const ZOOMS = [6, 8, 12, 16, 24, 32];
const defaultZoom = (frames: number): number => (frames <= 16 ? 32 : frames <= 32 ? 24 : frames <= 64 ? 12 : 8);
const FULL_RANGE = { lo: -MAX_OFFSET, hi: MAX_OFFSET };
const MIDDLE_C = 60;
const inField = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface InstrumentEditorProps {
  doc: SongDoc;
  /** The instrument shown: a built-in or a custom one. */
  id: string;
  /** The built-in that New copies; also the highlighted chip. */
  starter: string;
  octave: number;
  narrow: boolean;
  /** code -> character on this keyboard layout, for the test note keycap. */
  layout: Map<string, string> | undefined;
  edit(op: SongOp): Promise<boolean>;
  onSelect(id: string): void;
  onStarter(id: string): void;
  onBack(): void;
  /** Plays a note with the instrument `id` (a held note rings until stopAudition). */
  audition(id: string, note: number, hold: boolean): void;
  stopAudition(): void;
  announce(text: string): void;
}

/** A one-line text field: commit on blur or Enter, Esc reverts, a refused value stays in the field with its message. */
function TextField(p: { id: string; label: string; value: string; max: number; description?: string; disabled?: boolean; check?(t: string): string | undefined; onCommit(t: string): void }) {
  const [text, setText] = useState(p.value);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(p.value); setError(undefined); }, [p.value]);
  const commit = (): void => {
    const msg = p.check?.(text);
    setError(msg);
    if (!msg && text !== p.value) p.onCommit(text);
  };
  return (
    <Field id={p.id} label={p.label} description={p.description} error={error}>
      <input
        id={p.id}
        class="cb-input"
        value={text}
        maxLength={p.max}
        spellcheck={false}
        disabled={p.disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={[p.description ? `${p.id}-desc` : '', error ? `${p.id}-err` : ''].filter(Boolean).join(' ') || undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape' && text !== p.value) { e.stopPropagation(); setText(p.value); setError(undefined); }
        }}
      />
    </Field>
  );
}

/** The loop start in ticks counted from 1, or "none". */
function LoopField(p: { inst: SongInstrument; disabled: boolean; onCommit(loop: number | null): void }) {
  const shown = loopText(p.inst.loop);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => { setText(shown); setError(undefined); }, [shown, p.inst.frames.length]);
  const commit = (): void => {
    const r = parseLoopText(text, p.inst.frames.length);
    if ('error' in r) { setError(r.error); return; }
    setError(undefined);
    if (r.loop !== (p.inst.loop ?? null)) p.onCommit(r.loop);
    else setText(shown);
  };
  return (
    <Field id="in-loop" label="Loop from tick" description="A tick number, or none to play once." error={error}>
      <input
        id="in-loop"
        class="cb-input cb-number"
        type="text"
        value={text}
        disabled={p.disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={['in-loop-desc', error ? 'in-loop-err' : ''].filter(Boolean).join(' ')}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape' && text !== shown) { e.stopPropagation(); setText(shown); setError(undefined); }
        }}
      />
    </Field>
  );
}

/** The twelve identity colours as a radiogroup; each shows its name (the swatch alone would not say it). */
function ColourGroup({ value, disabled, onChange }: { value: InstrumentColour; disabled: boolean; onChange(c: InstrumentColour): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | undefined>();
  const cur = INSTRUMENT_COLOURS.indexOf(value);
  const tabbable = focused ?? Math.max(0, cur);
  return (
    <div class="in-colours" role="radiogroup" aria-label="Colour" ref={root}>
      {INSTRUMENT_COLOURS.map((c, i) => (
        <button
          key={c}
          type="button"
          role="radio"
          class="cb-pill cb-chip cb-pill-sm in-colour"
          aria-checked={c === value}
          aria-disabled={disabled ? 'true' : undefined}
          tabIndex={i === tabbable ? 0 : -1}
          style={{ '--cb-id': idVar(idIndex(c) ?? 11) } as never}
          onFocus={() => setFocused(i)}
          onClick={() => { if (!disabled) onChange(c); }}
          onKeyDown={(e) => {
            const n = rovingNext(INSTRUMENT_COLOURS.length, i, e.key);
            if (n === undefined) return;
            e.preventDefault();
            if (!disabled) onChange(INSTRUMENT_COLOURS[n]);
            root.current?.querySelectorAll<HTMLElement>('[role="radio"]')[n]?.focus();
          }}
        >
          <span class="in-dot" aria-hidden="true" />
          <span>{cap(c)}</span>
          {c === value && <Icon name="check" />}
        </button>
      ))}
    </div>
  );
}

/** The ten built-ins as chips: pick one to look at it (read-only) and to start New from. */
function BuiltinChips({ starter, onPick }: { starter: string; onPick(id: string): void }) {
  const root = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState<number | undefined>();
  const cur = BUILTINS.findIndex((b) => b.id === starter);
  const tabbable = focused ?? Math.max(0, cur);
  return (
    <div class="in-chips" role="group" aria-label="Start from a built-in" ref={root}>
      {BUILTINS.map((b, i) => (
        <button
          key={b.id}
          type="button"
          class="cb-pill cb-chip cb-pill-sm in-chip"
          aria-pressed={b.id === starter}
          aria-label={`${b.name}, built-in ${b.id}`}
          tabIndex={i === tabbable ? 0 : -1}
          style={{ '--cb-id': idVar(idIndex(b.colour) ?? 11) } as never}
          onFocus={() => setFocused(i)}
          onClick={() => onPick(b.id)}
          onKeyDown={(e) => {
            const n = rovingNext(BUILTINS.length, i, e.key, { axis: 'horizontal' });
            if (n === undefined) return;
            e.preventDefault();
            root.current?.querySelectorAll<HTMLElement>('button')[n]?.focus();
          }}
        >
          <span class="in-dot" aria-hidden="true" />
          <span aria-hidden="true">{b.name}</span>
        </button>
      ))}
    </div>
  );
}

export function InstrumentEditor(p: InstrumentEditorProps) {
  const { doc } = p;
  const inst = instrumentOf(doc, p.id) ?? BUILTINS[0];
  const custom = doc.instruments.some((i) => i.id === inst.id);
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<DrawMode>('draw');
  const [cellW, setCellW] = useState(defaultZoom(inst.frames.length));
  const [full, setFull] = useState(false);
  const [fitted, setFitted] = useState(() => fitOffsetRange(inst.frames));
  const [lastNote, setLastNote] = useState<number>(MIDDLE_C);
  const hold = useRef(false);
  const cur = Math.min(cursor, inst.frames.length - 1);
  // a different instrument: refit the pitch range and start at the first tick
  useEffect(() => { setFitted(fitOffsetRange(inst.frames)); setCursor(0); }, [inst.id]);
  const grown = fitOffsetRange(inst.frames);
  const range = full ? FULL_RANGE : { lo: Math.min(fitted.lo, grown.lo), hi: Math.max(fitted.hi, grown.hi) };
  const usage = instrumentUsage(doc, inst.id);
  const starter = BUILTINS.find((b) => b.id === p.starter) ?? BUILTINS[0];

  const patch = (pt: InstrumentPatch): Promise<boolean> => p.edit({ op: 'updateInstrument', id: inst.id, patch: pt });
  const commitFrames = async (start: number, slice: SongInstrument['frames']): Promise<void> => {
    await patch({ frames: replaceFrames(inst.frames, start, slice) });
  };
  const makeCopy = (fromId: string): void => {
    const id = nextCustomId(doc.instruments);
    void p.edit({ op: 'addInstrument', fromId }).then((ok) => {
      if (ok && id) {
        p.onSelect(id);
        p.announce(`Made a copy: instrument ${id}`);
      }
    });
  };
  const remove = (): void => {
    if (!custom) return;
    const k = doc.instruments.findIndex((i) => i.id === inst.id);
    const next = doc.instruments[k + 1]?.id ?? doc.instruments[k - 1]?.id ?? starter.id;
    void p.edit({ op: 'deleteInstrument', id: inst.id }).then((ok) => {
      if (ok) {
        p.onSelect(next);
        p.announce('Instrument deleted');
      }
    });
  };
  const zoom = (d: number): void => {
    const i = ZOOMS.indexOf(cellW);
    setCellW(ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + d))]);
  };

  // typing a note key plays the instrument at that note; Space plays C-4, Shift+Space holds it while pressed
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.keyCode === 229 || inField(e.target)) return;
      if (e.code === 'Space') {
        if ((e.target as HTMLElement).closest?.('button, [role="option"], [role="radio"], [role="menuitem"]')) return;
        e.preventDefault();
        if (e.repeat) return;
        hold.current = e.shiftKey;
        setLastNote(MIDDLE_C);
        p.audition(inst.id, MIDDLE_C, e.shiftKey);
        return;
      }
      if (e.shiftKey) return;
      const n = noteForCode(e.code, p.octave);
      if (typeof n !== 'number') return;
      e.preventDefault();
      if (e.repeat) return;
      setLastNote(n);
      p.audition(inst.id, n, false);
    };
    const up = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && hold.current) {
        hold.current = false;
        p.stopAudition();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  const customItems: ShelfItem[] = doc.instruments.map((i) => ({
    id: i.id, badge: i.id, colour: idIndex(i.colour) ?? 11, name: i.name, meta: `${i.frames.length} ticks`, shape: envelopeShape(i),
  }));
  const kind = custom ? 'custom' : 'built-in';
  const lanesHint = custom ? 'Click or drag to set a tick. Shift+drag draws a straight line.' : 'Built-in instruments cannot be changed. Make a copy to edit.';
  const keyLetter = (p.layout?.get('KeyZ') ?? 'Z').toUpperCase();

  return (
    <div class="in">
      <div class="in-head">
        <Pill size="sm" icon="arrow-left" text="Back to the song" label="Back to the song" onClick={p.onBack} />
        <nav class="in-crumbs" aria-label="Breadcrumb">
          <ol>
            <li>Song</li>
            <li>Instruments</li>
            <li aria-current="page"><strong>{inst.name}</strong></li>
          </ol>
        </nav>
        <span class="in-meta cb-muted">{inst.id} · {kind} · {usageLabel(usage)}</span>
        <span class="in-gap" />
        <Pill size="sm" icon="play" text="Hear it" label="Hear it at C-4" shortcut="Space" onClick={() => { setLastNote(MIDDLE_C); p.audition(inst.id, MIDDLE_C, false); }} />
      </div>
      <div class="in-body">
        <div class="in-list">
          <span class="cb-label" id="in-custom-l">Custom</span>
          {customItems.length ? (
            <Shelf label="Custom instruments" items={customItems} selected={custom ? inst.id : undefined} narrowChips={p.narrow} onSelect={p.onSelect} />
          ) : (
            <p class="cb-muted in-none">No custom instruments yet. Pick a built-in below and press New.</p>
          )}
          <div class="in-acts">
            <Pill size="sm" icon="add" text="New" label={`New instrument, a copy of ${starter.name}`} onClick={() => makeCopy(starter.id)} />
            <Pill size="sm" icon="copy" text="Duplicate" label={`Duplicate ${inst.name}`} onClick={() => makeCopy(inst.id)} />
            <Pill size="sm" icon="trash" text="Delete" label={`Delete ${inst.name}`} disabled={!custom} why={custom ? undefined : 'built-in instruments cannot be deleted'} onClick={remove} />
          </div>
          <span class="cb-label" id="in-builtin-l">Start from a built-in</span>
          <BuiltinChips starter={p.starter} onPick={(id) => { p.onStarter(id); p.onSelect(id); }} />
          <p class="cb-muted in-foot">Slots B to V are custom: a song can use up to 22 instruments in all.</p>
        </div>
        <div class="in-main">
          <div class="in-lanebar">
            <span class="cb-label" id="in-tool-l">Tool</span>
            <SegPill<DrawMode> label="Drawing tool" size="sm" value={mode} options={[{ value: 'draw', label: 'Draw' }, { value: 'line', label: 'Line' }]} onChange={setMode} />
            <span class="cb-muted in-hint">{lanesHint}</span>
            <span class="in-gap" />
            <Pill size="sm" icon="zoom-out" label="Zoom time axis out" disabled={cellW <= ZOOMS[0]} why="smallest zoom" onClick={() => zoom(-1)} />
            <Pill size="sm" icon="zoom-in" label="Zoom time axis in" disabled={cellW >= ZOOMS[ZOOMS.length - 1]} why="largest zoom" onClick={() => zoom(1)} />
            <SegPill<string> label="Pitch range" size="sm" value={full ? 'all' : 'fit'} options={[{ value: 'fit', label: 'Fit' }, { value: 'all', label: 'All', title: 'Show the full -48 to +48 range' }]} onChange={(v) => setFull(v === 'all')} />
          </div>
          {!custom && (
            <div class="in-ro" role="note">
              <Icon name="lock" />
              <span>{inst.name} is built in, so its lanes are read-only.</span>
              <Pill size="sm" icon="copy" text="Make a copy" label={`Make a copy of ${inst.name}`} variant="primary" onClick={() => makeCopy(inst.id)} />
            </div>
          )}
          <Lanes
            key={inst.id}
            frames={inst.frames}
            name={inst.name}
            pitchMode="offset"
            readOnly={!custom}
            loop={inst.loop ?? null}
            onLoop={(at) => void patch({ loop: at })}
            cellW={cellW}
            range={range}
            mode={mode}
            cursor={cur}
            playFrame={null}
            onCursor={setCursor}
            onCommit={(start, frames) => commitFrames(start, frames)}
            onInsertFrame={custom ? (at) => { const pt = insertFramePatch(inst, at); if (pt) void patch(pt).then((ok) => ok && setCursor(at + 1)); } : undefined}
            onDeleteFrame={custom ? (at) => { const pt = deleteFramePatch(inst, at); if (pt) void patch(pt); } : undefined}
          />
        </div>
        <div class="in-side">
          <PropertyPanel label="Instrument properties">
            <div class="cb-card-stack">
              <Card title="Instrument">
                <TextField id="in-name" label="Name" value={inst.name} max={MAX_NAME} disabled={!custom} check={(t) => instrumentNameProblem(t, MAX_NAME)} onCommit={(name) => void patch({ name })} />
                <TextField id="in-desc" label="Description (shown on the shelf)" value={inst.description} max={MAX_DESCRIPTION} disabled={!custom} onCommit={(description) => void patch({ description })} />
                <div class="cb-field">
                  <span class="cb-label" id="in-colour-l">Colour</span>
                  <ColourGroup value={inst.colour} disabled={!custom} onChange={(colour) => { void patch({ colour }); p.announce(`Colour ${colour}`); }} />
                </div>
              </Card>
              <Card title="Timing">
                <NumberField id="in-len" label="Length (ticks)" value={inst.frames.length} min={1} max={MAX_FRAMES} pageStep={10} bigStep={10} disabled={!custom} description="Longer repeats the last tick." onCommit={(n) => { const pt = resizePatch(inst, n); if (pt) void patch(pt); }} />
                <LoopField inst={inst} disabled={!custom} onCommit={(loop) => void patch({ loop })} />
                <p class="in-dur">{durationLabel(inst.frames.length)}</p>
                <p class="cb-muted in-loopsum">{loopSummary(inst)}</p>
              </Card>
              <Card title="Test note">
                <div class="in-test">
                  <kbd class="cb-kbd cb-kbd-big in-keycap" aria-hidden="true">
                    <span class="in-key-l">{keyLetter}</span>
                    <span class="in-key-n">{keyNoteLabel('KeyZ', p.octave)}</span>
                  </kbd>
                  <p class="cb-muted">Type any note key (Z to M, Q to I) to hear {inst.name} at that pitch. Space plays C-4; hold Shift+Space to keep it sounding.</p>
                </div>
                <p class="cb-muted in-last" role="status">Last test note: {songNoteName(lastNote)}</p>
                <p class="cb-muted">Changes play straight away in the song. Undo works across the song and its instruments.</p>
              </Card>
            </div>
          </PropertyPanel>
        </div>
      </div>
    </div>
  );
}
