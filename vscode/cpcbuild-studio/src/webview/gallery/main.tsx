/** The component gallery (dev only): every redesign component in every state. No host protocol; opened by cpcbuild.dev.gallery. */
import { render } from 'preact';
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Card } from '../shared/components/Card';
import { CpcPreview } from '../shared/components/CpcPreview';
import { CodeCard } from '../shared/components/CodeCard';
import { Keycap } from '../shared/components/Keycap';
import { Pill } from '../shared/components/Pill';
import { RoundSwatch } from '../shared/components/RoundSwatch';
import { SegPill } from '../shared/components/SegPill';
import { Shelf, type ShelfItem } from '../shared/components/Shelf';
import { StatPill } from '../shared/components/StatPill';
import { ToggleChip } from '../shared/components/ToggleChip';
import { Toolbar } from '../shared/components/Toolbar';
import { TransportPod } from '../shared/components/TransportPod';
import { ID_NAMES, idVar } from '../shared/theme';
import { sampleImage } from './sample';
import type { Mode } from '../../core/pixels';
import './gallery.css';

const noop = (): void => undefined;
const copy = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* no clipboard in this page: ignore */
  }
};

const ITEMS: ShelfItem[] = [
  { id: 'a', badge: '1', colour: 1, name: 'Laser', meta: '12 frames, 240 ms', shape: [1, 0.8, 0.6, 0.4, 0.2, 0] },
  { id: 'b', badge: '2', colour: 2, name: 'Explosion', meta: '40 frames, 800 ms', shape: [0.2, 1, 0.7, 0.5, 0.3, 0.1] },
  { id: 'c', badge: '3', colour: 3, name: 'Coin pickup with a long name', meta: '6 frames, 120 ms, noise on', shape: [0, 0, 1, 1] },
  { id: 'd', badge: '4', colour: 4, name: 'Jump', meta: '10 frames', shape: [0, 0.3, 0.6, 0.9, 0.6] },
  { id: 'e', badge: '5', colour: 5, name: 'Hit', meta: '4 frames', shape: [0.5, 0.5, 0.5] },
];
const CPC = ['rgb(0, 0, 128)', 'rgb(255, 255, 0)', 'rgb(0, 128, 0)', 'rgb(255, 0, 0)'];

/** Which sections each part shows (no part: everything). Each part fits a 1000 x 650 screenshot. */
const PARTS: Record<string, string[]> = {
  basics: ['pills', 'chips', 'stats'],
  cards: ['card-actions', 'card-collapsible', 'pod', 'codecard', 'keycaps'],
  shelf: ['shelf', 'swatches'],
  colours: ['ids'],
  toolbar: ['toolbar'],
  preview: ['preview', 'preview-popover'],
};
const SAMPLE = sampleImage();
const BORDER = [0, 0, 128] as const; // firmware 1, blue

// The host posts {type:'part', part}; it may arrive before the first render, so it is kept here and the component subscribes.
let currentPart: string | undefined;
const listeners = new Set<(p: string | undefined) => void>();
window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as { type?: string; part?: unknown } | undefined;
  if (m?.type !== 'part') return;
  currentPart = typeof m.part === 'string' ? m.part : undefined;
  listeners.forEach((f) => f(currentPart));
});

function Sec({ id, part, children }: { id: string; part: string | undefined; children: ComponentChildren }) {
  const list = part ? PARTS[part] : undefined;
  return !part || !list || list.includes(id) ? <>{children}</> : null;
}

