/**
 * The image importer webview (S4, restyled in R5): a .cpcimp recipe as a form of cards, the source sheet with the grid,
 * the live CPC result (CpcPreview for CPC recipes), the colour mapping and the equivalent command.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { defaultGrid, gridLayout, type GridSpec } from '../../core/cpcgrid';
import { composedSource, isLegacyTarget, mappingRows, parseHexRgb, previewResultImage, previewSourceImage, resultState, rgbHex } from '../../core/importerView';
import type { Recipe, RecipeOp } from '../../core/cpcimp';
import { FW_NAMES, FW_TABLE, parsePalList, parseRgb12List } from '../../core/palette';
import { tileWidthsOf, type Mode } from '../../core/pixels';
import type { ImporterRequests, ImporterView, Preview, SourceImage } from '../../shared/importerProtocol';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Card } from '../shared/components/Card';
import { CodeCard } from '../shared/components/CodeCard';
import { CpcPreview } from '../shared/components/CpcPreview';
import { Icon } from '../shared/components/Icon';
import { Keycap } from '../shared/components/Keycap';
import { EmptyState, Notice, NoticeAction } from '../shared/components/Notice';
import { Pill } from '../shared/components/Pill';
import { CheckField, Field, NumberField, SelectField } from '../shared/components/PropertyPanel';
import { SegPill } from '../shared/components/SegPill';
import { StatPill } from '../shared/components/StatPill';
import { StatusLine } from '../shared/components/StatusLine';
import { rgbCss } from '../shared/components/Swatch';
import { ToggleChip } from '../shared/components/ToggleChip';
import { Toolbar, type ToolbarGroup } from '../shared/components/Toolbar';
import { aspectWidth, fitZoom, stepZoom } from '../shared/geometry';
import { ResultCanvas, SourceCanvas, type SourcePixels } from './canvases';
import './importer.css';

type Host = EditorHost<ImporterRequests, ImporterView>;
type Pane = 'source' | 'cpc' | 'both';
type Tab = 'options' | 'preview' | 'mapping' | 'command';
interface Persisted {
  tab?: Tab;
  pane?: Pane;
  zoom?: number | 'fit';
  grid?: boolean;
  open?: Record<string, boolean>;
}
interface Msg {
  severity: 'info' | 'warning' | 'error';
  text: string;
}

const fwLabel = (n: number): string => `${n} ${FW_NAMES[n]?.toLowerCase() ?? ''}`;
const b64ToPixels = (b64: string): Uint8ClampedArray => {
  const bin = atob(b64);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A text field that applies on blur / Enter and holds a refused value with its message (Esc reverts). */
function TextField(p: { id: string; label: string; value: string; placeholder?: string; description?: string; error?: string; disabled?: boolean; mono?: boolean; validate?(t: string): string | undefined; onCommit(t: string): void }) {
  const [text, setText] = useState(p.value);
  const [err, setErr] = useState<string | undefined>();
  useEffect(() => {
    setText(p.value);
    setErr(undefined);
  }, [p.value]);
  const commit = (): void => {
    const e = p.validate?.(text.trim());
    setErr(e);
    if (!e && text.trim() !== p.value) p.onCommit(text.trim());
  };
  const shown = err ?? p.error;
  return (
    <Field id={p.id} label={p.label} description={p.description} error={shown}>
      <input
        id={p.id}
        class={`cb-input${p.mono ? ' cb-mono' : ''}`}
        type="text"
        value={text}
        placeholder={p.placeholder}
        disabled={p.disabled}
        aria-invalid={shown ? 'true' : undefined}
        aria-describedby={[p.description ? `${p.id}-desc` : '', shown ? `${p.id}-err` : ''].filter(Boolean).join(' ') || undefined}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setText(p.value);
            setErr(undefined);
          }
        }}
      />
    </Field>
  );
}

