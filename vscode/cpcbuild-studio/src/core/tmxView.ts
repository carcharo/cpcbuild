/**
 * tmxView.ts -- the model behind the .tmx viewer (spec 5.1): what a cell means (gid, flags, tile
 * number, the tool's error text), tileset atlases, and rendering a tile layer to a pixel buffer.
 *
 * Pure TypeScript: the host builds atlases (it reads the tileset images) and the webview renders
 * with the same code. The rules are tmx2bas.py's (see layerTiles in tmx.ts); the error texts are
 * the tool's, so a red cell says what the converter would say.
 */
import type { RgbaImage } from './image';
import { GID_MASK, TmxLayer, TmxMap } from './tmx';

export const FLIP_H = 0x80000000;
export const FLIP_V = 0x40000000;
export const FLIP_D = 0x20000000;
export const ROT_HEX = 0x10000000;

export interface ViewOptions {
  /** `--firstgid` (default: the first tileset's). */
  firstgid?: number;
  /** `--empty` (default 0). */
  empty?: number;
}

/** The firstgid tmx2bas.py subtracts. */
export function effectiveFirstgid(map: TmxMap, o: ViewOptions = {}): number {
  return o.firstgid ?? (map.tilesets.length ? map.tilesets[0].firstgid : 1);
}

export function flagNames(raw: number): string[] {
  const r = raw >>> 0;
  const out: string[] = [];
  if (r & FLIP_H) out.push('flipX');
  if (r & FLIP_V) out.push('flipY');
  if (r & FLIP_D) out.push('flipDiagonal');
  if (r & ROT_HEX) out.push('rotateHex');
  return out;
}

export interface CellInfo {
  x: number;
  y: number;
  /** The raw value with the flag bits. */
  raw: number;
  /** gid with the flags stripped. */
  gid: number;
  flags: string[];
  empty: boolean;
  /** Tile number the tool would write (`--empty` for an empty cell); undefined when the cell is an error. */
  tile?: number;
  /** The tool's message for this cell. */
  error?: string;
  /** Index into map.tilesets of the tileset the gid belongs to. */
  tileset?: number;
}

/** Index of the tileset a gid belongs to (the last whose firstgid is <= gid), or undefined. */
export function tilesetOfGid(map: TmxMap, gid: number): number | undefined {
  let best: number | undefined;
  map.tilesets.forEach((t, i) => {
    if (t.firstgid <= gid && (best === undefined || t.firstgid >= map.tilesets[best].firstgid)) best = i;
  });
  return best;
}

function judge(raw: number, x: number, y: number, firstgid: number, empty: number): Pick<CellInfo, 'gid' | 'empty' | 'tile' | 'error'> {
  const gid = (raw & GID_MASK) >>> 0;
  if (gid === 0) return { gid, empty: true, tile: empty };
  if (gid < firstgid) return { gid, empty: false, error: `cell ${x},${y}: gid ${gid} is below firstgid ${firstgid}` };
  const n = gid - firstgid;
  if (n > 255) return { gid, empty: false, error: `cell ${x},${y}: tile number ${n} does not fit in a byte` };
  return { gid, empty: false, tile: n };
}

export function cellInfo(map: TmxMap, layer: TmxLayer, x: number, y: number, o: ViewOptions = {}): CellInfo | undefined {
  if (!layer.gids || x < 0 || y < 0 || x >= layer.width || y >= layer.height) return undefined;
  const raw = layer.gids[y * layer.width + x] >>> 0;
  const j = judge(raw, x, y, effectiveFirstgid(map, o), o.empty ?? 0);
  return { x, y, raw, flags: flagNames(raw), tileset: j.gid ? tilesetOfGid(map, j.gid) : undefined, ...j };
}

export interface CellError {
  x: number;
  y: number;
  message: string;
}

/** Every cell the converter would refuse, in reading order. */
export function cellErrors(map: TmxMap, layer: TmxLayer, o: ViewOptions = {}): CellError[] {
  if (!layer.gids) return [];
  const first = effectiveFirstgid(map, o);
  const empty = o.empty ?? 0;
  const out: CellError[] = [];
  for (let i = 0; i < layer.gids.length; i++) {
    const x = i % layer.width;
    const y = Math.floor(i / layer.width);
    const j = judge(layer.gids[i], x, y, first, empty);
    if (j.error) out.push({ x, y, message: j.error });
  }
  return out;
}

