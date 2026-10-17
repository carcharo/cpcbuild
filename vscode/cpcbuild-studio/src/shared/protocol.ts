/**
 * protocol.ts -- every host <-> webview message of the Studio editors, in one file so both sides
 * type-check against it (docs/phase8-design.md section 3).
 *
 * Shape: `{ type, ... }`. A webview asks with `{ type: 'request', id, name, args }` and the host
 * answers with `{ type: 'response', id, ok, result | error }`. The host pushes `init` (once,
 * after `ready`) and `view` (every time the document changes; it carries a version number the
 * webview echoes in its edits). The webview never encodes CPC bytes: it holds what the host
 * sends and sends back semantic edit operations.
 */
import type { PaletteError, PaletteKind, PaletteOp, Snippet } from '../core/paletteDoc';

export type { PaletteError, PaletteKind, PaletteOp, Snippet };

/** Settings the editors read (spec 6), sent in `init`. */
export interface EditorSettings {
  defaultZoom: number;
  showByteGrid: boolean;
  pixelAspect: 'square' | 'crt';
}

// ------------------------------------------------------------ generic part

/** Requests every editor understands. */
export interface BaseRequests {
  /** Host clipboard. */
  copy: { args: { text: string }; result: { ok: true } };
  /** Run the workbench undo / redo on the document (the stack belongs to VS Code). */
  history: { args: { action: 'undo' | 'redo' }; result: { ok: true } };
  /** Reopen the file in the plain text editor (the "Open as text" path). */
  openAsText: { args: Record<string, never>; result: { ok: true } };
}

/** A map of request name to { args, result } (interfaces qualify, unlike Record<string, ...>). */
export type RequestMap<R> = { [K in keyof R]: { args: unknown; result: unknown } };

export type WebToHost<R extends RequestMap<R>> =
  | { type: 'ready' }
  /** The first view (or the fatal state) is on screen without a render error: the smoke tests wait on this. */
  | { type: 'rendered' }
  /** An uncaught error in the webview; the host logs it and counts it (the smoke test). */
  | { type: 'error'; message: string }
  | { [K in keyof R & string]: { type: 'request'; id: number; name: K; args: R[K]['args'] } }[keyof R & string];

export type HostToWeb<V> =
  | { type: 'init'; settings: EditorSettings; fileName: string }
  | { type: 'view'; view: V }
  /** The document cannot be shown at all (it did not parse); the webview offers "Open as text". */
  | { type: 'fatal'; message: string }
  | { type: 'response'; id: number; ok: true; result: unknown }
  | { type: 'response'; id: number; ok: false; error: string };

/** Fields every document view carries. */
export interface ViewBase {
  /** The document version; an edit must quote it (stale edits are rejected and the view re-sent). */
  version: number;
  canUndo: boolean;
  canRedo: boolean;
  fileName: string;
}

// ----------------------------------------------------------- palette editor

export interface PaletteView extends ViewBase {
  kind: PaletteKind;
  /** fw: firmware colour per pen. rgb12: 0xRGB word. -1: bad token (see errors). */
  entries: number[];
  border: number | null;
  errors: PaletteError[];
  /** rgb12: the two ASIC bytes of each entry, from the shared codec. */
  asic: [number, number][];
  snippets: Snippet[];
  /** The tool's message that stops saving, if any. */
  saveProblem?: string;
}

export interface LoadPngResult {
  /** false when the dialog was cancelled. */
  loaded: boolean;
  file?: string;
  /** Distinct colours found, before any limit. */
  total?: number;
  /** How many were used (limited to the palette's capacity). */
  used?: number;
  message?: string;
}

export interface PaletteRequests extends BaseRequests {
  edit: { args: { baseVersion: number; op: PaletteOp }; result: { version: number } };
  loadPng: { args: { baseVersion: number; limit: number }; result: LoadPngResult };
}

export type PaletteToHost = WebToHost<PaletteRequests>;
export type PaletteToWeb = HostToWeb<PaletteView>;
