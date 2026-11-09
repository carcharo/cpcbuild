/** The music tracker webview (.cpcsong): instrument shelf, pattern grid, transport, pattern sequencer and the keycap board. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { BUILTINS, instrumentOf } from '../../core/songInstruments';
import { patternLetter, type SongEvent } from '../../core/songDoc';
import { songToFrames, type SongFrames } from '../../core/songFrames';
import type { SongOp, SongRequests, SongView } from '../../shared/protocol';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Icon } from '../shared/components/Icon';
import { Notice } from '../shared/components/Notice';
import { Pill } from '../shared/components/Pill';
import { Shelf, type ShelfItem } from '../shared/components/Shelf';
import { ToggleChip } from '../shared/components/ToggleChip';
import { TransportPod } from '../shared/components/TransportPod';
import { Toolbar, type ToolbarGroup } from '../shared/components/Toolbar';
import { useTooltip } from '../shared/components/Tooltip';
import { createSfxPlayer, type SfxPlayer } from '../shared/audio/sfxPlayer';
import { idIndex, idVar } from '../shared/theme';
import { GRID_ID, Grid } from './Grid';
import { InstrumentEditor } from './InstrumentEditor';
import { SquaresBar } from './SquaresBar';
import { nextCustomId } from './instLogic';
import { clearOp, clipText, copyRect, inRect, isSingle, pasteFit, pasteOp, rectCells, rectLabel, selectionRect, transposeOp, clampRect, type Clip } from './squareOps';
import { KeyBoard, useLayoutMap } from './KeyBoard';
import { Help, MiniNumber, PatternTabs, QuietStatus, Sequencer, TempoField } from './Parts';
import {
  CHANNEL_LETTERS, DEFAULT_OCTAVE, MAX_OCTAVE, MAX_STEP, MIN_OCTAVE, auditionFrames, beatPos, bumpVolume, clampOctave, enterNote, envelopeShape, moveCursor, moveStepOp, noteForCode, playPlan, spokenNote, tempoLabel, ticksLabel,
  type Cursor, type PlayPlan,
} from './logic';
import './tracker.css';

type Host = EditorHost<SongRequests, SongView>;

/** The anchor of a block selection; the other corner is the cursor. It belongs to one pattern. */
type Anchor = { row: number; channel: number; pattern: number };

interface Persisted {
  octave?: number;
  step?: number;
  follow?: boolean;
}
interface Msg {
  severity: 'info' | 'warning' | 'error';
  text: string;
}
/** Where the playhead is: the step of the order, the pattern and the row. */
interface PlayPos {
  step: number;
  pattern: number;
  row: number;
}
interface Playing {
  kind: 'song' | 'audition';
  frames: SongFrames;
  /** The pattern played alone (it is not in the order), else -1. */
  solo: number;
  tick: number;
}

/** The AudioWorklet URL the host put in the page (#boot). */
function workletUrl(): string {
  try {
    return (JSON.parse(document.getElementById('boot')?.textContent || '{}') as { worklet?: string }).worklet ?? '';
  } catch {
    return '';
  }
}

const isNarrow = (): boolean => window.innerWidth <= 720;
const inField = (t: EventTarget | null): boolean => !!(t as HTMLElement | null)?.closest?.('input, textarea, select');

function SongName({ name }: { name: string }) {
  const tt = useTooltip();
  return (
    <>
      <span class="cb-pill cb-pill-mono tk-name" {...tt.props('name', 'Song name comes from the file name')}>{name}</span>
      {tt.node}
    </>
  );
}