/** Warnings about what the tool does not do with this layer (spec 5.1 edge cases). */
export function layerWarnings(map: TmxMap, layer: TmxLayer): string[] {
  const w: string[] = [];
  if (layer.opacity !== undefined && layer.opacity !== 1) w.push(`Layer opacity ${layer.opacity} is ignored.`);
  if (layer.offsetx || layer.offsety) w.push(`Layer offset (${layer.offsetx ?? 0}, ${layer.offsety ?? 0}) is ignored.`);
  if (layer.gids && map.tilesets.length > 1) {
    const later = map.tilesets.slice(1).map((t) => t.firstgid).filter((g) => g > map.tilesets[0].firstgid);
    const min = Math.min(...later);
    const hit = layer.gids.find((raw) => {
      const g = (raw & GID_MASK) >>> 0;
      return g !== 0 && g >= min;
    });
    if (hit !== undefined) w.push(`This layer uses tiles of a later tileset (gid ${(hit & GID_MASK) >>> 0}); tmx2bas.py counts from the first tileset's firstgid only, so those numbers may not mean what you expect.`);
  }
  return w;
}

// ------------------------------------------------------------------ atlas

/** Tiles of one tileset packed tight in a grid: tile k is at column k % columns, row floor(k / columns). */
export interface Atlas {
  /** gid of tile 0. */
  firstgid: number;
  tw: number;
  th: number;
  count: number;
  columns: number;
  width: number;
  height: number;
  /** RGBA, width x height. */
  rgba: Uint8Array;
}

export interface TileGeometry {
  tw: number;
  th: number;
  margin?: number;
  spacing?: number;
  /** From the tileset; computed from the image when absent. */
  columns?: number;
  count?: number;
  firstgid: number;
}

/** Cuts a tileset image into an atlas (margin and spacing removed). */
export function atlasFromImage(img: RgbaImage, g: TileGeometry): Atlas {
  const margin = g.margin ?? 0;
  const spacing = g.spacing ?? 0;
  const cols = g.columns && g.columns > 0 ? g.columns : Math.max(0, Math.floor((img.width - 2 * margin + spacing) / (g.tw + spacing)));
  const rows = Math.max(0, Math.floor((img.height - 2 * margin + spacing) / (g.th + spacing)));
  const count = Math.min(g.count && g.count > 0 ? g.count : cols * rows, cols * rows);
  const acols = Math.max(1, Math.min(cols, count));
  const arows = Math.max(1, Math.ceil(count / acols));
  const width = acols * g.tw;
  const height = arows * g.th;
  const rgba = new Uint8Array(width * height * 4);
  for (let k = 0; k < count; k++) {
    const sx = margin + (k % cols) * (g.tw + spacing);
    const sy = margin + Math.floor(k / cols) * (g.th + spacing);
    const dx = (k % acols) * g.tw;
    const dy = Math.floor(k / acols) * g.th;
    for (let y = 0; y < g.th; y++) {
      const s = ((sy + y) * img.width + sx) * 4;
      rgba.set(img.data.subarray(s, s + g.tw * 4), ((dy + y) * width + dx) * 4);
    }
  }
  return { firstgid: g.firstgid, tw: g.tw, th: g.th, count, columns: acols, width, height, rgba };
}

/** An atlas from tiles given as pen grids ([y][x], -1 = transparent) and a pen -> colour table (a .cpctil). */
export function atlasFromPens(tiles: readonly (readonly (readonly number[])[])[], rgbOfPen: (pen: number) => [number, number, number] | undefined, firstgid: number): Atlas {
  const th = tiles[0]?.length ?? 8;
  const tw = tiles[0]?.[0]?.length ?? 8;
  const count = tiles.length;
  const width = Math.max(1, count) * tw;
  const rgba = new Uint8Array(width * th * 4);
  tiles.forEach((t, k) => {
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const rgb = t[y][x] >= 0 ? rgbOfPen(t[y][x]) : undefined;
        if (!rgb) continue;
        const i = (y * width + k * tw + x) * 4;
        rgba[i] = rgb[0];
        rgba[i + 1] = rgb[1];
        rgba[i + 2] = rgb[2];
        rgba[i + 3] = 255;
      }
    }
  });
  return { firstgid, tw, th, count, columns: Math.max(1, count), width, height: th, rgba };
}

