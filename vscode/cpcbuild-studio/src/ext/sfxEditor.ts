/**
 * sfxEditor.ts -- the sound-effects editor (.cpcsfx banks) as a custom editor. The document model
 * and every rule are in src/core/sfxDoc.ts, sfxOps.ts and sfxPresets.ts; this file is the glue:
 * parse/serialise, the view the webview draws, and the New Sound Effects Bank command.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SfxDoc, describeError, parseSfx, serialiseSfx, validateSfx } from '../core/sfxDoc';
import { SfxOp, applyOp } from '../core/sfxOps';
import { newBank } from '../core/sfxPresets';
import type { SfxView } from '../shared/protocol';
import { StudioDocument, StudioEditorProvider } from './customEditor';
import { findProjects, pickProject } from './projects';

export const SFX_VIEW_TYPE = 'cpcbuild.sfxEditor';

export class SfxEditorProvider extends StudioEditorProvider<SfxDoc, SfxOp, SfxView> {
  readonly viewType = SFX_VIEW_TYPE;
  readonly bundle = 'sfx';
  readonly title = 'CPC Sound Effects Editor';
  protected readonly worklet = 'ayWorklet';

  /** A file that does not exist yet (or is empty) opens as a new bank of one blip. */
  parse(text: string): SfxDoc {
    if (text.trim() === '') return newBank();
    const r = parseSfx(text);
    if (!r.doc) {
      const shown = r.errors.slice(0, 3).map(describeError).join('; ');
      throw new Error(`${shown}${r.errors.length > 3 ? ` (and ${r.errors.length - 3} more)` : ''}`);
    }
    return r.doc;
  }
  serialise(state: SfxDoc): string {
    return serialiseSfx(state);
  }
  saveProblem(state: SfxDoc): string | undefined {
    const e = validateSfx(state)[0];
    return e ? describeError(e) : undefined;
  }
  apply(state: SfxDoc, op: SfxOp) {
    return applyOp(state, op);
  }
  view(s: SfxDoc): Omit<SfxView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    return { doc: s, saveProblem: this.saveProblem(s) };
  }

  protected async handleRequest(doc: StudioDocument<SfxDoc>, name: string, args: unknown): Promise<unknown> {
    if (name === 'playInEmulator') throw new Error('Play in emulator is available after the build step');
    return super.handleRequest(doc, name, args);
  }
}

/** The first of sfx.cpcsfx, sfx2.cpcsfx, ... that does not exist in `dir`. */
export function freeBankName(dir: string): string {
  for (let n = 1; ; n++) {
    const f = n === 1 ? 'sfx.cpcsfx' : `sfx${n}.cpcsfx`;
    if (!fs.existsSync(path.join(dir, f))) return f;
  }
}

/** CPC Game Studio: New Sound Effects Bank. `args` lets tests and other commands choose the file or the project folder. */
export async function newSfxCommand(args?: { uri?: vscode.Uri; root?: string }): Promise<vscode.Uri | undefined> {
  let uri = args?.uri;
  if (!uri) {
    const root = args?.root ?? pickProject(await findProjects())?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void vscode.window.showInformationMessage('CPC Game Studio: open a project folder first.');
      return undefined;
    }
    const dir = path.join(root, 'assets');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    uri = vscode.Uri.file(path.join(dir, freeBankName(dir)));
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serialiseSfx(newBank()), 'utf8'));
  await vscode.commands.executeCommand('vscode.openWith', uri, SFX_VIEW_TYPE);
  return uri;
}