function TrackerApp({ client, view }: Host) {
  const doc = view.doc;
  const saved = client.getState<Persisted>() ?? {};
  const rpb = doc.rowsPerBeat ?? 4;
  const [pat, setPat] = useState(0);
  const [stepSel, setStepSel] = useState(0);
  const [cursor, setCursor] = useState<Cursor>({ row: 0, channel: 0 });
  const [octave, setOctave] = useState(clampOctave(saved.octave ?? DEFAULT_OCTAVE));
  const [stepBy, setStepBy] = useState(Math.min(MAX_STEP, Math.max(0, saved.step ?? 1)));
  const [follow, setFollow] = useState(saved.follow === true);
  const [instId, setInstId] = useState('1');
  const [mute, setMute] = useState(0);
  const [narrow, setNarrow] = useState(isNarrow());
  const [keysPref, setKeysPref] = useState(view.keys);
  const [help, setHelp] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [live, setLive] = useState('');
  const [audioOn, setAudioOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState<PlayPos | null>(null);
  const [anchorRaw, setAnchor] = useState<Anchor | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  /** The instrument shown in the instrument editor, or null for the song. */
  const [instView, setInstView] = useState<string | null>(null);
  /** The built-in a New instrument copies. */
  const [starter, setStarter] = useState('1');
  const version = useRef(view.version);
  version.current = view.version;
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const audio = useRef<{ ctx: AudioContext; player: SfxPlayer } | null>(null);
  const play = useRef<Playing | null>(null);
  const muteRef = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const layout = useLayoutMap();

  // clamp what the document no longer has
  const pi = Math.min(pat, doc.patterns.length - 1);
  const pattern = doc.patterns[pi];
  const stepI = Math.min(stepSel, doc.order.length - 1);
  const cur: Cursor = { row: Math.min(cursor.row, pattern.rows - 1), channel: cursor.channel };
  const loop = Math.min(doc.loop ?? 0, doc.order.length - 1);
  const instruments = [...BUILTINS, ...doc.instruments];
  const inst = instrumentOf(doc, instId) ?? BUILTINS[0];
  const keysShown = keysPref[narrow ? 'narrow' : 'wide'] ?? !narrow;
  const anchor = anchorRaw && anchorRaw.pattern === pi ? { row: Math.min(anchorRaw.row, pattern.rows - 1), channel: anchorRaw.channel } : null;
  const rect = clampRect(selectionRect(anchor, cur), pattern.rows);
  const multi = anchor !== null && !isSingle(rect);
  const isCustom = doc.instruments.some((i) => i.id === inst.id);

  useEffect(() => client.setState({ octave, step: stepBy, follow } satisfies Persisted), [octave, stepBy, follow]);
  useEffect(() => {
    const on = (): void => setNarrow(isNarrow());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  /** A message for screen readers; the same text twice still counts as new. */
  const announce = (text: string): void => setLive((l) => (l === text ? `${text} ` : text));

  /** Sends an edit; edits are chained so each one quotes the version the previous one produced. */
  const edit = (op: SongOp, quiet = false): Promise<boolean> => {
    const run = async (): Promise<boolean> => {
      try {
        const r = await client.request('edit', { baseVersion: version.current, op });
        version.current = r.version;
        return true;
      } catch (e) {
        // "unchanged" from a square tool is not a failure: say so for screen readers and move on
        if (quiet && (e as Error).message === 'unchanged') announce('Nothing changed');
        else setMsg({ severity: 'error', text: (e as Error).message });
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
      player.setMute(muteRef.current);
      player.onFrame((n) => {
        const p = play.current;
        if (!p || p.kind !== 'song') return;
        p.tick = n;
        const r = p.frames.rowAt[n];
        if (!r) return;
        const next: PlayPos = { step: p.solo >= 0 ? -1 : r.step, pattern: r.pattern, row: r.row };
        setPos((old) => (old && old.step === next.step && old.pattern === next.pattern && old.row === next.row ? old : next));
      });
      player.onEnded(() => {
        if (play.current?.kind === 'song') {
          play.current = null;
          setPlaying(false);
          setPos(null);
        }
      });
      audio.current = { ctx, player };
      setAudioOn(true);
      return true;
    } catch (e) {
      setMsg({ severity: 'error', text: `Sound is not available: ${(e as Error).message}` });
      return false;
    }
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

  const fail = (what: string) => (e: Error): void => {
    play.current = null;
    setPlaying(false);
    setPos(null);
    setMsg({ severity: 'error', text: `${what}: ${e.message}` });
  };

  /** Starts the song (replacing anything playing) at `startRow` of the plan's start step. */
  const startSong = (plan: PlayPlan, startRow = 0): void => {
    if (!ensureAudio()) return;
    const frames = songToFrames(plan.doc, { startStep: plan.startStep, startRow });
    if (!frames.ticks.length) {
      announce('Nothing to play');
      return;
    }
    play.current = { kind: 'song', frames, solo: plan.solo ? plan.doc.order[0] : -1, tick: 0 };
    const r = frames.rowAt[0];
    setPos({ step: plan.solo ? -1 : r.step, pattern: r.pattern, row: r.row });
    setPlaying(true);
    audio.current?.player.playSong(frames).catch(fail('Cannot play'));
  };
  /** The instrument editor's test note: plays `note` with instrument `id` on channel A; `hold` lets it ring for about 20 s. */
  const auditionInstrument = (id: string, note: number, hold: boolean): void => {
    if (!ensureAudio()) return;
    play.current = { kind: 'audition', frames: auditionFrames(doc, note, id, 0, hold ? 1000 : 75), solo: -1, tick: 0 };
    audio.current?.player.playSong(play.current.frames).catch(fail('Cannot play'));
  };
  const stopAudition = (): void => {
    if (play.current?.kind !== 'audition') return;
    play.current = null;
    audio.current?.player.stop();
  };
  const stop = (): void => {
    if (!play.current) return;
    play.current = null;
    audio.current?.player.stop();
    setPlaying(false);
    setPos(null);
  };
  const togglePlay = (fromStart: boolean): void => {
    if (play.current?.kind === 'song') {
      stop();
      announce('Stopped');
      return;
    }
    startSong(fromStart ? { doc, startStep: 0, solo: false } : playPlan(doc, pi, stepI));
    announce(fromStart ? 'Playing from the start' : `Playing from step ${stepI + 1}`);
  };
  const toStart = (): void => {
    if (play.current?.kind === 'song') startSong({ doc, startStep: 0, solo: false });
    setStepSel(0);
    setPat(doc.order[0] ?? 0);
    setCursor({ row: 0, channel: cur.channel });
  };

  // an edit while the song plays restarts it from the row it is on
  const lastDoc = useRef(doc);
  useEffect(() => {
    if (lastDoc.current === doc) return;
    lastDoc.current = doc;
    const p = play.current;
    if (!p || p.kind !== 'song') return;
    const r = p.frames.rowAt[p.tick];
    if (!r) return;
    if (p.solo >= 0) {
      const sp = Math.min(p.solo, doc.patterns.length - 1);
      startSong({ doc: { ...doc, order: [sp], loop: 0 }, startStep: 0, solo: true }, r.row);
    } else startSong({ doc, startStep: r.step, solo: false }, r.row);
  }, [doc]);

  const setChannelMute = (mask: number): void => {
    muteRef.current = mask;
    setMute(mask);
    audio.current?.player.setMute(mask);
  };
  const toggleMute = (c: number): void => {
    const next = mute ^ (1 << c);
    setChannelMute(next);
    announce(`Channel ${CHANNEL_LETTERS[c]} ${(next & (1 << c)) !== 0 ? 'muted' : 'unmuted'}`);
  };

  // ------------------------------------------------------------- actions
  const focusGrid = (): void => { setTimeout(() => gridRef.current?.focus(), 0); };
  const selectPattern = (i: number): void => {
    setPat(i);
    if (doc.order[stepI] !== i) {
      const k = doc.order.indexOf(i);
      if (k >= 0) setStepSel(k);
    }
    setCursor((c) => ({ ...c, row: Math.min(c.row, doc.patterns[i].rows - 1) }));
  };
  const selectStep = (k: number): void => {
    setStepSel(k);
    setPat(doc.order[k]);
    if (play.current?.kind === 'song' && play.current.solo < 0) startSong({ doc, startStep: k, solo: false });
  };
  const newPattern = (): void => { void edit({ op: 'addPattern' }).then((ok) => { if (ok) selectPattern(doc.patterns.length); }); };
  const copyPattern = (): void => { void edit({ op: 'copyPattern', index: pi }).then((ok) => { if (ok) selectPattern(doc.patterns.length); }); };
  const deletePattern = (): void => { void edit({ op: 'deletePattern', index: pi }).then((ok) => { if (ok) setPat(Math.max(0, pi - 1)); }); };
  const changeOctave = (o: number): void => {
    const n = clampOctave(o);
    if (n === octave) return;
    setOctave(n);
    announce(`Octave ${n}`);
  };
  const setKeys = (shown: boolean): void => {
    const width = narrow ? 'narrow' : 'wide';
    setKeysPref((k) => ({ ...k, [width]: shown }));
    void client.request('setKeys', { width, shown }).catch(() => undefined);
  };
  const eventAt = (c: Cursor): SongEvent | undefined => pattern.channels[c.channel].find((e) => e.row === c.row);

  // ----------------------------------------------------- square tools
  const doCopy = (): void => {
    const c = copyRect(pattern, rect);
    setClip(c);
    try {
      void navigator.clipboard?.writeText(clipText(c)).catch(() => undefined);
    } catch {
      // the system clipboard is optional: the webview keeps its own copy
    }
    announce(`Copied ${rectLabel(rect)}`);
  };
  const doClear = (): void => {
    void edit(clearOp(pi, rect), true).then((ok) => { if (ok) announce(`Cleared ${rectLabel(rect)}`); });
  };
  const doPaste = (): void => {
    if (!clip) { announce('Nothing copied yet'); return; }
    const fit = pasteFit(clip, cur, pattern.rows);
    const op = pasteOp(clip, pi, cur, pattern.rows);
    if (!op) { announce('Nothing fits here'); return; }
    void edit(op, true).then((ok) => {
      if (!ok) return;
      announce(`Pasted ${fit.rows} row${fit.rows === 1 ? '' : 's'}${fit.clipped ? ', cut off at the end of the pattern' : ''}`);
      // the pasted block stays selected, ready to transpose
      if (fit.rows * fit.channels > 1) {
        setAnchor({ row: cur.row, channel: cur.channel, pattern: pi });
        setCursor({ row: cur.row + fit.rows - 1, channel: cur.channel + fit.channels - 1 });
      }
    });
  };
  const doTranspose = (n: number): void => {
    void edit(transposeOp(pi, rect, n), true).then((ok) => {
      if (ok) announce(`Transposed ${Math.abs(n) === 12 ? 'an octave' : `${Math.abs(n)} semitone${Math.abs(n) === 1 ? '' : 's'}`} ${n > 0 ? 'up' : 'down'}, ${rectLabel(rect)}`);
    });
  };
  const pickCell = (c: Cursor, extend: boolean): void => {
    if (extend) setAnchor((a) => (a && a.pattern === pi ? a : { row: cur.row, channel: cur.channel, pattern: pi }));
    else setAnchor(null);
    setCursor(c);
  };

  // ----------------------------------------------------------- instruments
  const copyInstrument = (openAfter: boolean): void => {
    const id = nextCustomId(doc.instruments);
    void edit({ op: 'addInstrument', fromId: inst.id }).then((ok) => {
      if (!ok || !id) return;
      setInstId(id);
      announce(`Made a copy: instrument ${id}`);
      if (openAfter) { stop(); setInstView(id); }
    });
  };
  const editInstrument = (): void => {
    if (isCustom) { stop(); setInstView(inst.id); } else copyInstrument(true);
  };
  const backToSong = (): void => { stopAudition(); setInstView(null); focusGrid(); };

  /** A note key (or a click on the board): writes the note, auditions it, moves down by Step. */
  const enter = (code: string): void => {
    const n = noteForCode(code, octave);
    if (n === undefined) return;
    setAnchor(null);
    const ev = enterNote(eventAt(cur), n, inst.id);
    void edit({ op: 'setCell', pattern: pi, channel: cur.channel, row: cur.row, event: ev });
    if (typeof n === 'number' && play.current?.kind !== 'song' && ensureAudio()) {
      play.current = { kind: 'audition', frames: auditionFrames(doc, n, inst.id, cur.channel), solo: -1, tick: 0 };
      audio.current?.player.playSong(play.current.frames).catch(fail('Cannot play'));
    }
    announce(n === 'off' ? `Note off, row ${cur.row + 1}, channel ${CHANNEL_LETTERS[cur.channel]}` : `${spokenNote(n)}, ${inst.name}, row ${cur.row + 1}, channel ${CHANNEL_LETTERS[cur.channel]}`);
    if (stepBy > 0) setCursor({ row: Math.min(pattern.rows - 1, cur.row + stepBy), channel: cur.channel });
  };

  // ------------------------------------------------------------ keyboard
  const onGridKey = (e: KeyboardEvent): void => {
    if (e.isComposing || e.keyCode === 229 || inField(e.target) || e.defaultPrevented) return;
    if (e.ctrlKey || e.metaKey) {
      // square tools; everything else (Ctrl+Z, Ctrl+S ...) is VS Code's
      if (e.altKey) return;
      if (e.code === 'KeyC' || e.code === 'KeyX') {
        e.preventDefault();
        doCopy();
        if (e.code === 'KeyX') doClear();
      } else if (e.code === 'KeyV') {
        e.preventDefault();
        doPaste();
      } else if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        doTranspose((e.code === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
      }
      return;
    }
    if (e.altKey) {
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
        e.preventDefault();
        const v = bumpVolume(eventAt(cur), e.code === 'ArrowUp' ? 1 : -1);
        if (v) {
          void edit({ op: 'setCell', pattern: pi, channel: cur.channel, row: cur.row, event: v });
          announce(`Volume ${v.vol}`);
        }
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute(cur.channel);
      }
      return;
    }
    const mv = moveCursor(e.key, cur, pattern.rows, rpb);
    if (mv) {
      e.preventDefault();
      if (e.shiftKey) setAnchor((a) => (a && a.pattern === pi ? a : { row: cur.row, channel: cur.channel, pattern: pi }));
      else setAnchor(null);
      setCursor(mv);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (multi) doClear();
      else if (eventAt(cur)) {
        void edit({ op: 'setCell', pattern: pi, channel: cur.channel, row: cur.row, event: null });
        announce(`Cleared, row ${cur.row + 1}, channel ${CHANNEL_LETTERS[cur.channel]}`);
      }
    } else if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      e.preventDefault();
      changeOctave(octave + (e.code === 'BracketLeft' ? -1 : 1));
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) togglePlay(e.shiftKey);
    } else if (!e.shiftKey && noteForCode(e.code, octave) !== undefined) {
      e.preventDefault();
      if (!e.repeat) enter(e.code);
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyK') {
        e.preventDefault();
        setKeys(!keysShown);
        announce(keysShown ? 'Keys hidden' : 'Keys shown');
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !inField(e.target) && !(e.target as HTMLElement).closest?.('button, [role="menuitem"]')) {
        e.preventDefault();
        setHelp((h) => !h);
      } else if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.defaultPrevented) {
        if (help) setHelp(false);
        else if (play.current?.kind === 'song') { stop(); announce('Stopped'); }
        else if (anchor) { setAnchor(null); announce('Selection cleared'); }
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // ------------------------------------------------------------- toolbar
  const groups: ToolbarGroup[] = [
    {
      label: 'Sound',
      items: [
        { kind: 'button', id: 'emu', label: 'Play in emulator', text: 'Play in emulator', icon: 'vm-running', onActivate: () => void client.request('playInEmulator', {}).catch((e: Error) => setMsg({ severity: 'error', text: e.message })) },
      ],
    },
    { label: 'Help', items: [{ kind: 'button', id: 'help', label: 'Keyboard shortcuts', icon: 'question', onActivate: () => setHelp(true) }] },
    { label: 'More', items: [{ kind: 'menu', id: 'more', label: 'More', icon: 'ellipsis', items: [{ id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) }] }] },
  ];

  const notices = [];
  if (view.saveProblem) notices.push(<Notice key="save" severity="error">{view.saveProblem}. Saving is disabled until this is fixed.</Notice>);
  for (const text of view.problems.slice(0, 3)) notices.push(<Notice key={`p${text}`} severity="warning">{text}. The build cannot make this song until it is fixed.</Notice>);
  if (view.problems.length > 3) notices.push(<Notice key="pmore" severity="warning">{view.problems.length - 3} more problems.</Notice>);
  if (msg) notices.push(<Notice key="msg" severity={msg.severity} onDismiss={() => setMsg(null)}>{msg.text}</Notice>);

  // --------------------------------------------------------------- parts
  const items: ShelfItem[] = instruments.map((i) => ({ id: i.id, badge: i.id, colour: idIndex(i.colour) ?? 11, name: i.name, meta: i.description, shape: envelopeShape(i) }));
  const playPos = playing ? pos : null;
  const playRow = playPos && playPos.pattern === pi ? playPos.row : -1;
  // Follow: show the pattern that plays
  useEffect(() => {
    if (follow && playPos && playPos.pattern !== pi && playPos.pattern < doc.patterns.length) setPat(playPos.pattern);
  }, [follow, playPos?.pattern]);

  const status = playPos
    ? [
        { id: 'step', value: playPos.step >= 0 ? `Step ${playPos.step + 1}` : 'Pattern alone' },
        { id: 'pat', value: `Pattern ${patternLetter(playPos.pattern)}` },
        { id: 'beat', value: `Playing beat ${beatPos(playPos.row, rpb)}` },
      ]
    : [
        { id: 'step', value: `Step ${stepI + 1}` },
        { id: 'pat', value: `Pattern ${patternLetter(pi)}` },
        { id: 'beat', value: `beat ${beatPos(cur.row, rpb)}` },
        { id: 'ch', value: `channel ${CHANNEL_LETTERS[cur.channel]}` },
      ];
  status.push({ id: 'tempo', value: `${tempoLabel(doc.speed, rpb)} BPM (${ticksLabel(doc.speed)})` }, { id: 'inc', value: view.include });
  if (multi) status.splice(status.findIndex((f) => f.id === 'ch') + 1, 0, { id: 'sel', value: `selected ${rectLabel(rect)}` });
  const editing = instView !== null ? (instrumentOf(doc, instView) ? instView : starter) : null;
  const squaresInfo = multi ? `Selected: ${rectLabel(rect)} (${rectCells(rect)} squares)` : 'Shift+arrows or Shift+click select squares';
  const squares = (
    <SquaresBar narrow={narrow} hasClip={clip !== null} info={squaresInfo} onCopy={doCopy} onPaste={doPaste} onClear={doClear} onTranspose={doTranspose} onEscape={focusGrid} />
  );

  const atEnd = doc.order.length >= 256;
  const tempo = <TempoField speed={doc.speed} rowsPerBeat={rpb} onSpeed={(s) => void edit({ op: 'setSpeed', speed: s })} />;
  return (
    <div class="tk">
      <h1 class="cb-visually-hidden">Music tracker {view.fileName}</h1>
      <div class="tk-top">
        <div class="tk-top-l">
          <SongName name={view.song} />
          <div class="tk-oct" role="group" aria-label="Octave">
            <span class="cb-label">Octave</span>
            <Pill size="sm" icon="remove" label="Octave down" shortcut="[" disabled={octave <= MIN_OCTAVE} why="lowest octave" onClick={() => changeOctave(octave - 1)} />
            <span class="cb-pill cb-pill-sm cb-pill-mono tk-octval" aria-label={`Octave ${octave}`}>{octave}</span>
            <Pill size="sm" icon="add" label="Octave up" shortcut="]" disabled={octave >= MAX_OCTAVE} why="highest octave" onClick={() => changeOctave(octave + 1)} />
          </div>
        </div>
        <Toolbar label="Music tracker" groups={groups} look="pills" onEscape={focusGrid} />
      </div>
      {notices}
      {help && <Help onClose={() => { setHelp(false); focusGrid(); }} />}
      {editing !== null ? (
        <InstrumentEditor
          doc={doc}
          id={editing}
          starter={starter}
          octave={octave}
          narrow={narrow}
          layout={layout}
          edit={edit}
          onSelect={(id) => { setInstView(id); setInstId(id); }}
          onStarter={setStarter}
          onBack={backToSong}
          audition={auditionInstrument}
          stopAudition={stopAudition}
          announce={announce}
        />
      ) : (
      <div class="tk-body">
        <div class="tk-shelf">
          <Shelf
            label="Instruments"
            items={items}
            selected={inst.id}
            narrowChips={narrow}
            onSelect={(id) => { setInstId(id); announce(`Instrument ${instrumentOf(doc, id)?.name ?? id}`); }}
            onActivate={focusGrid}
            actions={
              <>
                <Pill size="sm" icon="copy" text="Make a copy" label={`Make a copy of ${inst.name} to change it`} onClick={() => copyInstrument(false)} />
                <Pill size="sm" icon="edit" text="Edit..." label={isCustom ? `Edit ${inst.name}` : `Edit ${inst.name}: makes a copy first, then edits it`} onClick={editInstrument} />
              </>
            }
          />
          <p class="cb-muted tk-foot">Each is a ready-made AY sound. Drums use the noise generator, so give them a channel of their own.</p>
        </div>
        <div class="tk-main">
          <div class="tk-patbar">
            <span class="cb-label">Pattern</span>
            <PatternTabs doc={doc} selected={pi} onSelect={selectPattern} />
            <Pill size="sm" icon="add" text="New" label="New pattern" disabled={doc.patterns.length >= 16} why="a song has at most 16 patterns" onClick={newPattern} />
            <Pill size="sm" icon="copy" text="Copy" label="Copy pattern" disabled={doc.patterns.length >= 16} why="a song has at most 16 patterns" onClick={copyPattern} />
            <Pill size="sm" icon="trash" text="Delete" label="Delete pattern" disabled={doc.patterns.length <= 1} why="a song needs one pattern" onClick={deletePattern} />
            <MiniNumber id="tk-rows" label="Rows" value={pattern.rows} min={1} max={128} width={56} onCommit={(n) => void edit({ op: 'setRows', pattern: pi, rows: n })} />
            {narrow && squares}
          </div>
          {!narrow && squares}
          <Grid doc={doc} pattern={pi} cursor={cur} sel={multi ? rect : null} playRow={playRow} narrow={narrow} mute={mute} onPick={pickCell} onToggleMute={toggleMute} onKeyDown={onGridKey} gridRef={gridRef} />
          <div class="tk-podrow">
            <TransportPod
              label="Playback"
              buttons={[
                { id: 'start', label: 'Back to start', icon: 'debug-restart', onActivate: toStart },
                { id: 'play', label: 'Play', icon: 'play', main: true, shortcut: 'Space', disabled: playing, why: 'already playing', onActivate: () => togglePlay(false) },
                { id: 'stop', label: 'Stop', icon: 'debug-stop', shortcut: 'Esc', disabled: !playing, why: 'nothing is playing', onActivate: () => { stop(); announce('Stopped'); } },
              ]}
            >
              <span class="cb-pod-readout">
                <span class="cb-pod-unit">beat</span>
                <span class="cb-pod-big">{playPos ? beatPos(playPos.row, rpb) : beatPos(cur.row, rpb)}</span>
              </span>
              {narrow && tempo}
            </TransportPod>
            {!narrow && tempo}
            <MiniNumber id="tk-rpb" label="Rows per beat" value={rpb} min={1} max={16} width={48} onCommit={(n) => void edit({ op: 'setRowsPerBeat', rowsPerBeat: n })} />
            <ToggleChip label="Follow playback" pressed={follow} onChange={setFollow} />
            <span class="tk-playing">{audioOn ? (playing ? 'Playing; Space or Esc stops' : 'Space plays, Esc stops') : 'Click or press a key for sound'}</span>
          </div>
          <div class="tk-seqrow" title="Click a step to select it (or jump there while playing). The loop mark shows where the song starts again.">
            <span class="cb-label" id="tk-seq-l">Pattern sequencer</span>
            <Sequencer
              order={doc.order}
              loop={loop}
              step={stepI}
              playing={playPos ? playPos.step : -1}
              onSelect={selectStep}
              onRemove={(k) => void edit({ op: 'orderRemove', at: k }).then((ok) => { if (ok) setStepSel(Math.max(0, Math.min(stepI > k ? stepI - 1 : stepI, doc.order.length - 2))); })}
              onLoop={(k) => { void edit({ op: 'setLoop', at: k }); announce(`Loop point at step ${k + 1}`); }}
              onMove={(k, d) => {
                const op = moveStepOp(doc.order.length, k, d);
                if (op) void edit(op).then((ok) => { if (ok && stepI === k) setStepSel(k + d); });
              }}
            />
            <Pill size="sm" icon="add" text={`Add pattern ${patternLetter(pi)}`} label={`Add pattern ${patternLetter(pi)} to the sequencer`} disabled={atEnd} why="the order has at most 256 steps" onClick={() => void edit({ op: 'orderAdd', pattern: pi })} />
          </div>
          <section class="cb-card tk-keys" aria-label="Notes" title="Type on your keyboard or click a key. The note goes in the chosen square with the chosen instrument, then the cursor moves down by Step. Typing works with the keys hidden too.">
            <div class="cb-card-h">
              <h2 class="cb-label">Notes</h2>
              <div class="cb-card-actions tk-keys-actions">
                <span class="cb-pill cb-pill-sm tk-instpill" style={{ '--cb-id': idVar(idIndex(inst.colour) ?? 11) } as never} role="group" aria-label={`Current instrument: ${inst.name}`}>
                  <span class="tk-dot" aria-hidden="true">●</span>
                  <span aria-hidden="true">{inst.name}</span>
                </span>
                <MiniNumber id="tk-step" label="Step" value={stepBy} min={0} max={MAX_STEP} width={48} onCommit={(n) => setStepBy(n)} />
                <Pill size="sm" icon={keysShown ? 'eye-closed' : 'eye'} text={keysShown ? 'Hide keys' : 'Show keys'} label={keysShown ? 'Hide keys' : 'Show keys'} shortcut="Ctrl+Alt+K" aria={{ 'aria-expanded': keysShown }} onClick={() => setKeys(!keysShown)} />
              </div>
            </div>
            {keysShown && <KeyBoard octave={octave} layout={layout} onKey={(code) => { enter(code); focusGrid(); }} />}
          </section>
        </div>
      </div>
      )}
      <QuietStatus fields={editing !== null ? [{ id: 'inst', value: `Instrument ${editing}: ${instrumentOf(doc, editing)?.name ?? ''}` }, { id: 'inc', value: view.include }] : status} hint="Arrows move; Z S X D C V G B H N J M and Q W E R T Y U I enter notes; 1 is note off; Space plays; ? lists every key" />
      <span class="cb-visually-hidden" role="status" aria-live="polite">{live}</span>
    </div>
  );
}

startEditor(createClient<SongRequests, SongView>(), TrackerApp);