function Gallery() {
  const [part, setPart] = useState<string | undefined>(currentPart);
  useEffect(() => {
    listeners.add(setPart);
    setPart(currentPart);
    return () => void listeners.delete(setPart);
  }, []);
  const [chip, setChip] = useState(true);
  const [chip2, setChip2] = useState(false);
  const [seg, setSeg] = useState<string | number>('b');
  const [sel, setSel] = useState('a');
  const [open, setOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState('draw');
  const [tbChip, setTbChip] = useState(true);
  const [pmode, setPmode] = useState<Mode>(0);
  const [pmode2, setPmode2] = useState<Mode>(1);
  return (
    <main class="gal">
      <h1>Studio components</h1>
      <div class="cb-card-stack">
        <Sec id="pills" part={part}>
        <Card title="Pills">
          <div class="cb-row">
            <Pill label="Secondary" onClick={noop} />
            <Pill label="Primary" variant="primary" onClick={noop} />
            <Pill label="Ghost" variant="ghost" onClick={noop} />
            <Pill label="With icon" icon="add" text="Add" onClick={noop} />
            <Pill label="Icon only" icon="trash" onClick={noop} />
            <Pill label="Mono 12" mono onClick={noop} />
          </div>
          <div class="cb-row">
            <Pill label="Small" size="sm" onClick={noop} />
            <Pill label="Extra small" size="xs" onClick={noop} />
            <Pill label="Small primary" size="sm" variant="primary" onClick={noop} />
            <Pill label="Small icon" size="sm" icon="copy" onClick={noop} />
          </div>
          <div class="cb-row">
            <Pill label="Disabled" disabled why="nothing selected" onClick={noop} />
            <Pill label="Disabled primary" variant="primary" disabled onClick={noop} />
            <Pill label="Disabled ghost" variant="ghost" disabled onClick={noop} />
            <Pill label="Disabled icon" icon="trash" disabled why="nothing to delete" onClick={noop} />
          </div>
        </Card>
        </Sec>
        <Sec id="chips" part={part}>
        <Card title="Chips and segments">
          <div class="cb-row">
            <ToggleChip label="Loop" pressed={chip} onChange={setChip} />
            <ToggleChip label="Snap" pressed={chip2} onChange={setChip2} icon="magnet" />
            <ToggleChip label="Static on" pressed onChange={noop} />
            <ToggleChip label="Static off" pressed={false} onChange={noop} />
          </div>
          <div class="cb-row">
            <SegPill label="Waveform" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Tone' }, { value: 'b', label: 'Noise' }, { value: 'c', label: 'Both' }]} />
            <SegPill label="Size" size="sm" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'S' }, { value: 'b', label: 'M' }, { value: 'c', label: 'L', disabled: true }]} />
          </div>
        </Card>
        </Sec>
        <Sec id="stats" part={part}>
        <Card title="Stats">
          <div class="cb-row">
            <StatPill>12 frames</StatPill>
            <StatPill state="ok">Fits in 256 bytes</StatPill>
            <StatPill state="warn">Long effect</StatPill>
            <StatPill state="bad">Too big</StatPill>
          </div>
        </Card>
        </Sec>
        <Sec id="card-actions" part={part}>
        <Card title="Card with actions" actions={<><Pill size="sm" label="Reset" onClick={noop} /><Pill size="sm" variant="primary" label="Apply" onClick={noop} /></>}>
          <p class="cb-muted">Cards stack in a column with 12 px gaps. A card never contains a card.</p>
        </Card>
        </Sec>
        <Sec id="card-collapsible" part={part}>
        <Card title="Collapsible card" collapsible open={open} onToggle={setOpen}>
          <p class="cb-muted">The header is a button with aria-expanded.</p>
        </Card>
        </Sec>
        <Sec id="pod" part={part}>
        <Card title="Transport pod">
          <div class="cb-row">
            <TransportPod
              label="Playback"
              buttons={[
                { id: 'back', label: 'Back to start', icon: 'debug-reverse-continue', shortcut: 'Home', onActivate: noop },
                { id: 'play', label: playing ? 'Pause' : 'Play', icon: playing ? 'debug-pause' : 'play', main: true, shortcut: 'Space', onActivate: () => setPlaying(!playing) },
                { id: 'stop', label: 'Stop', icon: 'debug-stop', shortcut: 'Esc', onActivate: () => setPlaying(false) },
                { id: 'loop', label: 'Loop', icon: 'sync', pressed: chip, onActivate: () => setChip(!chip) },
                { id: 'rec', label: 'Record', icon: 'record', disabled: true, why: 'nothing to record', onActivate: noop },
              ]}
            >
              <span class="cb-pod-readout"><span class="cb-pod-big">12</span><span class="cb-pod-unit">frames =</span><span class="cb-pod-big">240</span><span class="cb-pod-unit">ms</span></span>
            </TransportPod>
          </div>
        </Card>
        </Sec>
        <Sec id="shelf" part={part}>
        <Card title="Shelf">
          <div class="gal-shelf">
            <Shelf label="Effects" items={ITEMS} selected={sel} onSelect={setSel} onActivate={noop} onMove={noop} actions={<><Pill size="sm" icon="add" text="New" label="New effect" onClick={noop} /><Pill size="sm" icon="copy" text="Duplicate" label="Duplicate effect" onClick={noop} /></>} />
            <div class="gal-narrow">
              <p class="cb-muted">Chip row (narrow layouts)</p>
              <Shelf label="Effects as chips" items={ITEMS} selected={sel} onSelect={setSel} narrowChips />
            </div>
          </div>
        </Card>
        </Sec>
        <Sec id="ids" part={part}>
        <Card title="Identity colours">
          <ul class="gal-ids">
            {ID_NAMES.map((n, i) => (
              <li key={n} style={{ '--cb-id': idVar(i + 1) } as never}>
                <span class="cb-badge-ring" aria-hidden="true">{i + 1}</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        </Sec>
        <Sec id="swatches" part={part}>
        <Card title="Round swatches">
          <div class="cb-row" role="list" aria-label="Swatch rings">
            <span role="listitem" class="gal-sw"><RoundSwatch colour={CPC[0]} /> <span class="cb-muted">plain</span></span>
            <span role="listitem" class="gal-sw"><RoundSwatch colour={CPC[1]} ring="sel" /> <span class="cb-muted">selected</span></span>
            <span role="listitem" class="gal-sw"><RoundSwatch colour={CPC[2]} ring="left" /> <span class="cb-muted">left pen</span></span>
            <span role="listitem" class="gal-sw"><RoundSwatch colour={CPC[3]} ring="right" /> <span class="cb-muted">right pen</span></span>
            <span role="listitem" class="gal-sw"><RoundSwatch unset ring="dashed" /> <span class="cb-muted">unset</span></span>
          </div>
        </Card>
        </Sec>
        <Sec id="codecard" part={part}>
        <CodeCard title="Code" value={'SfxPlay(3)\nMusicInit()'} copy={copy} multiline />
        </Sec>
        <Sec id="keycaps" part={part}>
        <Card title="Keycaps">
          <div class="cb-row">
            <Keycap keys={['Ctrl', 'Shift', 'Esc']} />
            <Keycap keys={['Ctrl', 'Shift', 'F6']} />
            <span class="cb-kbd cb-kbd-big" aria-hidden="true"><span>A</span><span class="cb-muted">C3</span></span>
            <span class="cb-kbd cb-kbd-big cb-kbd-off" aria-hidden="true"><span>Q</span></span>
          </div>
        </Card>
        </Sec>
        <Sec id="toolbar" part={part}>
        <Card title="Toolbar, pills look">
          <Toolbar
            look="pills"
            label="Gallery tools"
            groups={[
              { label: 'File', items: [
                { kind: 'button', id: 'save', label: 'Save', icon: 'save', text: 'Save', shortcut: 'Ctrl+S', onActivate: noop },
                { kind: 'button', id: 'undo', label: 'Undo', icon: 'discard', disabled: true, why: 'nothing to undo', onActivate: noop },
                { kind: 'chip', id: 'grid', label: 'Grid', text: 'Grid', icon: 'symbol-array', pressed: tbChip, onActivate: () => setTbChip(!tbChip) },
              ] },
              { label: 'Mode', radio: true, items: [
                { kind: 'radio', id: 'draw', label: 'Draw', text: 'Draw', checked: mode === 'draw', onActivate: () => setMode('draw') },
                { kind: 'radio', id: 'erase', label: 'Erase', text: 'Erase', checked: mode === 'erase', onActivate: () => setMode('erase') },
              ] },
              { label: 'More', items: [
                { kind: 'menu', id: 'menu', label: 'Export', icon: 'export', text: 'Export', items: [{ id: 'bin', label: 'Binary', onActivate: noop }, { id: 'asm', label: 'Assembly', shortcut: 'Ctrl+E', onActivate: noop }] },
              ] },
            ]}
          />
        </Card>
        </Sec>
        <Sec id="preview" part={part}>
        <Card title="CPC preview, with extras and inline compare">
          <CpcPreview image={SAMPLE} assetMode={0} assetLabel="sprite's mode" mode={pmode} onMode={setPmode} onUseMode={(m) => console.log('use mode', m)} border={BORDER} extras compare="inline" label="Sprite CPC preview" />
        </Card>
        </Sec>
        <Sec id="preview-popover" part={part}>
        <Card title="CPC preview, compare in a popover">
          <CpcPreview image={SAMPLE} assetMode={0} mode={pmode2} onMode={setPmode2} compare="popover" label="Importer CPC preview" />
        </Card>
        </Sec>
      </div>
    </main>
  );
}

render(<Gallery />, document.getElementById('root') as HTMLElement);
(window as unknown as { acquireVsCodeApi?: () => { postMessage(m: unknown): void } }).acquireVsCodeApi?.().postMessage({ type: 'ready' });