/** Why a tile set of tw x th tiles does not fit a map of mapTw x mapTh cells (a .cpctil may have narrow tiles), or undefined when it does. */
export function tileSizeNotice(tw: number, th: number, mapTw: number, mapTh: number): string | undefined {
  if (tw === mapTw && th === mapTh) return undefined;
  return `The tile set's tiles are ${tw}x${th} but the map's cells are ${mapTw}x${mapTh}; set the map's tile width and height to ${tw} and ${th} in Tiled so the tiles line up.`;
}

// ------------------------------------------------------------------ render

function atlasFor(atlases: readonly Atlas[], gid: number): Atlas | undefined {
  let best: Atlas | undefined;
  for (const a of atlases) if (a.firstgid <= gid && gid - a.firstgid < a.count && (!best || a.firstgid >= best.firstgid)) best = a;
  return best;
}

export interface RenderOptions {
  /** RGBA for empty or unresolvable cells (default fully transparent). */
  background?: [number, number, number, number];
}

/**
 * Draws a layer at scale 1: (w * tw) x (h * th) pixels. Cells with flip flags are drawn flipped (Tiled's
 * order: diagonal first, then horizontal, then vertical). A gid no atlas covers stays background.
 */
export function renderLayer(gids: readonly number[], w: number, h: number, tw: number, th: number, atlases: readonly Atlas[], o: RenderOptions = {}): RgbaImage {
  const width = w * tw;
  const height = h * th;
  const data = new Uint8Array(width * height * 4);
  const bg = o.background;
  if (bg && bg.some((v) => v !== 0)) {
    for (let i = 0; i < width * height; i++) data.set(bg, i * 4);
  }
  for (let cy = 0; cy < h; cy++) {
    for (let cx = 0; cx < w; cx++) {
      const raw = gids[cy * w + cx] >>> 0;
      const gid = (raw & GID_MASK) >>> 0;
      if (!gid) continue;
      const a = atlasFor(atlases, gid);
      if (!a) continue;
      const k = gid - a.firstgid;
      const sx0 = (k % a.columns) * a.tw;
      const sy0 = Math.floor(k / a.columns) * a.th;
      const fh = (raw & FLIP_H) !== 0;
      const fv = (raw & FLIP_V) !== 0;
      const fd = (raw & FLIP_D) !== 0 && a.tw === a.th;
      for (let y = 0; y < th; y++) {
        const dy = cy * th + y;
        for (let x = 0; x < tw; x++) {
          // inverse of: diagonal, then horizontal, then vertical flip
          const ax = fh ? a.tw - 1 - x : x;
          const ay = fv ? a.th - 1 - y : y;
          const sx = sx0 + (fd ? ay : ax);
          const sy = sy0 + (fd ? ax : ay);
          if (sx >= a.width || sy >= a.height || x >= a.tw || y >= a.th) continue;
          const s = (sy * a.width + sx) * 4;
          const alpha = a.rgba[s + 3];
          if (!alpha) continue;
          const d = (dy * width + cx * tw + x) * 4;
          data[d] = a.rgba[s];
          data[d + 1] = a.rgba[s + 1];
          data[d + 2] = a.rgba[s + 2];
          data[d + 3] = alpha;
        }
      }
    }
  }
  return { width, height, data };
}

// ------------------------------------------------------------------ snippets

export const doTile8Call = (x: number, y: number, tile: number): string => `DoTile8(${x}, ${y}, ${tile})`;

/** The call that draws the generated array (names as tmx2bas.py makes them). */
export function tileMapCall(name: string, x = 0, y = 0): string {
  return `TileMap(@${name}(0), ${x}, ${y}, ${name}_W, ${name}_H)`;
}

export const hex2 = (n: number): string => '$' + n.toString(16).toUpperCase().padStart(2, '0');
