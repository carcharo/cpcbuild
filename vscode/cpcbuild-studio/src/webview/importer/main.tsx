/** The image importer webview (S4): a .cpcimp recipe as a form, the source sheet with the grid, the live CPC result. */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { defaultGrid, gridLayout, type GridSpec } from '../../core/cpcgrid';
import type { Recipe, RecipeOp } from '../../core/cpcimp';
import { FW_NAMES, FW_TABLE, parsePalList, parseRgb12List } from '../../core/palette';
import { tileWidthsOf } from '../../core/pixels';
import type { ImporterRequests, ImporterView, Preview, SourceImage } from '../../shared/importerProtocol';
import { EditorHost, startEditor } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Copyable } from '../shared/components/Copyable';
import { Icon } from '../shared/components/Icon';
import { EmptyState, Notice, NoticeAction } from '../shared/components/Notice';
import { CheckField, Field, NumberField, PropertyPanel, Section, SelectField, Segmented } from '../shared/components/PropertyPanel';
import { StatusLine } from '../shared/components/StatusLine';
import { rgbCss } from '../shared/components/Swatch';
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
  const [open, setOpen] = useState<Record<string, boolean>>(saved.open ?? { target: true, kind: true, colours: true });
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
  const [penPop, setPenPop] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [avail, setAvail] = useState({ w: 600, h: 400 });
  const version = useRef(view.version);
  version.current = view.version;
  const seq = useRef(0);
  const paneRef = useRef<HTMLDivElement>(null);

  useEffect(() => client.setState({ tab, pane, zoom: zoomWanted, grid: showGrid, open } satisfies Persisted), [tab, pane, zoomWanted, showGrid, open]);
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
  const aspMode = r.target === 'cpc' ? (r.mode ?? 1) : 'plus';
  const aw = aspectWidth(aspMode, settings.pixelAspect, 2, 1);
  const wantedW = pane === 'both' && !narrow ? avail.w / 2 : avail.w;
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
  const errText = err;
  const errFrame = /frame/i.test(errText);
  const errPal = /palette|colours|pens/i.test(errText);
  const sixteen = /16-bit PNG/.test(errText);

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
  const setGrid = (g: GridSpec | null): void => void set({ grid: g, ...(g ? {} : {}) });
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

  const pickFromImage = (rgb: [number, number, number] | null): void => {
    setPick(false);
    if (!rgb) return;
    void set({ transparent: rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase() });
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
  if (src && src !== 'loading' && !src.ok && !src.empty) {
    const acts: NoticeAction[] = [{ label: 'Choose image...', onClick: () => void client.request('pickSource', { baseVersion: version.current }) }];
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
  if (view.stale && !errText && r.source) notices.push(<Notice key="stale" severity="info">{view.outputExists ? `${view.outputs[0]} is older than this recipe or its image.` : `${view.outputs[0]} has not been generated yet.`} Use Generate{narrow ? '' : ' above'} to write it.</Notice>);
  if (view.saveProblem) notices.push(<Notice key="sp" severity="error">{view.saveProblem}</Notice>);
  if (good && cpc && good.width / (r.mode === 0 ? 2 : r.mode === 1 ? 4 : 8) > 255) notices.push(<Notice key="wide" severity="warning">A frame wider than 255 bytes cannot be drawn by the library.</Notice>);

  // -------- sections
  const sec = (id: string, title: string, children: ComponentChildren, dflt = false): ComponentChildren => (
    <Section title={title} open={open[id] ?? dflt} onToggle={(o) => setOpen({ ...open, [id]: o })}>{children}</Section>
  );

  const options = (
    <PropertyPanel label="Import options">
      {sec('target', 'Target', (
        <>
          <Segmented<string>
            label="Target"
            grid
            value={r.target}
            options={[
              { value: 'cpc', label: 'CPC', title: 'Screen modes 0, 1, 2 (--mode)' },
              { value: 'plus-sprite', label: 'Plus sprites', title: '--plus-sprite' },
              { value: 'plus-palette', label: 'Plus pens', title: '--plus-palette' },
              { value: 'spectrum', label: 'Spectrum', title: '--spectrum' },
            ]}
            onChange={(t) => void set({ target: t, ...(t === 'cpc' && r.mode === undefined ? { mode: 1 } : {}) })}
          />
          {cpc && (
            <>
              <Segmented<number> label="Mode" value={r.mode ?? 1} options={[0, 1, 2].map((m) => ({ value: m, label: `Mode ${m}` }))} onChange={(m) => void set({ mode: m })} />
              <div class="cb-muted">{[16, 4, 2][r.mode ?? 1]} pens. <code class="imp-flag">--mode {r.mode ?? 1}</code>{fromSide('mode', '')}</div>
            </>
          )}
          {r.target === 'spectrum' && (
            <CheckField id="imp-zx" label="Sprite data (one bit per opaque non-black pixel)" checked={!!r.zxSprite} description="--zx-sprite" onChange={(v) => void set({ zxSprite: v ? true : null })} />
          )}
          <TextField id="imp-name" label="Name" value={r.name ?? ''} placeholder={view.defaultName} description={fromSide('name', '--name NAME. Prefix of the generated arrays and constants.')} mono
            validate={(t) => (t && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) ? 'Use letters, digits and _, not starting with a digit' : undefined)}
            onCommit={(t) => void set({ name: t || null })} />
          <div class="imp-row">
            <TextField id="imp-out" label="Output file" value={r.output ?? ''} placeholder={view.defaultOutput} description="-o FILE, relative to the project folder." mono onCommit={(t) => void set({ output: t || null })} />
            <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('pickFile', { baseVersion: version.current, which: 'output' })}>Browse...</button>
          </div>
        </>
      ), true)}

      {cpc && sec('kind', 'Sprites and tiles', (
        <>
          <Segmented<string> label="Kind" value={tiles ? 'tiles' : 'sprite'} options={[{ value: 'sprite', label: 'Sprite', title: '--sprite' }, { value: 'tiles', label: 'Tiles', title: '--tiles' }]} onChange={(k) => void set({ kind: k, ...(k === 'tiles' ? { frame: null, masked: null } : { dedupe: null, tileWidth: null }) })} />
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

      {sec('colours', 'Colours', (
        <>
          <div class="imp-trans">
            <TextField id="imp-trans" label="Transparent colour (RRGGBB)" value={r.transparent ?? ''} placeholder="none" description="--transparent RRGGBB. Pixels of this colour, and pixels with alpha below 128, are transparent." mono
              validate={(t) => (t && !/^#?[0-9a-fA-F]{6}$/.test(t) ? 'Use six hex digits, for example FF00FF' : undefined)}
              onCommit={(t) => void set({ transparent: t ? t.replace(/^#/, '').toUpperCase() : null })} />
            {r.transparent && /^[0-9a-f]{6}$/i.test(r.transparent) && <span class="cb-swatch" style={{ backgroundColor: `#${r.transparent}` }} role="img" aria-label={`Transparent colour ${r.transparent}`} />}
            <button type="button" class={`cb-btn cb-btn-secondary${pick ? ' imp-on' : ''}`} aria-pressed={pick} disabled={!sp} onClick={() => setPick(!pick)}>
              <Icon name="eye" /> {pick ? 'Click a pixel...' : 'Pick from image'}
            </button>
          </div>
          {cpc && (
            <>
              <Segmented<string> label="Palette" value={palMode} options={[{ value: 'auto', label: 'Automatic' }, { value: 'pens', label: 'Pens' }, { value: 'file', label: 'File' }]}
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
                    <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('pickFile', { baseVersion: version.current, which: 'palette' })}>Browse...</button>
                  </div>
                  <button type="button" class="cb-btn cb-btn-secondary imp-link" disabled={!r.palette?.file} onClick={() => void client.request('openPalette', {})}>Edit palette</button>
                </>
              )}
              <SelectField id="imp-pen0" label="Pen 0 colour" value={r.pen0 ?? -1} disabled={fixedPal}
                description={fixedPal ? '--pen0 is ignored when a fixed palette is given.' : '--pen0 N. Automatic palettes start with this colour.'}
                options={[{ value: -1, label: 'first colour of the image' }, ...Array.from({ length: 27 }, (_, n) => ({ value: n, label: fwLabel(n) }))]}
                onChange={(v) => void set({ pen0: v < 0 ? null : v })} />
              <CheckField id="imp-emit" label="Emit the palette (NAME_pal, NAME_PENS)" checked={r.emitPalette !== false} description="Off writes --no-palette, for assets that share another one's palette." onChange={(v) => void set({ emitPalette: v ? true : false })} />
              <div class="imp-row">
                <TextField id="imp-wp" label="Save the palette used (optional)" value={r.writePalette ?? ''} placeholder="assets/pens.cpcpal" description="--write-palette F" mono onCommit={(t) => void set({ writePalette: t || null })} />
                <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('pickFile', { baseVersion: version.current, which: 'writePalette' })}>Browse...</button>
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

      {cpc && sec('helpers', 'Helpers: grid extraction', (
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
                <button type="button" class="cb-btn cb-btn-secondary" onClick={() => toggleCells(Array.from({ length: cells }, (_, i) => i), true)}>Select all</button>
                <button type="button" class="cb-btn cb-btn-secondary" onClick={() => toggleCells(Array.from({ length: cells }, (_, i) => i), false)}>Select none</button>
              </div>
              <div class="cb-muted">{selectedCount} of {cells} cells selected, in reading order. Click or drag on the source to include or exclude cells.</div>
            </>
          )}
        </>
      ))}
      <div class="imp-note cb-muted">
        Engine: {view.engine === 'python' ? 'Python (tools/img2cpc.py)' : 'built in'}; header: {view.header}. Change them in the <code>cpcbuild.assets.*</code> settings.
      </div>
    </PropertyPanel>
  );

  // -------- panes
  const sourcePane = (
    <section class="imp-pane" aria-label="Source image">
      <h2 class="imp-h">Source{sp ? ` ${sp.width}x${sp.height}` : ''}{pick ? ' (click a pixel for the transparent colour)' : ''}</h2>
      {sp ? (
        <div class="imp-scroll">
          <SourceCanvas src={sp} zoom={srcZoom} grid={grid} frame={!grid && cpc && !tiles ? frame : tiles ? { w: r.tileWidth ?? 8, h: 8 } : undefined} showGrid={showGrid} pick={pick} cursor={cursor} onCursor={setCursor} onCells={toggleCells} onPick={pickFromImage} label={`Source image ${sp.width} by ${sp.height} pixels`} />
        </div>
      ) : src === 'loading' ? (
        <p class="cb-loading" role="status">Reading image...</p>
      ) : null}
    </section>
  );
  const resultPane = (
    <section class="imp-pane" aria-label="CPC result">
      <h2 class="imp-h">
        CPC result{good ? ` ${good.width}x${good.height}` : ''}{errText && good ? ' (out of date)' : ''}{busy ? ' ...' : ''}
      </h2>
      {good ? (
        <div class="imp-scroll">
          <ResultCanvas preview={good} zoom={resultZoom} aw={aw} cell={cellSize} dim={!!errText || busy} label={`CPC result, ${good.rows.length} ${plusT ? 'colours' : 'pens'}`} />
        </div>
      ) : (
        <p class="cb-muted">{errText ? 'No result yet.' : 'The result appears here.'}</p>
      )}
    </section>
  );
  const previewTools = (
    <div class="imp-tools" role="toolbar" aria-label="Preview">
      <Segmented<Pane> label="Show" value={pane} options={[{ value: 'source', label: 'Source' }, { value: 'cpc', label: 'CPC result' }, ...(narrow ? [] : [{ value: 'both' as Pane, label: 'Side by side' }])]} onChange={setPane} />
      <button type="button" class="cb-icon-btn" aria-label="Zoom out" title="Zoom out" onClick={() => stepBy(-1)}><Icon name="zoom-out" /></button>
      <span class="cb-mono" aria-live="polite">{zoomWanted === 'fit' ? `fit (${zoom}x)` : `${zoom}x`}</span>
      <button type="button" class="cb-icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => stepBy(1)}><Icon name="zoom-in" /></button>
      <button type="button" class="cb-btn cb-btn-secondary" onClick={() => setZoomWanted('fit')}>Fit</button>
      <button type="button" class="cb-icon-btn" aria-pressed={showGrid} aria-label="Show grid" title="Show grid" onClick={() => setShowGrid(!showGrid)}><Icon name="symbol-misc" /></button>
    </div>
  );
  const preview = (
    <div class="imp-preview" ref={paneRef}>
      {previewTools}
      <div class={`imp-panes${pane === 'both' && !narrow ? ' imp-both' : ''}`}>
        {(pane === 'source' || pane === 'both') && sourcePane}
        {(pane === 'cpc' || (pane === 'both' && !narrow)) && resultPane}
        {pane === 'both' && narrow && null}
      </div>
    </div>
  );

  const rows = [...(good?.rows ?? [])].sort((a, b) => Number(b.pixels > 0) - Number(a.pixels > 0)); // used pens first (stable)
  const dupLabels = new Map<string, number>();
  rows.forEach((row) => dupLabels.set(row.label, (dupLabels.get(row.label) ?? 0) + 1));
  const mapping = good ? (
    <section class="imp-map" aria-labelledby="imp-map-h">
      <h2 class="imp-h" id="imp-map-h">Colour mapping</h2>
      <table class="imp-table" role="table">
        <thead>
          <tr><th scope="col">Pen</th><th scope="col">{plusT ? 'Colour (12-bit)' : 'Firmware colour'}</th><th scope="col">Image colours</th><th scope="col">Pixels</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.pen} class={row.pixels === 0 ? 'imp-unused' : undefined} title={row.pixels === 0 ? 'Not used by this image' : undefined}>
              <th scope="row">{row.pen}</th>
              <td>
                {cpc ? (
                  <>
                    <button type="button" class="imp-pen" aria-haspopup="listbox" aria-expanded={penPop === row.pen} aria-label={`Pen ${row.pen}: ${fwLabel(Number(row.label))}. Change colour`} onClick={() => setPenPop(penPop === row.pen ? null : row.pen)}>
                      <span class="cb-swatch" style={{ backgroundColor: rgbCss(row.rgb) }} aria-hidden="true" /> {fwLabel(Number(row.label))}
                    </button>
                    {penPop === row.pen && (
                      <div class="imp-pop" role="listbox" aria-label={`Colours for pen ${row.pen}`} onKeyDown={(e) => e.key === 'Escape' && setPenPop(null)}>
                        {FW_TABLE.map((c, n) => (
                          <button key={n} type="button" role="option" aria-selected={n === Number(row.label)} class="imp-pop-item" title={fwLabel(n)} aria-label={fwLabel(n)} onClick={() => setPenColour(row.pen, n)}>
                            <span class="cb-swatch" style={{ backgroundColor: rgbCss(c) }} aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <span class="cb-swatch" style={{ backgroundColor: rgbCss(row.rgb) }} aria-hidden="true" /> {row.label}
                  </>
                )}
                {(dupLabels.get(row.label) ?? 0) > 1 && <span class="imp-dup" title="Same colour as another pen" role="img" aria-label="Same colour as another pen"><Icon name="warning" /></span>}
              </td>
              <td class="cb-mono">{row.colours}{row.colours > 1 ? ' merged' : ''}</td>
              <td class="cb-mono">{row.pixels}</td>
            </tr>
          ))}
          <tr><th scope="row">-</th><td>Transparent</td><td class="cb-mono">-</td><td class="cb-mono">{good.transparent}</td></tr>
        </tbody>
      </table>
    </section>
  ) : null;

  const command = (
    <section class="imp-cmd" aria-labelledby="imp-cmd-h">
      <h2 class="imp-h" id="imp-cmd-h">Equivalent command</h2>
      {view.command ? <Copyable value={view.command} label="command" copy={copyText} /> : <Notice severity="info">{view.commandReason ?? 'There is no command for this recipe.'}</Notice>}
      <div class="cb-row">
        <button type="button" class="cb-btn" disabled={!view.command} aria-describedby={!view.command ? 'imp-cmd-why' : undefined} onClick={() => void client.request('copyCommand', {}).then((x) => setMsg(x.copied ? { severity: 'info', text: 'Command copied.' } : { severity: 'warning', text: x.reason ?? 'Nothing to copy.' }))}>Copy command</button>
        <button type="button" class="cb-btn cb-btn-secondary" aria-expanded={cmdOpen} onClick={() => setCmdOpen(!cmdOpen)}>Import from command line...</button>
        {grid && <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('savePreprocessed', {}).then((x) => setMsg(x.file ? { severity: 'info', text: `Wrote ${x.file}.` } : { severity: 'error', text: x.error ?? 'Could not write the sheet.' }))}><Icon name="save" /> Save pre-processed image</button>}
      </div>
      {!view.command && <div id="imp-cmd-why" class="cb-visually-hidden">{view.commandReason}</div>}
      {cmdOpen && (
        <div class="imp-import">
          <label for="imp-cmdtext">Paste a line from tools/build_assets.sh</label>
          <textarea id="imp-cmdtext" class="cb-input cb-mono" rows={3} value={cmdText} onInput={(e) => setCmdText((e.target as HTMLTextAreaElement).value)} />
          <div class="cb-row">
            <button type="button" class="cb-btn" disabled={!cmdText.trim()} onClick={() =>
              void client.request('importCommand', { baseVersion: version.current, line: cmdText }).then((x) => {
                if (!x.ok) return setCmdMsg({ severity: 'error', text: x.error ?? 'Could not read that command.' });
                setCmdMsg(x.unrecognised.length ? { severity: 'warning', text: `Imported. These words are not img2cpc options and were left for you to check: ${x.unrecognised.join(' ')}` } : { severity: 'info', text: 'Imported.' });
                if (!x.unrecognised.length) setCmdOpen(false);
              })}>Apply</button>
            <button type="button" class="cb-btn cb-btn-secondary" onClick={() => setCmdOpen(false)}>Cancel</button>
          </div>
          {cmdMsg && <Notice severity={cmdMsg.severity} onDismiss={() => setCmdMsg(null)}>{cmdMsg.text}</Notice>}
        </div>
      )}
      <details class="imp-text">
        <summary>Generated text{truncated ? ' (first part)' : ''}</summary>
        {good ? <pre class="cb-code imp-pre" tabIndex={0} aria-label="Generated text">{good.text}</pre> : <p class="cb-muted">Nothing generated yet.</p>}
      </details>
    </section>
  );

  // -------- header
  const header = (
    <header class="imp-head">
      <div class="imp-src">
        <span class="cb-muted">Source:</span> <strong class="cb-mono">{r.source || 'none'}</strong>
        {sp && <span class="cb-muted"> {sp.width}x{sp.height} px</span>}
        <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('pickSource', { baseVersion: version.current })}>Change...</button>
        {view.sidecar && !view.sidecarError && <div class="cb-muted">Settings from {view.sidecar}{view.overridden.length ? `, except ${view.overridden.join(', ')} (set in this recipe)` : ''}</div>}
        {view.sidecar && view.overridden.length > 0 && (
          <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void set(Object.fromEntries(view.overridden.map((k) => [k, null])))}>Use {view.sidecar}</button>
        )}
      </div>
      <div class="imp-out">
        <span class="cb-muted">Output:</span> <span class="cb-mono">{view.outputs[0]}</span>
        <button type="button" class="cb-btn" disabled={!r.source} onClick={() => void generate()}><Icon name="play" /> Generate</button>
      </div>
      {!narrow && view.command && (
        <div class="imp-cmdbar">
          <span class="cb-muted">Command:</span>
          <code class="cb-mono imp-cmdline" title={view.command}>{view.command}</code>
          <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('copyCommand', {}).then((x) => setMsg(x.copied ? { severity: 'info', text: 'Command copied.' } : { severity: 'warning', text: x.reason ?? 'Nothing to copy.' }))}>Copy</button>
        </div>
      )}
    </header>
  );

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
        <EmptyState icon="file-media" title="Choose an image to import" text="PNG, GIF or BMP. One image pixel becomes one CPC pixel." action={{ label: 'Choose image...', onClick: () => void client.request('pickSource', { baseVersion: version.current }) }} />
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
      {header}
      {notices}
      {narrow ? (
        <>
          <div class="imp-tabs" role="tablist" aria-label="Importer sections" onKeyDown={onTabKey as never}>
            {tabs.map((t) => (
              <button key={t.id} id={`imp-tab-${t.id}`} type="button" role="tab" aria-selected={tab === t.id} aria-controls="imp-tabpanel" tabIndex={tab === t.id ? 0 : -1} class={tab === t.id ? 'imp-tab imp-tab-on' : 'imp-tab'} onClick={() => setTab(t.id)}>{t.label}</button>
            ))}
          </div>
          <div id="imp-tabpanel" role="tabpanel" aria-labelledby={`imp-tab-${tab}`} class="imp-tabpanel">
            {tab === 'options' && options}
            {tab === 'preview' && preview}
            {tab === 'mapping' && (mapping ?? <p class="cb-muted imp-pad">No result to map yet.</p>)}
            {tab === 'command' && command}
          </div>
        </>
      ) : (
        <div class="imp-body">
          <div class="imp-opts">{options}</div>
          <div class="imp-main">
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
