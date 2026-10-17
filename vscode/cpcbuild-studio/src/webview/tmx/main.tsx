/**
 * The .tmx viewer webview (S7): read-only. Draws the chosen tile layer with the atlases the host
 * built (Tiled images, a CPC preview, or a .cpctil), with a cell inspector, tile picking, an error
 * overlay (the converter's messages), object markers and a room-size overlay. One canvas that pans
 * and zooms itself, so a 255 x 255 map is one image blit, not thousands of DOM nodes.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TmxLayer } from '../../core/tmx';
import { Atlas, cellErrors, cellInfo, doTile8Call, effectiveFirstgid, hex2, layerWarnings, renderLayer } from '../../core/tmxView';
import type { TileSource, TmxRequests, TmxViewerView, ViewNotice, WireAtlas } from '../../shared/tmxProtocol';
import { startEditor, type EditorHost } from '../shared/bootstrap';
import { createClient } from '../shared/client';
import { Icon } from '../shared/components/Icon';
import { Notice } from '../shared/components/Notice';
import { StatusLine } from '../shared/components/StatusLine';
import { Toolbar, type ToolbarGroup } from '../shared/components/Toolbar';
import { themeVar, useThemeVersion, withAlpha } from '../shared/theme';
import './tmx.css';

type Host = EditorHost<TmxRequests, TmxViewerView>;
type Mode = 0 | 1 | 2;

interface Persisted {
  zoom?: number;
  fit?: boolean;
  grid?: boolean;
  numbers?: boolean;
  objects?: boolean;
  source?: TileSource;
  mode?: Mode;
  layer?: string;
  roomOn?: boolean;
  roomW?: number;
  roomH?: number;
}

const ZOOMS = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const ROOM_PRESETS: [number, number][] = [[20, 23], [20, 25], [40, 25], [80, 25]];

const decodeAtlas = (w: WireAtlas): Atlas => {
  const bin = atob(w.rgba);
  const rgba = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) rgba[i] = bin.charCodeAt(i);
  return { firstgid: w.firstgid, tw: w.tw, th: w.th, count: w.count, columns: w.columns, width: w.width, height: w.height, rgba };
};

const toCanvas = (rgba: Uint8Array, w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  c.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.byteLength), Math.max(1, w), Math.max(1, h)), 0, 0);
  return c;
};

const optInt = (t: string): number | undefined => (/^\s*\d+\s*$/.test(t) ? parseInt(t, 10) : undefined);

function TmxApp({ client, view }: Host) {
  const saved = client.getState<Persisted>() ?? {};
  const firstOk = Math.max(0, view.layers.findIndex((l) => l.gids));
  const savedIdx = saved.layer !== undefined ? view.layers.findIndex((l) => l.name === saved.layer) : -1;
  const [layerIdx, setLayerIdx] = useState(savedIdx >= 0 ? savedIdx : firstOk);
  const [firstgidText, setFirstgidText] = useState('');
  const [emptyText, setEmptyText] = useState('');
  const [zoom, setZoom] = useState(saved.zoom ?? 2);
  const [fit, setFit] = useState(saved.fit ?? true);
  const [grid, setGrid] = useState(saved.grid ?? true);
  const [numbers, setNumbers] = useState(saved.numbers ?? false);
  const [objectsOn, setObjectsOn] = useState(saved.objects ?? true);
  const [source, setSource] = useState<TileSource>(saved.source ?? 'image');
  const [mode, setMode] = useState<Mode>(saved.mode ?? 0);
  const [roomOn, setRoomOn] = useState(saved.roomOn ?? false);
  const [roomW, setRoomW] = useState(saved.roomW ?? 20);
  const [roomH, setRoomH] = useState(saved.roomH ?? 25);
  const [atlases, setAtlases] = useState<Atlas[]>([]);
  const [atlasNotices, setAtlasNotices] = useState<ViewNotice[]>([]);
  const [sel, setSel] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [pickedTile, setPickedTile] = useState<number | null>(null);
  const [msg, setMsg] = useState<ViewNotice | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [convName, setConvName] = useState('');

  const layer: TmxLayer | undefined = view.layers[Math.min(layerIdx, view.layers.length - 1)];
  const firstgidOverride = optInt(firstgidText);
  const emptyOverride = optInt(emptyText);
  const vopts = useMemo(() => ({ firstgid: firstgidOverride, empty: emptyOverride }), [firstgidOverride, emptyOverride]);
  // the viewer needs the model's functions: a minimal TmxMap from the view
  const map = useMemo(
    () => ({
      width: view.map.width, height: view.map.height, tilewidth: view.map.tilewidth, tileheight: view.map.tileheight,
      tilesets: view.tilesets.map((t) => ({ firstgid: t.firstgid, name: t.name })), layers: view.layers, objectGroups: view.objectGroups, infinite: view.map.infinite,
    }),
    [view],
  );
  const first = effectiveFirstgid(map, vopts);

  useEffect(() => client.setState({ zoom, fit, grid, numbers, objects: objectsOn, source, mode, layer: layer?.name, roomOn, roomW, roomH } satisfies Persisted), [zoom, fit, grid, numbers, objectsOn, source, mode, layer?.name, roomOn, roomW, roomH]);

  // atlases follow the tile source (and the firstgid for a .cpctil)
  useEffect(() => {
    let live = true;
    client
      .request('atlases', { source, mode, firstgid: firstgidOverride })
      .then((r) => {
        if (!live) return;
        setAtlases(r.atlases.map(decodeAtlas));
        setAtlasNotices(r.notices);
      })
      .catch((e: Error) => live && setMsg({ severity: 'error', text: e.message }));
    return () => {
      live = false;
    };
  }, [client, source, mode, view.version, source === 'cpctil' ? firstgidOverride : 0]);

  const errors = useMemo(() => (layer ? cellErrors(map, layer, vopts) : []), [map, layer, vopts]);
  const errorAt = useMemo(() => new Set(errors.map((e) => e.y * (layer?.width ?? 0) + e.x)), [errors, layer]);
  const warnings = useMemo(() => (layer ? layerWarnings(map, layer) : []), [map, layer]);
  const info = sel && layer ? cellInfo(map, layer, sel.x, sel.y, vopts) : undefined;
  const hoverInfo = hover && layer ? cellInfo(map, layer, hover.x, hover.y, vopts) : undefined;

  const copy = async (text: string, what: string): Promise<void> => {
    await client.request('copy', { text });
    setMsg({ severity: 'info', text: `Copied ${what}: ${text}` });
  };

  const names = view.convert.name;
  const generate = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await client.request('convert', { layer: layer?.name, name: convName || undefined, firstgid: firstgidOverride, empty: emptyOverride });
      setMsg(r.ok ? { severity: 'info', text: `Wrote ${r.output}` } : { severity: 'error', text: r.error ?? 'conversion failed' });
    } catch (e) {
      setMsg({ severity: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const insertTileMap = async (): Promise<void> => {
    const r = await client.request('insertTileMap', { name: convName || names });
    setMsg({ severity: 'info', text: r.inserted ? `Inserted ${r.text}` : `No .bas editor is open: copied ${r.text}` });
  };
  const openTiled = async (): Promise<void> => {
    const r = await client.request('openInTiled', {});
    if (!r.ok) setMsg({ severity: 'error', text: r.error ?? 'could not start Tiled' });
  };

  const nextError = (): void => {
    if (!errors.length || !layer) return;
    const cur = sel ? sel.y * layer.width + sel.x : -1;
    const n = errors.find((e) => e.y * layer.width + e.x > cur) ?? errors[0];
    setSel({ x: n.x, y: n.y });
  };

  const groups: ToolbarGroup[] = [
    {
      label: 'Zoom',
      items: [
        { id: 'zout', kind: 'button', label: 'Zoom out', icon: 'zoom-out', shortcut: '-', onActivate: () => { setFit(false); setZoom((z) => [...ZOOMS].reverse().find((s) => s < z) ?? ZOOMS[0]); } },
        { id: 'zin', kind: 'button', label: 'Zoom in', icon: 'zoom-in', shortcut: '+', onActivate: () => { setFit(false); setZoom((z) => ZOOMS.find((s) => s > z) ?? ZOOMS[ZOOMS.length - 1]); } },
        { id: 'fit', kind: 'button', label: 'Fit the map in the window', icon: 'screen-full', text: 'Fit', shortcut: '0', pressed: fit, onActivate: () => setFit(true) },
      ],
    },
    {
      label: 'Overlays',
      items: [
        { id: 'grid', kind: 'button', label: 'Grid', icon: 'symbol-array', shortcut: 'G', pressed: grid, onActivate: () => setGrid(!grid) },
        { id: 'num', kind: 'button', label: 'Tile numbers', icon: 'list-ordered', shortcut: 'N', pressed: numbers, onActivate: () => setNumbers(!numbers) },
        { id: 'obj', kind: 'button', label: 'Object markers', icon: 'location', pressed: objectsOn, onActivate: () => setObjectsOn(!objectsOn) },
        { id: 'room', kind: 'button', label: 'Room size overlay', icon: 'layout', text: 'Room', pressed: roomOn, onActivate: () => setRoomOn(!roomOn) },
      ],
    },
    {
      label: 'Tile colours',
      items: [
        {
          id: 'src', kind: 'menu', label: 'Tile colours', icon: 'paintcan', text: source === 'image' ? 'Tiled image' : source === 'cpc' ? `CPC mode ${mode}` : '.cpctil',
          items: [
            { id: 'src-image', label: 'Tiled image', checked: source === 'image', onActivate: () => setSource('image') },
            { id: 'src-cpc0', label: 'CPC preview, mode 0', checked: source === 'cpc' && mode === 0, onActivate: () => { setMode(0); setSource('cpc'); } },
            { id: 'src-cpc1', label: 'CPC preview, mode 1', checked: source === 'cpc' && mode === 1, onActivate: () => { setMode(1); setSource('cpc'); } },
            { id: 'src-cpc2', label: 'CPC preview, mode 2', checked: source === 'cpc' && mode === 2, onActivate: () => { setMode(2); setSource('cpc'); } },
            { id: 'src-til', label: view.cpctil ? `Tile set ${view.cpctil.file}` : 'Tile set (.cpctil): none found', checked: source === 'cpctil', disabled: !view.cpctil, onActivate: () => setSource('cpctil') },
          ],
        },
      ],
    },
  ];

  const notices: preact.ComponentChildren[] = [];
  for (const n of [...view.notices, ...atlasNotices]) {
    const key = n.text;
    if (!dismissed.has(key)) notices.push(<Notice key={key} severity={n.severity} onDismiss={() => setDismissed(new Set([...dismissed, key]))}>{n.text}</Notice>);
  }
  for (const w of warnings) {
    if (!dismissed.has(w)) notices.push(<Notice key={w} severity="warning" onDismiss={() => setDismissed(new Set([...dismissed, w]))}>{w}</Notice>);
  }
  if (layer?.error) notices.push(<Notice key="lerr" severity="error">{layer.error}</Notice>);
  if (msg) notices.push(<Notice key="msg" severity={msg.severity} onDismiss={() => setMsg(null)}>{msg.text}</Notice>);

  const pickTileNumber = (n: number): void => {
    if (!layer?.gids) return;
    setPickedTile(pickedTile === n ? null : n);
  };

  return (
    <div class="tmx">
      <h1 class="cb-visually-hidden">Tiled map {view.fileName}</h1>
      <Toolbar label="Map viewer" groups={groups} />
      <div class="tmx-form cb-row">
        <label>
          Layer{' '}
          <select class="cb-select" value={String(layerIdx)} onChange={(e) => { setLayerIdx(parseInt((e.target as HTMLSelectElement).value, 10)); setSel(null); }}>
            {view.layers.map((l, i) => <option key={i} value={String(i)}>{l.name || `layer ${i + 1}`}{l.gids ? '' : ' (cannot be read)'}</option>)}
          </select>
        </label>
        <label title="--firstgid: the gid of tile number 0. Empty = the first tileset's.">
          firstgid <input class="cb-input tmx-num" inputMode="numeric" placeholder={String(effectiveFirstgid(map))} value={firstgidText} onInput={(e) => setFirstgidText((e.target as HTMLInputElement).value)} aria-label="firstgid override" />
        </label>
        <label title="--empty: the tile number written for empty cells (0-255). Empty = 0.">
          empty <input class="cb-input tmx-num" inputMode="numeric" placeholder="0" value={emptyText} onInput={(e) => setEmptyText((e.target as HTMLInputElement).value)} aria-label="empty cell tile number" />
        </label>
        {roomOn && (
          <span class="cb-row tmx-room" role="group" aria-label="Room size in cells">
            <label>Room <input class="cb-input tmx-num" inputMode="numeric" value={String(roomW)} aria-label="Room width in cells" onInput={(e) => { const n = optInt((e.target as HTMLInputElement).value); if (n && n < 1000) setRoomW(n); }} /></label>
            <span aria-hidden="true">x</span>
            <input class="cb-input tmx-num" inputMode="numeric" value={String(roomH)} aria-label="Room height in cells" onInput={(e) => { const n = optInt((e.target as HTMLInputElement).value); if (n && n < 1000) setRoomH(n); }} />
            {ROOM_PRESETS.map(([w, h]) => <button key={`${w}x${h}`} type="button" class="cb-btn cb-btn-secondary" onClick={() => { setRoomW(w); setRoomH(h); }}>{w}x{h}</button>)}
          </span>
        )}
      </div>
      {notices.length > 0 && <div class="tmx-notices">{notices}</div>}
      <div class="tmx-body">
        {layer?.gids ? (
          <MapCanvas
            view={view} layer={layer} map={map} vopts={vopts} atlases={atlases} zoom={zoom} fit={fit} grid={grid} numbers={numbers} objectsOn={objectsOn}
            room={roomOn ? { w: roomW, h: roomH } : null} sel={sel} pickedTile={pickedTile} first={first} errorAt={errorAt}
            onZoom={(z) => { setFit(false); setZoom(z); }} onFitZoom={(z) => fit && setZoom(z)} onSelect={setSel} onHover={setHover}
            onToggle={(k) => (k === 'grid' ? setGrid(!grid) : k === 'numbers' ? setNumbers(!numbers) : setFit(true))} onNextError={nextError}
          />
        ) : (
          <div class="tmx-map"><p class="cb-muted">This layer cannot be drawn.</p></div>
        )}
        <aside class="tmx-side" aria-label="Tileset and cell">
          <section aria-labelledby="tmx-ts-h">
            <h2 id="tmx-ts-h" class="tmx-h">Tileset</h2>
            {atlases.length === 0 && <p class="cb-muted">No tileset image: cells are shown as numbers.</p>}
            {atlases.map((a) => <AtlasStrip key={a.firstgid} atlas={a} first={first} picked={pickedTile} onPick={pickTileNumber} />)}
            <label class="tmx-pick">
              Highlight tile number{' '}
              <input class="cb-input tmx-num" inputMode="numeric" value={pickedTile === null ? '' : String(pickedTile)} aria-label="Highlight every cell using tile number" onInput={(e) => setPickedTile(optInt((e.target as HTMLInputElement).value) ?? null)} />
            </label>
          </section>
          <section aria-labelledby="tmx-cell-h" class="tmx-cell">
            <h2 id="tmx-cell-h" class="tmx-h">{info ? `Cell (${info.x}, ${info.y})` : 'Cell'}</h2>
            {!info && <p class="cb-muted">Click a cell, or move with the arrow keys.</p>}
            {info && (
              <div aria-live="polite">
                <dl class="tmx-dl">
                  <dt>gid</dt><dd>{info.gid}{info.flags.length ? ` (flags: ${info.flags.join(', ')})` : ''}</dd>
                  {info.empty && <><dt>empty</dt><dd>yes, written as {info.tile}</dd></>}
                  {info.tile !== undefined && !info.empty && <><dt>tile number</dt><dd>{info.tile} <span class="cb-muted">{hex2(info.tile)}</span></dd></>}
                  {info.tileset !== undefined && view.tilesets[info.tileset] && <><dt>tileset</dt><dd>{view.tilesets[info.tileset].name}</dd></>}
                </dl>
                {info.error && <p class="tmx-err" role="alert"><Icon name="error" /> {info.error}</p>}
                <div class="cb-row">
                  <button type="button" class="cb-btn cb-btn-secondary" disabled={info.tile === undefined} onClick={() => info.tile !== undefined && void copy(String(info.tile), 'tile number')}>Copy tile number</button>
                  <button type="button" class="cb-btn cb-btn-secondary" disabled={info.tile === undefined} onClick={() => info.tile !== undefined && void copy(doTile8Call(info.x, info.y, info.tile), 'call')}>Copy DoTile8 call</button>
                </div>
              </div>
            )}
          </section>
          {view.objectGroups.some((g) => g.objects.length) && (
            <section aria-labelledby="tmx-obj-h">
              <h2 id="tmx-obj-h" class="tmx-h">Objects</h2>
              <ul class="tmx-objs">
                {view.objectGroups.flatMap((g) => g.objects.map((o) => <li key={`${g.name}${o.id}`}><span class="cb-mono">{o.name || `#${o.id}`}</span> <span class="cb-muted">{o.type || o.shape} at {Math.round(o.x)},{Math.round(o.y)}</span></li>))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      <div class="tmx-actions cb-row">
        <label>Array name <input class="cb-input" value={convName} placeholder={names} onInput={(e) => setConvName((e.target as HTMLInputElement).value)} aria-label="Array name for the generated include" /></label>
        <button type="button" class="cb-btn" disabled={busy || !layer?.gids} onClick={() => void generate()}>Generate .bas</button>
        <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void insertTileMap()}>Insert TileMap call</button>
        <button type="button" class="cb-btn cb-btn-secondary" disabled={!view.tiled} title={view.tiled ? `Open in ${view.tiled}` : 'Tiled was not found: install it or set cpcbuild.tiled.path'} onClick={() => void openTiled()}>Open in Tiled</button>
        <button type="button" class="cb-btn cb-btn-secondary" onClick={() => void client.request('openAsText', {})}>Open as text</button>
        {errors.length > 0 && <button type="button" class="cb-btn cb-btn-secondary" onClick={nextError}>Next error ({errors.length})</button>}
      </div>
      <StatusLine
        fields={[
          !!layer && { id: 'size', value: `${layer.width} x ${layer.height} cells` },
          !!layer && { id: 'layer', label: 'layer', value: layer.name },
          { id: 'zoom', label: 'zoom', value: `${Math.round(zoom * 100) / 100}x` },
          !!hover && !!hoverInfo && { id: 'hover', value: `(${hover.x}, ${hover.y}) gid ${hoverInfo.gid}${hoverInfo.tile !== undefined && !hoverInfo.empty ? ` -> tile ${hoverInfo.tile}` : ''}${roomOn ? ` room ${Math.floor(hover.x / roomW)},${Math.floor(hover.y / roomH)}` : ''}` },
          errors.length > 0 && { id: 'errs', value: `${errors.length} error cell${errors.length === 1 ? '' : 's'}` },
        ]}
        hint="Arrows move, Enter selects, Esc clears, F8 next error, Ctrl+wheel zooms"
      />
    </div>
  );
}

// ------------------------------------------------------------------ the tileset strip

function AtlasStrip({ atlas, first, picked, onPick }: { atlas: Atlas; first: number; picked: number | null; onPick(n: number): void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const scale = Math.max(1, Math.min(4, Math.floor(200 / atlas.width)));
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    c.width = atlas.width * scale;
    c.height = atlas.height * scale;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(toCanvas(atlas.rgba, atlas.width, atlas.height), 0, 0, c.width, c.height);
    ctx.strokeStyle = withAlpha(themeVar('--vscode-editorWidget-border', '#888'), 0.6);
    const tw = atlas.tw * scale;
    const th = atlas.th * scale;
    for (let k = 0; k < atlas.count; k++) ctx.strokeRect((k % atlas.columns) * tw + 0.5, Math.floor(k / atlas.columns) * th + 0.5, tw - 1, th - 1);
    if (picked !== null) {
      const k = first + picked - atlas.firstgid;
      if (k >= 0 && k < atlas.count) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = themeVar('--vscode-focusBorder', '#08f');
        ctx.strokeRect((k % atlas.columns) * tw + 1, Math.floor(k / atlas.columns) * th + 1, tw - 2, th - 2);
      }
    }
  }, [atlas, scale, picked, first, theme]);
  return (
    <canvas
      ref={ref}
      class="tmx-strip"
      role="img"
      aria-label={`Tileset, ${atlas.count} tiles. Click a tile to highlight every cell that uses it.`}
      onClick={(e) => {
        const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
        const x = Math.floor(((e.clientX - r.left) / r.width) * atlas.columns);
        const y = Math.floor(((e.clientY - r.top) / r.height) * Math.ceil(atlas.count / atlas.columns));
        const k = y * atlas.columns + x;
        if (k >= 0 && k < atlas.count) onPick(atlas.firstgid + k - first);
      }}
    />
  );
}

// ------------------------------------------------------------------ the map

interface MapProps {
  view: TmxViewerView;
  layer: TmxLayer;
  map: Parameters<typeof cellInfo>[0];
  vopts: { firstgid?: number; empty?: number };
  atlases: Atlas[];
  zoom: number;
  fit: boolean;
  grid: boolean;
  numbers: boolean;
  objectsOn: boolean;
  room: { w: number; h: number } | null;
  sel: { x: number; y: number } | null;
  pickedTile: number | null;
  first: number;
  errorAt: Set<number>;
  onZoom(z: number): void;
  onFitZoom(z: number): void;
  onSelect(c: { x: number; y: number } | null): void;
  onHover(c: { x: number; y: number } | null): void;
  onToggle(k: 'grid' | 'numbers' | 'fit'): void;
  onNextError(): void;
}

function MapCanvas(p: MapProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const cvs = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);
  const theme = useThemeVersion();
  const { layer, view } = p;
  const tw = view.map.tilewidth || 8;
  const th = view.map.tileheight || 8;
  const mapW = layer.width * tw;
  const mapH = layer.height * th;
  const haveImages = p.atlases.length > 0;

  // the whole layer at scale 1, built once per layer / atlas change
  const base = useMemo(() => {
    if (!layer.gids || !haveImages) return null;
    const img = renderLayer(layer.gids, layer.width, layer.height, tw, th, p.atlases);
    return toCanvas(img.data, img.width, img.height);
  }, [layer, p.atlases, tw, th, haveImages]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.max(100, el.clientWidth), h: Math.max(100, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  // fit: integer zoom when 1 or more, else a fraction
  const fitZoom = useMemo(() => {
    const z = Math.min(size.w / mapW, size.h / mapH);
    return z >= 1 ? Math.min(32, Math.floor(z)) : Math.max(0.05, Math.floor(z * 100) / 100);
  }, [size, mapW, mapH]);
  const zoom = p.fit ? fitZoom : p.zoom;
  useEffect(() => {
    if (p.fit) p.onFitZoom(fitZoom);
  }, [fitZoom, p.fit]);
  const cell = { w: tw * zoom, h: th * zoom };
  const content = { w: mapW * zoom, h: mapH * zoom };

  // keep the map inside the viewport (centred when smaller)
  const clampPan = (x: number, y: number): { x: number; y: number } => ({
    x: content.w <= size.w ? Math.round((size.w - content.w) / 2) : Math.min(0, Math.max(size.w - content.w, x)),
    y: content.h <= size.h ? Math.round((size.h - content.h) / 2) : Math.min(0, Math.max(size.h - content.h, y)),
  });
  const origin = clampPan(pan.x, pan.y);

  const cellAt = (cx: number, cy: number): { x: number; y: number } | null => {
    const x = Math.floor((cx - origin.x) / cell.w);
    const y = Math.floor((cy - origin.y) / cell.h);
    return x >= 0 && y >= 0 && x < layer.width && y < layer.height ? { x, y } : null;
  };

  const reveal = (c: { x: number; y: number }): void => {
    let { x: ox, y: oy } = origin;
    if (c.x * cell.w + ox < 0) ox = -c.x * cell.w;
    else if ((c.x + 1) * cell.w + ox > size.w) ox = size.w - (c.x + 1) * cell.w;
    if (c.y * cell.h + oy < 0) oy = -c.y * cell.h;
    else if ((c.y + 1) * cell.h + oy > size.h) oy = size.h - (c.y + 1) * cell.h;
    setPan({ x: ox, y: oy });
  };
  useEffect(() => {
    if (p.sel) reveal(p.sel);
  }, [p.sel?.x, p.sel?.y]);

  // ---- drawing
  useEffect(() => {
    const c = cvs.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !layer.gids) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(size.w * dpr);
    c.height = Math.floor(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = false;
    const fg = themeVar('--vscode-editor-foreground', '#ccc');
    const errC = themeVar('--vscode-errorForeground', '#f33');
    const focus = themeVar('--vscode-focusBorder', '#08f');
    const hi = themeVar('--vscode-editor-findMatchHighlightBackground', 'rgba(255,200,0,0.4)');
    const gridC = withAlpha(themeVar('--vscode-editorWidget-border', '#888'), 0.7);
    const roomC = themeVar('--vscode-charts-blue', '#3794ff');
    const objC = themeVar('--vscode-charts-orange', '#d18616');
    const { x: ox, y: oy } = origin;
    // a backdrop so transparent tiles are visible
    ctx.fillStyle = withAlpha(themeVar('--vscode-editorWidget-background', '#252526'), 1);
    ctx.fillRect(ox, oy, content.w, content.h);
    if (base) ctx.drawImage(base, 0, 0, mapW, mapH, ox, oy, content.w, content.h);

    // visible cell range
    const x0 = Math.max(0, Math.floor(-ox / cell.w));
    const y0 = Math.max(0, Math.floor(-oy / cell.h));
    const x1 = Math.min(layer.width - 1, Math.floor((size.w - ox) / cell.w));
    const y1 = Math.min(layer.height - 1, Math.floor((size.h - oy) / cell.h));
    const showNums = p.numbers ? cell.w >= 16 : !haveImages && cell.w >= 12;
    const cellPx = Math.min(cell.w, cell.h);
    ctx.font = `${Math.max(8, Math.min(14, Math.floor(cellPx * 0.45)))}px ${themeVar('--vscode-editor-font-family', 'monospace')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const raw = layer.gids[y * layer.width + x];
        const info = cellInfo(p.map, layer, x, y, p.vopts);
        if (!info) continue;
        const left = ox + x * cell.w;
        const top = oy + y * cell.h;
        if (!haveImages && !info.empty) {
          ctx.fillStyle = withAlpha(fg, 0.1);
          ctx.fillRect(left, top, cell.w, cell.h);
        }
        if (p.pickedTile !== null && info.tile === p.pickedTile && !info.empty) {
          ctx.fillStyle = hi;
          ctx.fillRect(left, top, cell.w, cell.h);
        }
        if (showNums && (raw & 0x0fffffff) !== 0) {
          const text = info.tile !== undefined ? String(info.tile) : '!';
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          const m = ctx.measureText(text).width;
          ctx.fillRect(left + cell.w / 2 - m / 2 - 2, top + cell.h / 2 - 7, m + 4, 14);
          ctx.fillStyle = '#fff';
          ctx.fillText(text, left + cell.w / 2, top + cell.h / 2 + 1);
        }
      }
    }
    // grid
    if (p.grid && cellPx >= 4) {
      ctx.strokeStyle = gridC;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) { const px = Math.round(ox + x * cell.w) + 0.5; ctx.moveTo(px, Math.max(0, oy)); ctx.lineTo(px, Math.min(size.h, oy + content.h)); }
      for (let y = y0; y <= y1 + 1; y++) { const py = Math.round(oy + y * cell.h) + 0.5; ctx.moveTo(Math.max(0, ox), py); ctx.lineTo(Math.min(size.w, ox + content.w), py); }
      ctx.stroke();
    }
    // room overlay
    if (p.room) {
      ctx.strokeStyle = roomC;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let x = 0; x <= layer.width; x += p.room.w) { const px = Math.round(ox + x * cell.w); ctx.moveTo(px, Math.max(0, oy)); ctx.lineTo(px, Math.min(size.h, oy + content.h)); }
      for (let y = 0; y <= layer.height; y += p.room.h) { const py = Math.round(oy + y * cell.h); ctx.moveTo(Math.max(0, ox), py); ctx.lineTo(Math.min(size.w, ox + content.w), py); }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // error cells
    ctx.strokeStyle = errC;
    ctx.lineWidth = 2;
    for (const i of p.errorAt) {
      const x = i % layer.width;
      const y = Math.floor(i / layer.width);
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      ctx.strokeRect(ox + x * cell.w + 1, oy + y * cell.h + 1, Math.max(2, cell.w - 2), Math.max(2, cell.h - 2));
    }
    // objects
    if (p.objectsOn) {
      ctx.strokeStyle = objC;
      ctx.fillStyle = objC;
      ctx.lineWidth = 1.5;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = `11px ${themeVar('--vscode-font-family', 'sans-serif')}`;
      for (const g of view.objectGroups) {
        for (const o of g.objects) {
          const sx = ox + o.x * zoom;
          const sy = oy + o.y * zoom;
          if (o.shape === 'point' || (!o.width && !o.height)) {
            ctx.beginPath();
            ctx.arc(sx, sy, 4, 0, Math.PI * 2);
            ctx.fill();
          } else if (o.shape === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(sx + (o.width * zoom) / 2, sy + (o.height * zoom) / 2, (o.width * zoom) / 2, (o.height * zoom) / 2, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else ctx.strokeRect(sx, sy, o.width * zoom, o.height * zoom);
          const label = [o.name, o.type].filter(Boolean).join(' : ');
          if (label) ctx.fillText(label, sx + 5, sy - 4);
        }
      }
    }
    // selection: a two-pass outline (light under dark) so it shows on any tile
    if (p.sel) {
      const left = ox + p.sel.x * cell.w;
      const top = oy + p.sel.y * cell.h;
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#000';
      ctx.strokeRect(left + 1.5, top + 1.5, Math.max(1, cell.w - 3), Math.max(1, cell.h - 3));
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = focus;
      ctx.strokeRect(left + 1.5, top + 1.5, Math.max(1, cell.w - 3), Math.max(1, cell.h - 3));
    }
  }, [base, size, origin.x, origin.y, zoom, p.grid, p.numbers, p.room?.w, p.room?.h, p.sel?.x, p.sel?.y, p.pickedTile, p.objectsOn, p.errorAt, p.vopts, layer, theme, view.objectGroups]);

  // ---- input
  const onKeyDown = (e: KeyboardEvent): void => {
    const s = p.sel ?? { x: 0, y: 0 };
    const mv = (dx: number, dy: number): void => {
      e.preventDefault();
      p.onSelect({ x: Math.max(0, Math.min(layer.width - 1, s.x + dx)), y: Math.max(0, Math.min(layer.height - 1, s.y + dy)) });
    };
    const step = e.shiftKey ? 8 : 1;
    if (e.key === 'ArrowLeft') mv(-step, 0);
    else if (e.key === 'ArrowRight') mv(step, 0);
    else if (e.key === 'ArrowUp') mv(0, -step);
    else if (e.key === 'ArrowDown') mv(0, step);
    else if (e.key === 'Enter') { e.preventDefault(); p.onSelect(p.sel ?? { x: 0, y: 0 }); }
    else if (e.key === 'Escape') p.onSelect(null);
    else if (e.key === 'F8') { e.preventDefault(); p.onNextError(); }
    else if (e.key === '+' || e.key === '=') p.onZoom(ZOOMS.find((z) => z > zoom) ?? zoom);
    else if (e.key === '-') p.onZoom([...ZOOMS].reverse().find((z) => z < zoom) ?? zoom);
    else if (e.key === '0') p.onToggle('fit');
    else if (e.key.toLowerCase() === 'g') p.onToggle('grid');
    else if (e.key.toLowerCase() === 'n') p.onToggle('numbers');
  };
  const rel = (e: MouseEvent | PointerEvent): { x: number; y: number } => {
    const r = (cvs.current as HTMLCanvasElement).getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <div
      class="tmx-map"
      ref={wrap}
      tabIndex={0}
      role="application"
      aria-label={`Map layer ${layer.name}, ${layer.width} by ${layer.height} cells. Arrow keys move the cell cursor.`}
      onKeyDown={onKeyDown as never}
    >
      <canvas
        ref={cvs}
        style={{ width: `${size.w}px`, height: `${size.h}px` }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const r = rel(e);
          drag.current = { x: r.x, y: r.y, px: origin.x, py: origin.y, moved: false };
          wrap.current?.focus();
        }}
        onPointerMove={(e) => {
          const r = rel(e);
          const d = drag.current;
          if (d && (d.moved || Math.abs(r.x - d.x) + Math.abs(r.y - d.y) > 4) && (content.w > size.w || content.h > size.h)) {
            d.moved = true;
            setPan(clampPan(d.px + r.x - d.x, d.py + r.y - d.y));
          } else p.onHover(cellAt(r.x, r.y));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const r = rel(e);
            p.onSelect(cellAt(r.x, r.y));
          }
        }}
        onPointerLeave={() => p.onHover(null)}
        onWheel={(e) => {
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            const next = e.deltaY < 0 ? ZOOMS.find((z) => z > zoom) : [...ZOOMS].reverse().find((z) => z < zoom);
            if (!next) return;
            const r = rel(e);
            const k = next / zoom;
            p.onZoom(next);
            setPan({ x: r.x - (r.x - origin.x) * k, y: r.y - (r.y - origin.y) * k });
          } else setPan(clampPan(origin.x - e.deltaX, origin.y - e.deltaY));
        }}
      />
    </div>
  );
}

startEditor(createClient<TmxRequests, TmxViewerView>(), TmxApp);
