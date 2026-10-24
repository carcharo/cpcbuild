/**
 * tmx.ts -- Tiled .tmx maps: parsing into a small model, and a port of
 * tools/tmx2bas.py's output (the same text for the same map and options).
 *
 * Supported, as in the Python tool: tile layers whose data is csv, or base64
 * with no compression, zlib or gzip. Infinite (chunked) maps, XML tile data
 * and zstd are recognised but reported as errors when that layer is used.
 *
 * Pure TypeScript, no vscode or node imports (pako for inflate, a tiny XML
 * reader below, atob for base64).
 */
import * as pako from 'pako';
import { baseName } from './pathtext';

export class TmxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TmxError';
  }
}

/** Top bits of a gid: flip flags (31-29) and hex rotation (28). */
export const GID_MASK = 0x0fffffff;

export interface TmxTileset {
  firstgid: number;
  name?: string;
  /** External .tsx file, if the tileset is not embedded. */
  source?: string;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
  margin?: number;
  spacing?: number;
  /** The tileset image (an image-collection tileset has none). `source` is relative to the .tmx (or the .tsx). */
  image?: { source: string; width?: number; height?: number };
}

export interface TmxObject {
  id: number;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  shape: 'rect' | 'point' | 'ellipse' | 'polygon' | 'polyline' | 'text' | 'tile';
}

export interface TmxObjectGroup {
  name: string;
  objects: TmxObject[];
}

export interface TmxLayer {
  name: string;
  width: number;
  height: number;
  /** Raw gids (flip flags included), row-major; null if the layer can't be decoded (see error). */
  gids: number[] | null;
  /** Why `gids` is null. */
  error?: string;
  /** Tiled's display attributes; the tool and the viewer ignore them (the viewer warns). */
  opacity?: number;
  offsetx?: number;
  offsety?: number;
}

export interface TmxMap {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  tilesets: TmxTileset[];
  /** Tile layers in document order. */
  layers: TmxLayer[];
  /** Object layers (viewer only). */
  objectGroups: TmxObjectGroup[];
  infinite: boolean;
}

// ---------------------------------------------------------------- mini XML

export interface El {
  tag: string;
  attrs: Record<string, string>;
  children: El[];
  /** Text before the first child element (ElementTree's .text). */
  text: string;
}

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e];
  });
}

/** A small non-validating XML reader: elements, attributes, text, CDATA; comments, PIs and DOCTYPE skipped. */
export function parseXml(src: string): El {
  let i = 0;
  const stack: El[] = [];
  let root: El | undefined;
  const bad = (m: string): never => {
    throw new TmxError(`XML error: ${m} (at offset ${i})`);
  };
  while (i < src.length) {
    if (src[i] !== '<') {
      const j = src.indexOf('<', i);
      const end = j < 0 ? src.length : j;
      const top = stack[stack.length - 1];
      if (top && top.children.length === 0) top.text += unescapeXml(src.slice(i, end));
      i = end;
    } else if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i + 4);
      if (j < 0) bad('unterminated comment');
      i = j + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0) bad('unterminated CDATA');
      const top = stack[stack.length - 1];
      if (top && top.children.length === 0) top.text += src.slice(i + 9, j);
      i = j + 3;
    } else if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i);
      if (j < 0) bad('unterminated processing instruction');
      i = j + 2;
    } else if (src.startsWith('<!', i)) {
      let depth = 0;
      let j = i;
      for (; j < src.length; j++) {
        if (src[j] === '<') depth++;
        else if (src[j] === '>' && --depth === 0) break;
      }
      i = j + 1;
    } else if (src.startsWith('</', i)) {
      const j = src.indexOf('>', i);
      if (j < 0) bad('unterminated end tag');
      const tag = src.slice(i + 2, j).trim();
      const top = stack.pop();
      if (!top || top.tag !== tag) bad(`mismatched tag </${tag}>`);
      i = j + 1;
    } else {
      const m = /^<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/.exec(src.slice(i, src.indexOf('>', i) + 1));
      if (!m) return bad('malformed tag');
      const el: El = { tag: m[1], attrs: {}, children: [], text: '' };
      for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]] = unescapeXml(a[2] ?? a[3]);
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) bad('more than one root element');
      else root = el;
      if (!m[3]) stack.push(el);
      i += m[0].length;
    }
  }
  if (stack.length) bad('unclosed element');
  if (!root) throw new TmxError('XML error: no root element');
  return root;
}

// ---------------------------------------------------------------- tmx

const intAttr = (v: string | undefined, dflt?: number): number => {
  if (v === undefined || v === '') {
    if (dflt === undefined) throw new TmxError('missing integer attribute');
    return dflt;
  }
  if (!/^\s*[+-]?\d+\s*$/.test(v)) throw new TmxError(`invalid integer ${JSON.stringify(v)}`);
  return parseInt(v, 10);
};

