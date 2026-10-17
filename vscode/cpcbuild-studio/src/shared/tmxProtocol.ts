/**
 * tmxProtocol.ts -- host <-> webview messages of the .tmx viewer. The viewer is read-only: the
 * document never changes in the webview, so there are no edit operations; the webview asks for tile
 * atlases (the host reads the images), conversion, and a few actions.
 */
import type { TmxLayer, TmxObjectGroup } from '../core/tmx';
import type { BaseRequests, HostToWeb, ViewBase, WebToHost } from './protocol';

export type TileSource = 'image' | 'cpc' | 'cpctil';

export interface ViewTileset {
  firstgid: number;
  name: string;
  /** The external .tsx, if any. */
  source?: string;
  tilewidth: number;
  tileheight: number;
  columns?: number;
  tilecount?: number;
  /** Absolute path of the tileset image, when the tileset has one. */
  imagePath?: string;
  imageStatus: 'ok' | 'missing' | 'unreadable' | 'none';
  imageError?: string;
}

export interface ViewNotice {
  severity: 'info' | 'warning' | 'error';
  text: string;
}

export interface TmxViewerView extends ViewBase {
  /** Path relative to the project root (or the file name), forward slashes. */
  path: string;
  map: { width: number; height: number; tilewidth: number; tileheight: number; infinite: boolean };
  layers: TmxLayer[];
  tilesets: ViewTileset[];
  objectGroups: TmxObjectGroup[];
  notices: ViewNotice[];
  /** Where "Open in Tiled" goes, if Tiled was found. */
  tiled?: string;
  /** A .cpctil that matches the map's tileset, if one was found. */
  cpctil?: { file: string; tiles: number };
  /** Defaults of the convert form (tmx2bas.py's: name from the file stem). */
  convert: { name: string; output: string };
}

export interface WireAtlas {
  firstgid: number;
  tw: number;
  th: number;
  count: number;
  columns: number;
  width: number;
  height: number;
  /** RGBA, base64. */
  rgba: string;
}

export interface AtlasResult {
  atlases: WireAtlas[];
  notices: ViewNotice[];
}

export interface ConvertOptions {
  layer?: string;
  name?: string;
  firstgid?: number;
  empty?: number;
}

export interface ConvertResult {
  ok: boolean;
  /** Project-relative output path. */
  output: string;
  error?: string;
  /** Something to tell the user even on success. */
  engine?: string;
}

export interface TmxRequests extends BaseRequests {
  /** `firstgid`: the viewer's override (the .cpctil source numbers its tiles from it). */
  atlases: { args: { source: TileSource; mode: 0 | 1 | 2; firstgid?: number }; result: AtlasResult };
  convert: { args: ConvertOptions; result: ConvertResult };
  /** Inserts `TileMap(@name(0), 0, 0, name_W, name_H)` into the visible .bas editor, else copies it. */
  insertTileMap: { args: { name: string }; result: { inserted: boolean; text: string } };
  openInTiled: { args: Record<string, never>; result: { ok: boolean; error?: string } };
}

export type TmxToHost = WebToHost<TmxRequests>;
export type TmxToWeb = HostToWeb<TmxViewerView>;