const MIN_AVAIL_W = 64;
const MODE_PENS = [16, 4, 2];
function ImporterApp({ client, settings, view }: Host) {
  const r = view.effective; // the form shows the effective values: the recipe's, else the sidecar's
  const side = view.sidecar;
  /** The field description, with where the value comes from when the sidecar supplies it. */
  const fromSide = (key: keyof Recipe, text: string): string =>
    side && view.sidecarFields?.[key] !== undefined && view.recipe[key] === undefined ? `${text} From ${side}.` : text;
  const saved = client.getState<Persisted>() ?? {};
  const [tab, setTab] = useState<Tab>(saved.tab ?? 'options');
  const [pane, setPane] = useState<Pane>(saved.pane ?? 'both');
  const [zoomWanted, setZoomWanted] = useState<number | 'fit'>(saved.zoom ?? 'fit');
  const [showGrid, setShowGrid] = useState(saved.grid ?? true);
  const [open, setOpen] = useState<Record<string, boolean>>(saved.open ?? { target: true, kind: true, colours: true, output: true });
  const [narrow, setNarrow] = useState(window.innerWidth <= 720);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [src, setSrc] = useState<(SourceImage & { pixels?: SourcePixels }) | 'loading' | null>('loading');
  const [good, setGood] = useState<Preview | null>(null);
  const [err, setErr] = useState<string>('');
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [palPending, setPalPending] = useState<'pens' | 'file' | null>(null);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdText, setCmdText] = useState('');
  const [cmdMsg, setCmdMsg] = useState<Msg | null>(null);
  const [penPop, setPenPop] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [avail, setAvail] = useState({ w: 600, h: 400 });
  const recipeMode = (r.mode ?? 1) as Mode;
  /** The mode the CPC preview shows; follows the recipe's mode when that changes. */
  const [pmode, setPmode] = useState<Mode>(recipeMode);
  const version = useRef(view.version);
  version.current = view.version;
  const seq = useRef(0);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => client.setState({ tab, pane, zoom: zoomWanted, grid: showGrid, open } satisfies Persisted), [tab, pane, zoomWanted, showGrid, open]);
  useEffect(() => setPmode(recipeMode), [recipeMode]);
  useEffect(() => {
    const on = (): void => setNarrow(window.innerWidth <= 720);
    const focus = (): void => setRefresh((n) => n + 1);
    window.addEventListener('resize', on);
    window.addEventListener('focus', focus);
    return () => {
      window.removeEventListener('resize', on);
      window.removeEventListener('focus', focus);
    };
  }, []);
  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    // Fit by width (a tall image scrolls inside its pane). A width under MIN_AVAIL_W is a layout that has not settled
    // yet (or a collapsed pane): ignore it, and re-measure after the first paint, when fonts and the grid have settled.
    const h = (): number => Math.max(240, window.innerHeight * 0.7);
    const measure = (): void => {
      const w = el.clientWidth;
      if (w < MIN_AVAIL_W) return;
      setAvail((a) => (a.w === w && a.h === h() ? a : { w, h: h() }));
    };
    const ro = new ResizeObserver(() => requestAnimationFrame(measure)); // after the frame: changing the observed size inside the callback is the "ResizeObserver loop" error
    ro.observe(el);
    const timers = [setTimeout(measure, 0), setTimeout(measure, 150), setTimeout(measure, 600)];
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      timers.forEach(clearTimeout);
      window.removeEventListener('resize', measure);
    };
  }, [src, tab, pane]);

  const edit = async (op: RecipeOp): Promise<void> => {
    try {
      const res = await client.request('edit', { baseVersion: version.current, op });
      version.current = res.version;
    } catch (e) {
      setMsg({ severity: 'error', text: (e as Error).message });
    }
  };
  const set = (patch: { [k: string]: unknown }): Promise<void> => edit({ op: 'set', patch });

  // -------- the source image
  useEffect(() => {
    let dead = false;
    if (!r.source) {
      setSrc(null);
      return;
    }
    client.request('sourceImage', {}).then(
      (s) => {
        if (dead) return;
        setSrc(s.ok ? { ...s, pixels: { width: s.width, height: s.height, rgba: b64ToPixels(s.rgba) } } : s);
      },
      (e: Error) => !dead && setSrc({ ok: false, error: e.message }),
    );
    return () => {
      dead = true;
    };
  }, [view.sourceKey, refresh]);

  // -------- the live result: debounced, numbered, stale replies dropped
  useEffect(() => {
    const mine = ++seq.current;
    setBusy(true);
    const t = window.setTimeout(() => {
      client.request('preview', { version: view.version }).then(
        (p) => {
          if (mine !== seq.current) return;
          setBusy(false);
          if (p.ok) {
            setGood(p.preview);
            setErr('');
            setTruncated(p.truncated);
          } else {
            setErr(p.error);
            if (p.empty) setGood(null);
          }
        },
        (e: Error) => {
          if (mine !== seq.current) return;
          setBusy(false);
          setErr(e.message);
        },
      );
    }, 150);
    return () => window.clearTimeout(t);
  }, [view.version, view.sourceKey, refresh, view.engine]);

  // -------- derived
  const sp = src && src !== 'loading' && src.ok ? src.pixels : undefined;
  const grid = r.grid;
  const lay = useMemo(() => (grid && sp ? gridLayout(grid, sp.width, sp.height) : undefined), [grid, sp]);
  const cells = lay ? lay.cols * lay.rows : 0;
  const selectedCount = lay ? lay.selected.length : 0;
  const frame = (() => {
    const m = r.frame ? /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(r.frame) : null;
    return m ? { w: Number(m[1]), h: Number(m[2]) } : undefined;
  })();
  const cellSize = grid && r.kind !== 'tiles' ? { w: grid.cellW, h: grid.cellH } : grid ? { w: grid.cellW, h: grid.cellH } : r.kind === 'tiles' ? { w: r.tileWidth ?? 8, h: 8 } : frame;
  const legacy = isLegacyTarget(r.target);
  const aspMode = r.target === 'cpc' ? (r.mode ?? 1) : 'plus';
  const aw = aspectWidth(aspMode, settings.pixelAspect, 2, 1);
  const shown: Pane = narrow && pane === 'both' ? 'source' : pane;
  const wantedW = shown === 'both' ? avail.w / 2 : avail.w;
  const imgW = Math.max(sp?.width ?? 1, good?.width ?? 1), imgH = Math.max(sp?.height ?? 1, good?.height ?? 1);
  const zoom = zoomWanted === 'fit' ? fitZoom(imgW, imgH, aw, wantedW, avail.h) : zoomWanted;
  const srcZoom = zoomWanted === 'fit' ? fitZoom(sp?.width ?? 1, sp?.height ?? 1, 1, wantedW, avail.h) : zoomWanted;
  const resultZoom = zoomWanted === 'fit' ? fitZoom(good?.width ?? 1, good?.height ?? 1, aw, wantedW, avail.h) : zoom;
  const stepBy = (dir: 1 | -1): void => setZoomWanted(stepZoom(typeof zoomWanted === 'number' ? zoomWanted : zoom, dir, aw));

  const tiles = r.kind === 'tiles';
  const sideMasked = !!side && !tiles && !!view.sidecarFields?.masked;
  const cpc = r.target === 'cpc';
  const plusT = r.target === 'plus-sprite' || r.target === 'plus-palette';
  const palMode: 'auto' | 'pens' | 'file' = r.palette?.file ? 'file' : r.palette?.list?.length ? 'pens' : (palPending ?? 'auto');
  const fixedPal = cpc && (palMode === 'pens' || palMode === 'file');
  // Spectrum recipes still generate but have no CPC preview: that converter message is expected, not an error to show
  const errText = legacy ? '' : err;
  const errFrame = /frame/i.test(errText);
  const errPal = /palette|colours|pens/i.test(errText);
  const sixteen = /16-bit PNG/.test(errText);

  // the pictures of the CPC preview: the converter's result for the recipe's mode, the source reduced for the others
  const srcImage = useMemo(() => (sp && cpc ? previewSourceImage(sp, { grid, transparent: r.transparent }) : undefined), [sp, cpc, grid, r.transparent]);
  const resultImage = useMemo(() => (good && cpc ? previewResultImage(good) : undefined), [good, cpc]);
  const cpcImage = pmode === recipeMode ? resultImage : srcImage;
  const composed = useMemo(() => (sp ? composedSource(sp, grid) : undefined), [sp, grid]);
  const table = useMemo(() => (good ? mappingRows(good, composed) : null), [good, composed]);

  // -------- actions
  const generate = async (): Promise<void> => {
    try {
      const out = await client.request('generate', {});
      setMsg(out.ok ? { severity: 'info', text: `Wrote ${out.written.join(', ')}.` } : { severity: 'error', text: out.error ?? 'Generating failed.' });
    } catch (e) {
      setMsg({ severity: 'error', text: (e as Error).message });
    }
  };
  const copyText = (text: string): Promise<unknown> => client.request('copy', { text });
  const pickSource = (): void => void client.request('pickSource', { baseVersion: version.current });
  const setGrid = (g: GridSpec | null): void => void set({ grid: g });
  const enableGrid = (on: boolean): void => {
    if (!on) return setGrid(null);
    if (!sp) return setMsg({ severity: 'warning', text: 'Choose a source image first.' });
    const g = defaultGrid(sp.width, sp.height, r.frame);
    setCursor(0);
    setGrid(g);
  };
  const toggleCells = (cs: number[], include: boolean): void => void edit({ op: 'cells', cells: cs, include });
  const gridField = (id: string, label: string, key: keyof GridSpec, min: number): ComponentChildren =>
    grid ? <NumberField id={id} label={label} value={(grid[key] as number | undefined) ?? 0} min={min} max={4096} onCommit={(n) => setGrid({ ...grid, [key]: n })} /> : null;
  /** F14: the preview shows an image that fits mode N: make N the recipe's mode (a tile width that N refuses comes back as the converter's message). */
  const useMode = (m: Mode): void => void set({ mode: m });
  const openImport = (): void => {
    setCmdOpen(true);
    if (narrow) setTab('command');
  };

  const pickFromImage = (rgb: [number, number, number] | null): void => {
    setPick(false);
    if (!rgb) return;
    void set({ transparent: rgbHex(rgb) });
  };

  const setPenColour = (pen: number, fw: number): void => {
    if (!good) return;
    const list = good.rows.map((row) => Number(row.label));
    list[pen] = fw;
    setPenPop(null);
    setMsg({ severity: 'info', text: `Pen ${pen} is now firmware colour ${fwLabel(fw)}. The palette is now a fixed list of pens.` });
    void set({ palette: { list }, pen0: null });
  };

  // -------- notices
  const notices: ComponentChildren[] = [];
  if (msg) notices.push(<Notice key="msg" severity={msg.severity} onDismiss={() => setMsg(null)}>{msg.text}</Notice>);
  if (legacy) notices.push(<Notice key="legacy" severity="info" actions={[{ label: 'Switch to CPC', onClick: () => void set({ target: 'cpc', ...(r.mode === undefined ? { mode: 1 } : {}) }) }]}>Spectrum is no longer offered in the editor; Generate still works.</Notice>);
  if (src && src !== 'loading' && !src.ok && !src.empty) {
    const acts: NoticeAction[] = [{ label: 'Choose image...', onClick: pickSource }];
    if (/16-bit PNG/.test(src.error)) acts.unshift({ label: 'Use the Python engine', onClick: () => void client.request('useEngine', { engine: 'python' }).then((x) => x.changed && setRefresh((n) => n + 1)) });
    notices.push(<Notice key="srcerr" severity="error" actions={acts}>{src.error}</Notice>);
  }
  if (view.sidecarError) notices.push(<Notice key="sidecar" severity="error">{view.sidecarError}</Notice>);
  if (errText && !view.sidecarError) {
    const acts: NoticeAction[] = [];
    if (sixteen) acts.push({ label: 'Use the Python engine', onClick: () => void client.request('useEngine', { engine: 'python' }) });
    if (/needs \d+ colours/.test(errText) && cpc) acts.push({ label: 'Pick a palette', onClick: () => { setOpen({ ...open, colours: true }); setPalPending('pens'); setTab('options'); queueMicrotask(() => document.getElementById('imp-pens')?.focus()); } });
    notices.push(<Notice key="err" severity="error" actions={acts}>{errText}</Notice>);
  }
  if (view.stale && !errText && r.source) notices.push(<Notice key="stale" severity="info">{view.outputExists ? `${view.outputs[0]} is older than this recipe or its image.` : `${view.outputs[0]} has not been generated yet.`} Use Generate to write it.</Notice>);
  if (view.saveProblem) notices.push(<Notice key="sp" severity="error">{view.saveProblem}</Notice>);
  if (good && cpc && good.width / (r.mode === 0 ? 2 : r.mode === 1 ? 4 : 8) > 255) notices.push(<Notice key="wide" severity="warning">A frame wider than 255 bytes cannot be drawn by the library.</Notice>);

  // -------- option cards
  const card = (id: string, title: string, children: ComponentChildren, dflt = false): ComponentChildren => (
    <Card id={`imp-card-${id}`} title={title} collapsible open={open[id] ?? dflt} onToggle={(o) => setOpen({ ...open, [id]: o })}>{children}</Card>
  );
  const browse = (which: 'output' | 'palette' | 'writePalette', what: string): ComponentChildren => (
    <Pill size="sm" label={`Browse for ${what}`} text="Browse..." aria={{ 'aria-label': `Browse for ${what}` }} onClick={() => void client.request('pickFile', { baseVersion: version.current, which })} />
  );

  const options = (
    <aside class="imp-opts cb-card-stack" aria-label="Import options">
      {card('target', 'Target', (
        <>
          <SegPill<string>
            label="Target"
            size="sm"
            value={r.target}
            options={[
              { value: 'cpc', label: 'CPC', title: 'Screen modes 0, 1, 2 (--mode)' },
              { value: 'plus-sprite', label: 'Plus sprites', title: '--plus-sprite' },
              { value: 'plus-palette', label: 'Plus pens', title: '--plus-palette' },
            ]}
            onChange={(t) => void set({ target: t, ...(t === 'cpc' && r.mode === undefined ? { mode: 1 } : {}) })}
          />
          {cpc && (
            <>
              <SegPill<number> label="Recipe mode" size="sm" value={r.mode ?? 1} options={[0, 1, 2].map((m) => ({ value: m, label: `Mode ${m} · ${MODE_PENS[m]}` }))} onChange={(m) => void set({ mode: m })} />
              <div class="cb-muted">{MODE_PENS[r.mode ?? 1]} pens. <code class="imp-flag">--mode {r.mode ?? 1}</code>{fromSide('mode', '')}</div>
            </>
          )}
        </>
      ), true)}

      {cpc && card('kind', 'Sprites and tiles', (
        <>
          <SegPill<string> label="Kind" size="sm" value={tiles ? 'tiles' : 'sprite'} options={[{ value: 'sprite', label: 'Sprite', title: '--sprite' }, { value: 'tiles', label: 'Tiles', title: '--tiles' }]} onChange={(k) => void set({ kind: k, ...(k === 'tiles' ? { frame: null, masked: null } : { dedupe: null, tileWidth: null }) })} />
          {fromSide('kind', '') && <div class="cb-muted">The kind comes from {side}.</div>}
          <TextField id="imp-frame" label="Frame size (WxH pixels)" value={grid ? `${grid.cellW}x${grid.cellH}` : (r.frame ?? '')} placeholder="whole image"
            disabled={tiles || !!grid} error={errFrame ? errText : undefined}
            description={tiles ? 'Tiles are 8 lines tall, and as wide as the tile width below (--frame is for sprites).' : grid ? 'Set by the grid cell size while grid extraction is on.' : fromSide('frame', '--frame WxH. Cuts a sheet into frames, row by row.')} mono
            validate={(t) => (t && !/^\d+\s*x\s*\d+$/i.test(t) ? 'Use WxH, for example 16x16' : undefined)}
            onCommit={(t) => void set({ frame: t || null })} />
          {tiles && (
            <NumberField id="imp-tw" label="Tile width (pixels)" value={r.tileWidth ?? 8} min={1} max={32}
              description={fromSide('tileWidth', `--tile-width: 1, 2 or 4 bytes, so ${tileWidthsOf(r.mode ?? 1).join(', ')} pixels in mode ${r.mode ?? 1}. 8 is the default.`)}
              onCommit={(n) => void set({ tileWidth: n === 8 ? null : n })} />
          )}
          <CheckField id="imp-masked" label="Masked (mask byte before each pixel byte)" checked={!!r.masked} disabled={tiles || sideMasked} description={tiles ? '--masked with --tiles is an error, so it is off for tiles.' : sideMasked ? `Set by ${side}, which a recipe option cannot switch off. Change it there, or use Use ${side} above to drop the recipe's own copy.` : '--masked'} onChange={(v) => void set({ masked: v ? true : null })} />
          <CheckField id="imp-dedupe" label="Drop repeated tiles (adds NAME_MAP)" checked={!!r.dedupe} disabled={!tiles} description={tiles ? '--dedupe' : '--dedupe needs tiles.'} onChange={(v) => void set({ dedupe: v ? true : null })} />
        </>
      ), true)}

      {card('colours', 'Colours', (
        <>
          <div class="imp-trans">
            <TextField id="imp-trans" label="Transparent colour (RRGGBB)" value={r.transparent ?? ''} placeholder="none" description="--transparent RRGGBB. Pixels of this colour, and pixels with alpha below 128, are transparent." mono
              validate={(t) => (t && !/^#?[0-9a-fA-F]{6}$/.test(t) ? 'Use six hex digits, for example FF00FF' : undefined)}
              onCommit={(t) => void set({ transparent: t ? t.replace(/^#/, '').toUpperCase() : null })} />
            <div class="imp-trans-actions">
              {parseHexRgb(r.transparent) && <span class="cb-swatch" style={{ backgroundColor: `#${r.transparent?.replace(/^#/, '')}` }} role="img" aria-label={`Transparent colour ${r.transparent}`} />}
              <Pill size="sm" label="Pick from image" text={pick ? 'Click a pixel...' : 'Pick from image'} icon={pick ? 'check' : 'eye'} disabled={!sp} why="choose a source image first" aria={{ 'aria-pressed': pick }} onClick={() => setPick(!pick)} />
            </div>
          </div>
          {cpc && (
            <>
              <SegPill<string> label="Palette" size="sm" value={palMode} options={[{ value: 'auto', label: 'Auto' }, { value: 'pens', label: 'Pens' }, { value: 'file', label: 'File' }]}
                onChange={(m) => {
                  if (m === 'auto') {
                    setPalPending(null);
                    void set({ palette: null });
                  } else {
                    setPalPending(m as 'pens' | 'file');
                    if (m === 'pens' && r.palette?.file) void set({ palette: null });
                    if (m === 'file' && r.palette?.list) void set({ palette: null });
                  }
                }} />
              {palMode === 'auto' && <div class="cb-muted">Pens in order of first appearance in the image, after pen 0 if given.</div>}
              {palMode === 'pens' && (
                <TextField id="imp-pens" label="Fixed pens (firmware colours 0-26)" value={r.palette?.list?.join(',') ?? ''} placeholder="0,26,6,18" description={fromSide('palette', '--palette LIST. Each pixel takes the nearest pen; all entries are emitted.')} mono
                  error={errPal ? errText : undefined}
                  validate={(t) => {
                    if (!t) return undefined;
                    try {
                      parsePalList(t);
                      return undefined;
                    } catch (e) {
                      return (e as Error).message;
                    }
                  }}
                  onCommit={(t) => void set({ palette: t ? { list: parsePalList(t) } : null })} />
              )}
              {palMode === 'file' && (
                <>
                  <div class="imp-row">
                    <TextField id="imp-palfile" label="Palette file (.cpcpal)" value={r.palette?.file ?? ''} placeholder="assets/pens.cpcpal" description="--palette-file F" mono onCommit={(t) => void set({ palette: t ? { file: t } : null })} />
                    {browse('palette', 'the palette file')}
                  </div>
                  <div><Pill size="sm" label="Edit palette" disabled={!r.palette?.file} why="no palette file is set" onClick={() => void client.request('openPalette', {})} /></div>
                </>
              )}
              <SelectField id="imp-pen0" label="Pen 0 colour" value={r.pen0 ?? -1} disabled={fixedPal}
                description={fixedPal ? '--pen0 is ignored when a fixed palette is given.' : '--pen0 N. Automatic palettes start with this colour.'}
                options={[{ value: -1, label: 'first colour of the image' }, ...Array.from({ length: 27 }, (_, n) => ({ value: n, label: fwLabel(n) }))]}
                onChange={(v) => void set({ pen0: v < 0 ? null : v })} />
              <CheckField id="imp-emit" label="Emit the palette (NAME_pal, NAME_PENS)" checked={r.emitPalette !== false} description="Off writes --no-palette, for assets that share another one's palette." onChange={(v) => void set({ emitPalette: v ? true : false })} />
              <div class="imp-row">
                <TextField id="imp-wp" label="Save the palette used (optional)" value={r.writePalette ?? ''} placeholder="assets/pens.cpcpal" description="--write-palette F" mono onCommit={(t) => void set({ writePalette: t || null })} />
                {browse('writePalette', 'the palette to save')}
              </div>
            </>
          )}
          {plusT && (
            <>
              {r.target === 'plus-sprite' && <CheckField id="imp-packed" label="Packed: two pixels per byte" checked={!!r.plus?.packed} description="--packed" onChange={(v) => void set({ plus: { ...(r.plus ?? {}), packed: v ? true : undefined } })} />}
              <SelectField id="imp-pfmt" label="Format" value={r.plus?.format ?? 'bas'} options={[{ value: 'bas', label: 'BASIC include (.bas)' }, { value: 'asm', label: 'Assembler (.asm)' }, { value: 'bin', label: 'Binary (.bin and .pal)' }]} description="--plus-format" onChange={(v) => void set({ plus: { ...(r.plus ?? {}), format: v === 'bas' ? undefined : v } })} />
              <TextField id="imp-ppal" label="Fixed colours (RGB hex, optional)" value={r.plus?.palette?.list?.join(',') ?? ''} placeholder="F00,0F0" description="--palette RGB,... Without it the palette is the image's 12-bit colours in order of first appearance." mono
                error={errPal ? errText : undefined}
                validate={(t) => {
                  if (!t) return undefined;
                  try {
                    parseRgb12List(t);
                    return undefined;
                  } catch (e) {
                    return (e as Error).message;
                  }
                }}
                onCommit={(t) => void set({ plus: { ...(r.plus ?? {}), palette: t ? { list: t.split(/[,\s]+/).filter(Boolean) } : undefined } })} />
            </>
          )}
        </>
      ), true)}

      {cpc && card('helpers', 'Helpers: grid extraction', (
        <>
          <CheckField id="imp-grid" label="Use grid extraction" checked={!!grid} description="Cuts cells out of a sheet with margins and spacing, and joins the chosen ones into a contiguous sheet before converting. There is no command-line equivalent." onChange={enableGrid} />
          {grid && lay && (
            <>
              <div class="imp-grid2">
                {gridField('g-cw', 'Cell width', 'cellW', 1)}
                {gridField('g-ch', 'Cell height', 'cellH', 1)}
                {gridField('g-mx', 'Margin x', 'marginX', 0)}
                {gridField('g-my', 'Margin y', 'marginY', 0)}
                {gridField('g-sx', 'Spacing x', 'spacingX', 0)}
                {gridField('g-sy', 'Spacing y', 'spacingY', 0)}
              </div>
              <NumberField id="g-cols" label="Columns in the output" value={grid.columns ?? Math.max(1, Math.min(lay.cols, selectedCount))} min={1} max={256} onCommit={(n) => setGrid({ ...grid, columns: n })} />
              {(lay.leftoverX > 0 || lay.leftoverY > 0) && lay.cols > 0 && <div class="cb-muted imp-warn"><Icon name="warning" /> {lay.leftoverX > 0 ? `The image width leaves ${lay.leftoverX} pixels that fit no ${grid.cellW}-wide cell. ` : ''}{lay.leftoverY > 0 ? `The image height leaves ${lay.leftoverY} pixels that fit no ${grid.cellH}-high cell.` : ''}</div>}
              <div class="cb-row">
                <Pill size="sm" label="Select all" onClick={() => toggleCells(Array.from({ length: cells }, (_, i) => i), true)} />
                <Pill size="sm" label="Select none" onClick={() => toggleCells(Array.from({ length: cells }, (_, i) => i), false)} />
              </div>
              <div class="cb-muted">{selectedCount} of {cells} cells selected, in reading order. Click or drag on the source to include or exclude cells.</div>
            </>
          )}
        </>
      ))}

      {card('output', 'Output', (
        <>
          <TextField id="imp-name" label="Name" value={r.name ?? ''} placeholder={view.defaultName} description={fromSide('name', '--name NAME. Prefix of the generated arrays and constants.')} mono
            validate={(t) => (t && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? 'Use letters, digits and _, not starting with a digit' : undefined)}
            onCommit={(t) => void set({ name: t || null })} />
          <div class="imp-row">
            <TextField id="imp-out" label="Output file" value={r.output ?? ''} placeholder={view.defaultOutput} description="-o FILE, relative to the project folder." mono onCommit={(t) => void set({ output: t || null })} />
            {browse('output', 'the output file')}
          </div>
        </>
      ), true)}
      <div class="imp-note cb-muted">
        Engine: {view.engine === 'python' ? 'Python (tools/img2cpc.py)' : 'built in'}; header: {view.header}. Change them in the <code>cpcbuild.assets.*</code> settings.
      </div>
    </aside>
  );

  // -------- panes
  const sourcePane = (
    <Card id="imp-card-source" title={`Source${sp ? ` ${sp.width} × ${sp.height}` : ''}${pick ? ' (click a pixel for the transparent colour)' : ''}`}>
      {sp ? (
        <div class="imp-scroll">
          <SourceCanvas src={sp} zoom={srcZoom} grid={grid} frame={!grid && cpc && !tiles ? frame : tiles ? { w: r.tileWidth ?? 8, h: 8 } : undefined} showGrid={showGrid} pick={pick} cursor={cursor} onCursor={setCursor} onCells={toggleCells} onPick={pickFromImage} label={`Source image ${sp.width} by ${sp.height} pixels`} />
        </div>
      ) : src === 'loading' ? (
        <p class="cb-loading" role="status">Reading image...</p>
      ) : null}
    </Card>
  );
  const dimmed = !!errText || busy;
  const previewW = Math.max(160, Math.floor(wantedW) - 48);
  const resultBody = legacy ? (
    <p class="cb-muted">There is no CPC preview of Spectrum output.</p>
  ) : cpc ? (
    cpcImage ? (
      <div class={dimmed ? 'imp-dimwell' : undefined}>
        <CpcPreview
          image={cpcImage}
          compareImage={srcImage}
          assetMode={recipeMode}
          assetLabel="= recipe mode"
          mode={pmode}
          onMode={setPmode}
          onUseMode={useMode}
          compare={wantedW >= 480 ? 'inline' : 'popover'}
          maxWidth={zoomWanted === 'fit' ? previewW : Math.max(32, Math.round(cpcImage.w * zoomWanted * aw) + 1)}
          maxHeight={zoomWanted === 'fit' ? Math.max(120, Math.floor(avail.h * 0.8)) : Math.max(32, cpcImage.h * zoomWanted + 1)}
          label="CPC result"
        />
      </div>
    ) : (
      <p class="cb-muted">{errText ? 'No result yet.' : pmode !== recipeMode ? 'Reading the image...' : 'The result appears here.'}</p>
    )
  ) : good ? (
    <div class="imp-scroll">
      <ResultCanvas preview={good} zoom={resultZoom} aw={aw} cell={cellSize} dim={dimmed} label={`CPC result, ${good.rows.length} ${plusT ? 'colours' : 'pens'}`} />
    </div>
  ) : (
    <p class="cb-muted">{errText ? 'No result yet.' : 'The result appears here.'}</p>
  );
  const resultPane = (
    <Card id="imp-card-result" title={`CPC result${good ? ` ${good.width} × ${good.height}` : ''}${errText && good ? ' (out of date)' : ''}${busy ? ' ...' : ''}`}>
      {resultBody}
    </Card>
  );
  const previewTools = (
    <div class="imp-tools" role="group" aria-label="Preview">
      <span class="cb-label" aria-hidden="true">Show</span>
      <SegPill<Pane> label="Show" size="sm" value={shown} options={[{ value: 'source', label: 'Source' }, { value: 'cpc', label: 'CPC result' }, ...(narrow ? [] : [{ value: 'both' as Pane, label: 'Both' }])]} onChange={setPane} />
      <ToggleChip label="Grid" icon="symbol-misc" pressed={showGrid} onChange={setShowGrid} />
      <Pill size="sm" icon="zoom-out" label="Zoom out" onClick={() => stepBy(-1)} />
      <span aria-live="polite"><StatPill title="Zoom">{zoomWanted === 'fit' ? `fit (${zoom}x)` : `${zoom}x`}</StatPill></span>
      <Pill size="sm" icon="zoom-in" label="Zoom in" onClick={() => stepBy(1)} />
      <Pill size="sm" label="Fit the image in the pane" text="Fit" onClick={() => setZoomWanted('fit')} />
    </div>
  );
  const preview = (
    <div class="imp-preview" ref={paneRef}>
      {previewTools}
      <div class={`imp-panes${shown === 'both' ? ' imp-both' : ''}`}>
        {(shown === 'source' || shown === 'both') && sourcePane}
        {(shown === 'cpc' || shown === 'both') && resultPane}
      </div>
    </div>
  );

  // -------- colour mapping
  const penCell = (row: NonNullable<typeof table>['rows'][number]): ComponentChildren => {
    const swatch = <span class="cb-swatch" style={{ backgroundColor: rgbCss(row.pen.rgb) }} aria-hidden="true" />;
    if (!cpc) return <span class="cb-pill cb-pill-sm imp-penpill">{swatch}<span>Pen {row.pen.pen} · {row.pen.label}</span></span>;
    const fw = Number(row.pen.label);
    return (
      <>
        <button type="button" class="cb-pill cb-pill-sm imp-penpill" aria-haspopup="listbox" aria-expanded={penPop === row.key} aria-label={`Pen ${row.pen.pen} · ${fwLabel(fw)}. Change colour`} onClick={() => setPenPop(penPop === row.key ? null : row.key)}>
          {swatch}<span>Pen {row.pen.pen} · {fwLabel(fw)}</span>
        </button>
        {penPop === row.key && (
          <div class="imp-pop" role="listbox" aria-label={`Colours for pen ${row.pen.pen}`} onKeyDown={(e) => e.key === 'Escape' && setPenPop(null)}>
            {FW_TABLE.map((c, n) => (
              <button key={n} type="button" role="option" aria-selected={n === fw} class="imp-pop-item" title={fwLabel(n)} aria-label={fwLabel(n)} onClick={() => setPenColour(row.pen.pen, n)}>
                <span class="cb-swatch" style={{ backgroundColor: rgbCss(FW_TABLE[n]) }} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </>
    );
  };
  const transKey = parseHexRgb(r.transparent);
  const mapping = good && table ? (
    <Card id="imp-card-map" title="Colour mapping">
      <table class="imp-table" role="table">
        <thead>
          <tr><th scope="col">Source colour</th><th scope="col">{plusT ? 'Pen (12-bit colour)' : 'Pen (firmware colour)'}</th><th scope="col">Pixels</th><th scope="col">Notes</th></tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.key} class={row.unused ? 'imp-unused' : undefined}>
              <th scope="row">
                {row.src ? <><span class="cb-swatch" style={{ backgroundColor: rgbCss(row.src) }} aria-hidden="true" /> <span class="cb-mono">#{rgbHex(row.src)}</span></> : <span class="cb-muted">no source colour</span>}
              </th>
              <td>{penCell(row)}</td>
              <td class="cb-mono">{row.pixels}</td>
              <td>
                {row.unused && <span class="imp-tag">unused pen</span>}
                {row.nearest && <span class="imp-tag imp-tag-warn"><Icon name="warning" /> nearest match</span>}
                {row.duplicate && <span class="imp-tag imp-tag-warn" title="Same colour as another pen"><Icon name="warning" /> duplicate</span>}
              </td>
            </tr>
          ))}
          <tr>
            <th scope="row">
              {transKey ? <><span class="cb-swatch" style={{ backgroundColor: rgbCss(transKey) }} aria-hidden="true" /> <span class="cb-mono">#{rgbHex(transKey)}</span></> : <span class="cb-muted">alpha below 128</span>}
            </th>
            <td>Transparent (not a pen)</td>
            <td class="cb-mono">{table.transparentPixels}</td>
            <td />
          </tr>
        </tbody>
      </table>
      {table.more > 0 && <div class="cb-muted">{table.more} more source colours are not listed.</div>}
    </Card>
  ) : null;

  // -------- command and generated text
  const importForm = cmdOpen ? (
    <Card title="Import from command line" actions={<Pill size="sm" icon="close" label="Close import" onClick={() => setCmdOpen(false)} />}>
      <div class="imp-import">
        <label for="imp-cmdtext">Paste a line from tools/build_assets.sh</label>
        <textarea id="imp-cmdtext" class="cb-input cb-mono" rows={3} value={cmdText} onInput={(e) => setCmdText((e.target as HTMLTextAreaElement).value)} />
        <div class="cb-row">
          <Pill variant="primary" size="sm" label="Apply" disabled={!cmdText.trim()} why="paste a command line first" onClick={() =>
            void client.request('importCommand', { baseVersion: version.current, line: cmdText }).then((x) => {
              if (!x.ok) return setCmdMsg({ severity: 'error', text: x.error ?? 'Could not read that command.' });
              setCmdMsg(x.unrecognised.length ? { severity: 'warning', text: `Imported. These words are not img2cpc options and were left for you to check: ${x.unrecognised.join(' ')}` } : { severity: 'info', text: 'Imported.' });
              if (!x.unrecognised.length) setCmdOpen(false);
            })} />
          <Pill size="sm" label="Cancel" onClick={() => setCmdOpen(false)} />
        </div>
        {cmdMsg && <Notice severity={cmdMsg.severity} onDismiss={() => setCmdMsg(null)}>{cmdMsg.text}</Notice>}
      </div>
    </Card>
  ) : null;
  const command = (
    <div class="imp-cmd">
      {view.command ? <CodeCard title="Command" value={view.command} copy={copyText} /> : <Card title="Command"><Notice severity="info">{view.commandReason ?? 'There is no command for this recipe.'}</Notice></Card>}
      {importForm}
      {good && good.text ? <CodeCard title={`Generated text${truncated ? ' (first part)' : ''}`} value={good.text} copy={copyText} multiline /> : <Card title="Generated text"><p class="cb-muted">{good ? 'This output is binary, so there is no text.' : 'Nothing generated yet.'}</p></Card>}
    </div>
  );

  // -------- toolbar
  const result = resultState({ error: !!errText || !!view.sidecarError || (src !== null && src !== 'loading' && !src.ok && !src.empty), stale: view.stale, outputExists: view.outputExists, output: view.outputs[0] });
  const imageGroup: ToolbarGroup = { label: 'Source image', items: [{ id: 'choose', kind: 'button', label: 'Choose image', icon: 'file-media', text: 'Choose image...', onActivate: pickSource }] };
  const moreGroup: ToolbarGroup = {
    label: 'Help and more',
    items: [
      { id: 'help', kind: 'button', label: 'Help', icon: 'question', pressed: help, onActivate: () => setHelp(!help) },
      {
        id: 'more', kind: 'menu', label: 'More', icon: 'ellipsis',
        items: [
          { id: 'import', label: 'Import from command line...', icon: 'terminal', onActivate: openImport },
          { id: 'prep', label: 'Save preprocessed image', icon: 'save', disabled: !grid, onActivate: () => void client.request('savePreprocessed', {}).then((x) => setMsg(x.file ? { severity: 'info', text: `Wrote ${x.file}.` } : { severity: 'error', text: x.error ?? 'Could not write the sheet.' })) },
          { id: 'text', label: 'Open as text', icon: 'go-to-file', onActivate: () => void client.request('openAsText', {}) },
        ],
      },
    ],
  };
  const overridden = view.sidecar && view.overridden.length > 0;
  const bar = (
    <header class="imp-bar">
      <StatPill title={r.source || 'No source image'}><span class="imp-srcname">{r.source ? `${r.source.split('/').pop()}${sp ? ` · ${sp.width} × ${sp.height}` : ''}` : 'no source'}</span></StatPill>
      <Toolbar label="Importer: image" groups={[imageGroup]} look="pills" />
      <Pill variant="primary" icon="play" text="Generate" label="Generate" disabled={!r.source} why="choose a source image first" onClick={() => void generate()} />
      {r.source && <StatPill state={result.state} title={result.title}>{result.text}</StatPill>}
      <span class="imp-spacer" />
      <Toolbar label="Importer: help and more" groups={[moreGroup]} look="pills" />
    </header>
  );
  const sidecarRow = view.sidecar && !view.sidecarError ? (
    <div class="imp-sidecar cb-muted">
      <span>Settings from {view.sidecar}{view.overridden.length ? `, except ${view.overridden.join(', ')} (set in this recipe)` : ''}</span>
      {overridden && <Pill size="xs" label={`Use ${view.sidecar}`} onClick={() => void set(Object.fromEntries(view.overridden.map((k) => [k, null])))} />}
    </div>
  ) : null;
  const helpCard = help ? (
    <div class="imp-help" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHelp(false); } }}>
      <Card title="Keyboard shortcuts" actions={<Pill size="sm" icon="close" label="Close help" onClick={() => setHelp(false)} />}>
        <dl class="imp-keys">
          <dt><Keycap keys={['Arrows']} /></dt><dd>Move the cell cursor on the source grid</dd>
          <dt><Keycap keys={['Space']} /></dt><dd>Include or exclude the cell under the cursor</dd>
          <dt><Keycap keys={['Ctrl', 'A']} /></dt><dd>Include all cells (<Keycap keys={['Ctrl', 'Shift', 'A']} /> none)</dd>
          <dt><Keycap keys={['Shift']} /> click</dt><dd>Toggle a range of cells; drag to paint cells</dd>
          <dt><Keycap keys={['Ctrl', 'PgUp']} /> <Keycap keys={['Ctrl', 'PgDn']} /></dt><dd>Previous and next tab (narrow layout)</dd>
          <dt><Keycap keys={['Esc']} /></dt><dd>Close a menu or this help</dd>
        </dl>
      </Card>
    </div>
  ) : null;

  const status = (
    <StatusLine
      fields={[
        !!good && { id: 'sum', value: good.summary },
        cpc && { id: 'mode', value: `mode ${r.mode ?? 1}` },
        r.target !== 'cpc' && { id: 'target', value: r.target },
        !!lay && { id: 'cells', value: `${selectedCount} of ${cells} cells` },
        !!view.generated && { id: 'gen', value: view.generated.ok ? `generated ${new Date(view.generated.at).toLocaleTimeString()}` : 'last generate failed' },
      ]}
    />
  );

  if (!r.source)
    return (
      <div class="imp">
        <h1 class="cb-visually-hidden">Image importer {view.fileName}</h1>
        {notices}
        <EmptyState icon="file-media" title="Choose an image to import" text="PNG, GIF or BMP. One image pixel becomes one CPC pixel." action={{ label: 'Choose image...', onClick: pickSource }} />
        {status}
      </div>
    );

  const tabs: { id: Tab; label: string }[] = [{ id: 'options', label: 'Options' }, { id: 'preview', label: 'Preview' }, { id: 'mapping', label: 'Mapping' }, { id: 'command', label: 'Command' }];
  const onTabKey = (e: KeyboardEvent): void => {
    const i = tabs.findIndex((t) => t.id === tab);
    const go = (n: number): void => {
      e.preventDefault();
      const t = tabs[(n + tabs.length) % tabs.length];
      setTab(t.id);
      queueMicrotask(() => document.getElementById(`imp-tab-${t.id}`)?.focus());
    };
    if (e.key === 'ArrowRight') go(i + 1);
    else if (e.key === 'ArrowLeft') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tabs.length - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'PageDown') go(i + 1);
    else if ((e.ctrlKey || e.metaKey) && e.key === 'PageUp') go(i - 1);
  };

  return (
    <div class="imp">
      <h1 class="cb-visually-hidden">Image importer {view.fileName}</h1>
      {bar}
      {sidecarRow}
      {notices}
      {narrow ? (
        <>
          <div class="imp-tabs" role="tablist" aria-label="Importer sections" onKeyDown={onTabKey as never}>
            {tabs.map((t) => (
              <button key={t.id} id={`imp-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="imp-tabpanel" tabIndex={tab === t.id ? 0 : -1} class={tab === t.id ? 'imp-tab imp-tab-on' : 'imp-tab'} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div id="imp-tabpanel" role="tabpanel" aria-labelledby={`imp-tab-${tab}`} class="imp-tabpanel">
            {helpCard}
            {tab === 'options' && options}
            {tab === 'preview' && preview}
            {tab === 'mapping' && (mapping ?? <p class="cb-muted imp-pad">No result to map yet.</p>)}
            {tab === 'command' && command}
          </div>
        </>
      ) : (
        <div class="imp-body">
          {options}
          <div class="imp-main">
            {helpCard}
            {preview}
            {mapping}
            {command}
          </div>
        </div>
      )}
      {status}
    </div>
  );
}

startEditor(createClient<ImporterRequests, ImporterView>(), ImporterApp);
export type { Recipe };