function decodeData(data: El, count: number): number[] {
  const enc = data.attrs.encoding;
  const comp = data.attrs.compression;
  const text = data.text;
  let gids: number[];
  if (enc === 'csv') {
    if (comp) throw new TmxError('csv data cannot be compressed');
    gids = text.replace(/\n/g, ',').split(',').filter((t) => t.trim()).map((t) => intAttr(t));
  } else if (enc === 'base64') {
    const bin = atob(text.replace(/\s+/g, ''));
    let raw = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (comp === undefined || comp === '') {
      // as is
    } else if (comp === 'zlib' || comp === 'gzip') {
      raw = pako.inflate(raw); // pako detects the zlib and gzip wrappers by their headers
    } else {
      throw new TmxError(`unsupported compression '${comp}' (use none, zlib or gzip)`);
    }
    if (raw.length !== 4 * count) throw new TmxError(`layer data is ${raw.length} bytes, expected ${4 * count}`);
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    gids = Array.from({ length: count }, (_, i) => dv.getUint32(i * 4, true));
  } else if (enc === undefined) {
    throw new TmxError('XML tile data is not supported (use csv or base64)');
  } else {
    throw new TmxError(`unsupported encoding '${enc}'`);
  }
  if (gids.length !== count) throw new TmxError(`layer has ${gids.length} cells, expected ${count}`);
  return gids;
}

