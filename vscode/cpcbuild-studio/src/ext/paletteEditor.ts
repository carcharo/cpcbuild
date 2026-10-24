/**
 * paletteEditor.ts -- the palette editor (.cpcpal firmware palettes, .cpcpal12 Plus palettes) as a
 * custom editor. The document model and every rule are in src/core/paletteDoc.ts; this file is the
 * glue: parse/serialise by file kind, the view the webview draws, and "Load from PNG".
 */
import * as vscode from 'vscode';
import { decodePng } from '../core/image';
import { toPix } from '../core/img2cpc';
import { nearestFw, rgb12 } from '../core/palette';
import {
  PaletteOp,
  PaletteState,
  applyOp,
  coloursOfImage,
  emptyPaletteText,
  entryBytes,
  kindForFile,
  maxEntries,
  parsePalette,
  saveProblem,
  serialise,
  snippets,
} from '../core/paletteDoc';
import type { LoadPngResult, PaletteView } from '../shared/protocol';
import { getChannel } from './channel';
import { StudioDocument, StudioEditorProvider } from './customEditor';

export const PALETTE_VIEW_TYPE = 'cpcbuild.paletteEditor';

export class PaletteEditorProvider extends StudioEditorProvider<PaletteState, PaletteOp, PaletteView> {
  readonly viewType = PALETTE_VIEW_TYPE;
  readonly bundle = 'palette';
  readonly title = 'CPC Palette Editor';

  /** Test hook: answers the "Load from PNG" file dialog without showing it. */
  pngOverride?: vscode.Uri;

  /** Called after a save (wired in activate): regenerates the sprite / tile documents that share this palette file. */
  onSaved?: (uri: vscode.Uri) => Promise<unknown>;

  protected async afterSave(doc: StudioDocument<PaletteState>): Promise<void> {
    try {
      await this.onSaved?.(doc.uri);
    } catch (e) {
      getChannel().appendLine(`${this.title}: ${doc.uri.fsPath}: regenerating the sprites that use it failed: ${(e as Error).message}`);
    }
  }

  parse(text: string, uri: vscode.Uri): PaletteState {
    return parsePalette(text, kindForFile(uri.path));
  }
  serialise(state: PaletteState): string {
    return serialise(state);
  }
  saveProblem(state: PaletteState): string | undefined {
    return saveProblem(state);
  }
  apply(state: PaletteState, op: PaletteOp) {
    return applyOp(state, op);
  }
  view(s: PaletteState): Omit<PaletteView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    return {
      kind: s.kind,
      entries: s.entries,
      border: s.border,
      errors: s.errors,
      asic: s.kind === 'rgb12' ? s.entries.map((v) => (v < 0 ? [0, 0] : entryBytes(v))) : [],
      snippets: snippets(s),
      saveProblem: saveProblem(s),
    };
  }

  protected async handleRequest(doc: StudioDocument<PaletteState>, name: string, args: unknown): Promise<unknown> {
    if (name === 'loadPng') return this.loadPng(doc, args as { baseVersion: number; limit: number });
    return super.handleRequest(doc, name, args);
  }

  /** "Load from PNG" (spec 4.1 US7): colours by the importer's rule; the image is only read. */
  private async loadPng(doc: StudioDocument<PaletteState>, a: { baseVersion: number; limit: number }): Promise<LoadPngResult> {
    if (a.baseVersion !== doc.version) {
      this.broadcast(doc);
      throw new Error('the document changed in another view; try again');
    }
    const picked =
      this.pngOverride ??
      (await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Images: ['png'] }, openLabel: 'Take colours', title: 'Take palette colours from a PNG' }))?.[0];
    if (!picked) return { loaded: false };
    const img = decodePng(await vscode.workspace.fs.readFile(picked));
    const all = coloursOfImage(doc.state.kind, toPix(img).flat(), nearestFw, rgb12);
    if (!all.length) return { loaded: false, file: picked.fsPath, message: `${picked.path.split('/').pop()} has no opaque pixels` };
    const limit = Math.max(1, Math.min(a.limit, maxEntries(doc.state.kind)));
    const used = all.slice(0, limit);
    this.commit(doc, { op: 'replace', entries: used, label: 'Load palette from image' });
    return { loaded: true, file: picked.fsPath, total: all.length, used: used.length };
  }
}

const DIALOG_FILTER = { Palette: ['cpcpal', 'cpcpal12'] };

/** CPC Game Studio: New Palette. `args` lets tests and other commands skip the prompts. */
export async function newPaletteCommand(args?: { uri?: vscode.Uri; plus?: boolean }): Promise<vscode.Uri | undefined> {
  let plus = args?.plus;
  if (plus === undefined && !args?.uri) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Firmware palette', description: '.cpcpal: pens as firmware colours 0-26 (modes 0, 1, 2)', plus: false },
        { label: 'Plus palette', description: '.cpcpal12: 12-bit colours (CPC Plus)', plus: true },
      ],
      { title: 'CPC Game Studio: new palette' },
    );
    if (!pick) return undefined;
    plus = pick.plus;
  }
  let uri = args?.uri;
  if (!uri) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    uri = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, plus ? 'palette.cpcpal12' : 'palette.cpcpal') : undefined,
      filters: DIALOG_FILTER,
      title: 'New palette',
    });
    if (!uri) return undefined;
  }
  const kind = kindForFile(uri.path);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(emptyPaletteText(kind), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, PALETTE_VIEW_TYPE);
  return uri;
}
