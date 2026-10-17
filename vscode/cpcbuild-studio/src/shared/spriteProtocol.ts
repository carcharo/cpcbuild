/**
 * spriteProtocol.ts -- the host <-> webview messages of the sprite and tile editor (docs/phase8-design.md
 * section 3). Generic parts (init, view, request, response) are in protocol.ts; this file adds this
 * editor's view and requests. The view carries row strings (as in the file) and the host's findings; the
 * webview sends semantic operations (src/core/spriteDoc.ts SpriteOp) and never encodes CPC bytes.
 */
import type { BaseRequests, HostToWeb, ViewBase, WebToHost } from './protocol';
import type { DocType, Kind, PlusFormat, SpriteOp } from '../core/spriteDoc';
import type { Mode } from '../core/pixels';

export type { SpriteOp };

export interface AssetSnippetView {
  id: string;
  label: string;
  text: string;
}

export interface SpriteView extends ViewBase {
  docType: DocType;
  kind: Kind;
  mode: Mode;
  name: string;
  /** Item (frame / tile) size in pixels. */
  w: number;
  h: number;
  masked: boolean;
  /** Frames or tiles as row strings ('.' transparent; Plus: '0' transparent), as in the file. */
  items: string[][];
  /** Resolved firmware pens (CPC) or sprite colours as "RGB" hex (Plus). Absent when a palette file cannot be read. */
  pens?: number[];
  colours?: string[];
  /** The shared palette file, as written in the document. */
  paletteFile?: string;
  paletteProblem?: string;
  output: string;
  emitPalette: boolean;
  dedupe: boolean;
  packed: boolean;
  plusFormat: PlusFormat;
  analysis: {
    ppb: number;
    wBytes?: number;
    itemBytes: number;
    totalBytes: number;
    problems: string[];
    warnings: string[];
    duplicates: [number, number][];
    transparentAsPen0: number;
  };
  /** The message of the exporter if generating would fail (the tool's wording). */
  exportProblem?: string;
  /** Output file vs what would be generated now. */
  outputState: 'unknown' | 'missing' | 'current' | 'stale';
  /** Result of the last generate (button, command or on save); `seq` changes each time so the webview can show it once. */
  generated?: { seq: number; ok: boolean; message: string };
  generateOnSave: boolean;
  limit: number;
  snippets: AssetSnippetView[];
  /** The equivalent img2cpc.py command (spec 4.2). */
  command: string;
}

export interface GenerateResult {
  ok: boolean;
  message: string;
  written: string[];
}

export interface SpriteRequests extends BaseRequests {
  edit: { args: { baseVersion: number; op: SpriteOp }; result: { version: number } };
  generate: { args: Record<string, never>; result: GenerateResult };
  /** Use a shared .cpcpal / .cpcpal12 (a path as written in the document; absent = ask with a file dialog). */
  setPaletteFile: { args: { baseVersion: number; file?: string }; result: { used: boolean; file?: string; message?: string } };
  /** Copy the palette in use into the document and stop sharing the file. */
  inlinePalette: { args: { baseVersion: number }; result: { ok: true } };
  openPalette: { args: Record<string, never>; result: { ok: true } };
  /** Take a PNG into a frame, quantised with the document palette (a file dialog). */
  importPng: { args: { baseVersion: number; item: number }; result: { taken: boolean; message?: string } };
  /** Save the sheet as a PNG in the palette's colours (a save dialog). */
  exportPng: { args: Record<string, never>; result: { saved: boolean; file?: string } };
}

export type SpriteToHost = WebToHost<SpriteRequests>;
export type SpriteToWeb = HostToWeb<SpriteView>;