const numAttr = (v: string | undefined): number | undefined => {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** The tileset attributes a .tsx file (or an embedded <tileset>) carries. */
function tilesetFields(t: El): Omit<TmxTileset, 'firstgid' | 'source'> {
  const img = t.children.find((c) => c.tag === 'image');
  return {
    name: t.attrs.name,
    tilewidth: numAttr(t.attrs.tilewidth),
    tileheight: numAttr(t.attrs.tileheight),
    columns: numAttr(t.attrs.columns),
    tilecount: numAttr(t.attrs.tilecount),
    margin: numAttr(t.attrs.margin),
    spacing: numAttr(t.attrs.spacing),
    image: img?.attrs.source ? { source: img.attrs.source, width: numAttr(img.attrs.width), height: numAttr(img.attrs.height) } : undefined,
  };
}

/** Reads an external tileset (.tsx): the fields to merge into the <tileset source="..."> entry of the map. */
export function parseTsx(xml: string): Omit<TmxTileset, 'firstgid' | 'source'> {
  const root = parseXml(xml);
  if (root.tag !== 'tileset') throw new TmxError(`not a Tiled tileset (root element <${root.tag}>)`);
  return tilesetFields(root);
}

function objectGroupOf(g: El): TmxObjectGroup {
  return {
    name: g.attrs.name ?? '',
    objects: g.children
      .filter((o) => o.tag === 'object')
      .map((o) => {
        const kid = (t: string): boolean => o.children.some((c) => c.tag === t);
        const shape: TmxObject['shape'] = kid('point') ? 'point' : kid('ellipse') ? 'ellipse' : kid('polygon') ? 'polygon' : kid('polyline') ? 'polyline' : kid('text') ? 'text' : o.attrs.gid ? 'tile' : 'rect';
        return {
          id: numAttr(o.attrs.id) ?? 0,
          name: o.attrs.name ?? '',
          type: o.attrs.type ?? o.attrs.class ?? '',
          x: numAttr(o.attrs.x) ?? 0,
          y: numAttr(o.attrs.y) ?? 0,
          width: numAttr(o.attrs.width) ?? 0,
          height: numAttr(o.attrs.height) ?? 0,
          shape,
        };
      }),
  };
}

/** Parses a .tmx document. Layers that can't be decoded are kept with `error` set. */
export function parseTmx(xml: string): TmxMap {
  const root = parseXml(xml);
  if (root.tag !== 'map') throw new TmxError(`not a Tiled map (root element <${root.tag}>)`);
  const mapW = root.attrs.width !== undefined ? intAttr(root.attrs.width) : 0;
  const mapH = root.attrs.height !== undefined ? intAttr(root.attrs.height) : 0;
  const tilesets: TmxTileset[] = root.children
    .filter((c) => c.tag === 'tileset')
    .map((t) => ({
      ...tilesetFields(t),
      firstgid: intAttr(t.attrs.firstgid, 1),
      source: t.attrs.source,
    }));
  const layers: TmxLayer[] = root.children
    .filter((c) => c.tag === 'layer')
    .map((l) => {
      const width = l.attrs.width ? intAttr(l.attrs.width) : mapW;
      const height = l.attrs.height ? intAttr(l.attrs.height) : mapH;
      const layer: TmxLayer = {
        name: l.attrs.name ?? '', width, height, gids: null,
        opacity: numAttr(l.attrs.opacity), offsetx: numAttr(l.attrs.offsetx), offsety: numAttr(l.attrs.offsety),
      };
      const data = l.children.find((c) => c.tag === 'data');
      try {
        if (!data) throw new TmxError('layer has no data');
        if (data.children.some((c) => c.tag === 'chunk')) throw new TmxError('infinite (chunked) maps are not supported');
        layer.gids = decodeData(data, width * height);
      } catch (e) {
        layer.error = (e as Error).message;
      }
      return layer;
    });
  return {
    width: mapW,
    height: mapH,
    tilewidth: root.attrs.tilewidth !== undefined ? intAttr(root.attrs.tilewidth) : 0,
    tileheight: root.attrs.tileheight !== undefined ? intAttr(root.attrs.tileheight) : 0,
    tilesets,
    layers,
    objectGroups: root.children.filter((c) => c.tag === 'objectgroup').map(objectGroupOf),
    infinite: root.attrs.infinite === '1',
  };
}

// ---------------------------------------------------------------- tmx2bas

export interface TmxToBasOptions {
  layer?: string;
  firstgid?: number;
  /** Tile number for empty cells (default 0). */
  empty?: number;
}

export interface TileLayer {
  tiles: number[];
  width: number;
  height: number;
  layerName: string;
}

/** Tile numbers of a layer: gid minus firstgid, flags stripped, empty cells -> `empty`. */
export function layerTiles(map: TmxMap, o: TmxToBasOptions = {}): TileLayer {
  if (!map.layers.length) throw new TmxError('no tile layers in the map');
  let layer: TmxLayer;
  if (o.layer === undefined) layer = map.layers[0];
  else {
    const found = map.layers.find((l) => l.name === o.layer);
    if (!found) throw new TmxError(`no tile layer '${o.layer}' (have: ${map.layers.map((l) => l.name || '?').join(', ')})`);
    layer = found;
  }
  const firstgid = o.firstgid ?? (map.tilesets.length ? map.tilesets[0].firstgid : 1);
  const empty = o.empty ?? 0;
  if (!layer.gids) throw new TmxError(layer.error ?? 'layer has no data');
  const tiles = layer.gids.map((raw, i) => {
    const gid = (raw & GID_MASK) >>> 0;
    let n: number;
    if (gid === 0) n = empty;
    else if (gid < firstgid) throw new TmxError(`cell ${i % layer.width},${Math.floor(i / layer.width)}: gid ${gid} is below firstgid ${firstgid}`);
    else n = gid - firstgid;
    if (n > 255) throw new TmxError(`cell ${i % layer.width},${Math.floor(i / layer.width)}: tile number ${n} does not fit in a byte`);
    return n;
  });
  return { tiles, width: layer.width, height: layer.height, layerName: layer.name };
}

/** Default array name for a map file: the stem, non-alphanumerics to "_", "map_" if empty or starting with a digit. */
export function defaultMapName(path: string): string {
  const base = baseName(path);
  const dot = base.lastIndexOf('.');
  const stem = [...(dot > 0 ? base.slice(0, dot) : base)].map((c) => (/[\p{L}\p{N}]/u.test(c) ? c : '_')).join('');
  return !stem || /^\d/.test(stem) ? 'map_' + stem : stem;
}

const quote = (s: string): string => (s === '' ? "''" : /^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : "'" + s.replace(/'/g, `'"'"'`) + "'");

/**
 * The .bas include tmx2bas.py writes. `argv` is the command line it was given
 * (recorded in the header), `source` the map's path as printed there.
 */
export function tmxToBas(map: TmxMap, name: string, o: TmxToBasOptions, argv: readonly string[], source: string): string {
  const { tiles, width: w, height: h, layerName } = layerTiles(map, o);
  const lines: string[] = [];
  for (let i = 0; i < tiles.length; i += 16) {
    const chunk = tiles.slice(i, i + 16).map((b) => '$' + b.toString(16).toUpperCase().padStart(2, '0')).join(', ');
    lines.push('    ' + chunk + (i + 16 < tiles.length ? ', _' : ' _'));
  }
  return (
    `' Generated by tmx2bas.py ${argv.map(quote).join(' ')}\n` +
    `' Source: ${source}, layer '${layerName}', ${w}x${h} tiles, ${tiles.length} bytes\n` +
    "' Do not edit; regenerate it from the source (command above).\n\n" +
    `DIM ${name}(${tiles.length - 1}) AS UBYTE => { _\n` + lines.join('\n') + '\n}\n\n' +
    `CONST ${name}_W AS UBYTE = ${w}\n` +
    `CONST ${name}_H AS UBYTE = ${h}\n`
  );
}
