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
import { sfxBankName, sfxOutputs, sfxTargetsOf, sfxUseEdits, sfxUseSnippet, SFX_GLOB, withSfxGlob } from '../core/sfxBuild';
import { Vt2Error, sfxToVt2 } from '../core/vt2';
import type { SfxView } from '../shared/protocol';
import { StudioDocument, StudioEditorProvider } from './customEditor';
import { absFrom, readSettings } from './config';
import { NOT_IN_PROJECT, projectRootOf } from './importer';
import { musicPlayCommand } from './music';
import { findProjects, loadProjectFile, pickProject, PROJECT_FILE } from './projects';

export const SFX_VIEW_TYPE = 'cpcbuild.sfxEditor';

/** The effect last selected in each open bank's editor (by URI), for Insert Asset Use from the palette or title bar. */
const selectedEffect = new Map<string, number>();

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
  view(s: SfxDoc, doc: StudioDocument<SfxDoc>): Omit<SfxView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    return { doc: s, saveProblem: this.saveProblem(s), bank: sfxBankName(doc.uri.fsPath) };
  }

  protected async handleRequest(doc: StudioDocument<SfxDoc>, name: string, args: unknown): Promise<unknown> {
    if (name === 'playInEmulator') return this.playInEmulator(doc, (args as { effect: number }).effect);
    if (name === 'select') {
      selectedEffect.set(doc.uri.toString(), (args as { effect: number }).effect);
      return { ok: true };
    }
    if (name === 'insertUse') {
      const effect = (args as { effect: number }).effect;
      selectedEffect.set(doc.uri.toString(), effect);
      await insertSfxUse(doc.uri, effect);
      return { ok: true };
    }
    return super.handleRequest(doc, name, args);
  }

  /**
   * Plays one effect of the bank as it is in the editor (saved or not) with the real player: the bank is
   * written as a .vt2 under the build folder's .preview and goes through Play Music. The emulator is a CPC,
   * so the module is the CPC one whatever clock the AY preview is set to.
   */
  private async playInEmulator(doc: StudioDocument<SfxDoc>, effect: number): Promise<{ ok: true }> {
    const file = doc.uri.fsPath;
    if (!Number.isInteger(effect) || effect < 0 || effect >= doc.state.effects.length) throw new Error('choose an effect of the bank first');
    const root = projectRootOf(file);
    if (!root) throw new Error(`${path.basename(file)} is ${NOT_IN_PROJECT}`);
    const bank = sfxBankName(file);
    let vt2: string;
    try {
      vt2 = sfxToVt2(doc.state, 'cpc', bank);
    } catch (e) {
      if (e instanceof Vt2Error) throw new Error(e.message);
      throw e;
    }
    const dir = path.join(absFrom(root, readSettings(root).outputDir), '.preview');
    fs.mkdirSync(dir, { recursive: true });
    const input = path.join(dir, `${bank}.vt2`);
    fs.writeFileSync(input, vt2, 'utf8');
    const r = await musicPlayCommand({ uri: vscode.Uri.file(input), sfx: true, name: bank, effect: effect + 1, quiet: true });
    if (!r?.ok) throw new Error(r?.error ?? 'the emulator preview did not start');
    void vscode.window.setStatusBarMessage(`CPC Game Studio: playing effect ${effect + 1} (${doc.state.effects[effect].name}) in the emulator; ESC or Stop Music ends it`, 5000);
    return { ok: true };
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
  await coverInProject(uri.fsPath);
  await vscode.commands.executeCommand('vscode.openWith', uri, SFX_VIEW_TYPE);
  return uri;
}

export const SFX_FILE = /\.cpcsfx$/i;

/** The .cpcsfx shown by a tab (custom editor or text), if it is one. */
export function sfxTabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  const u = input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText ? input.uri : undefined;
  return u && SFX_FILE.test(u.path) ? u : undefined;
}

/**
 * Insert Asset Use for a bank: the includes and SfxInit go once, below the code's #include lines (only the
 * ones missing), and a SfxPlay of the selected effect goes at the cursor of the visible code editor (all of
 * it is copied when none is visible). The include is the CPC one, or the Spectrum one in a Spectrum-only project.
 */
export async function insertSfxUse(target: vscode.Uri, effect?: number): Promise<string | undefined> {
  const text = Buffer.from(await vscode.workspace.fs.readFile(target)).toString('utf8');
  const r = parseSfx(text);
  if (!r.doc) {
    void vscode.window.showErrorMessage(`CPC Game Studio: ${r.errors.slice(0, 2).map(describeError).join('; ')}`);
    return undefined;
  }
  const fx = effect ?? selectedEffect.get(target.toString()) ?? 0;
  const code = vscode.window.visibleTextEditors.find((e) => /\.(bas|zxb|zxbas)$/i.test(e.document.fileName)) ?? vscode.window.visibleTextEditors.find((e) => e.document.uri.scheme === 'file' && !SFX_FILE.test(e.document.fileName) && !/\.(cpcspr|cpctil)$/i.test(e.document.fileName));
  const root = projectRootOf(target.fsPath);
  const archs = root ? loadProjectFile(path.join(root, PROJECT_FILE)).project?.targets.map((t) => t.arch) : undefined;
  const out = sfxOutputs(target.fsPath, archs ? sfxTargetsOf(archs).slice(0, 1) : ['cpc'])[0].bas;
  const rel = code ? path.relative(path.dirname(code.document.uri.fsPath), out).split(path.sep).join('/') : path.basename(out);
  const bank = sfxBankName(target.fsPath);
  if (code) {
    const at = code.selection.active;
    const edits = sfxUseEdits(code.document.getText(), r.doc, bank, rel, fx, { line: at.line, col: at.character });
    await code.edit((b) => {
      for (const e of edits) b.insert(new vscode.Position(e.line, e.col), e.text);
    });
    const added = edits.length > 1 ? edits[0].text.split('\n').length - 1 : 0;
    void vscode.window.setStatusBarMessage(added ? `CPC Game Studio: added ${added} setup line${added === 1 ? '' : 's'} below the includes, and the SfxPlay at the cursor` : 'CPC Game Studio: added the SfxPlay at the cursor (the setup lines were there already)', 5000);
    return edits.map((e) => e.text).join('');
  }
  const insert = sfxUseSnippet(r.doc, bank, rel, fx);
  await vscode.env.clipboard.writeText(insert);
  void vscode.window.showInformationMessage('CPC Game Studio: no code editor is visible, so the include and call lines were copied to the clipboard. Open your .bas beside the bank to insert them at the cursor.');
  return insert;
}

/** Adds the .cpcsfx glob to the nearest cpcbuild.json above `file` when its "assets" do not cover it, so builds convert the bank. */
async function coverInProject(file: string): Promise<void> {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const json = path.join(dir, 'cpcbuild.json');
    if (fs.existsSync(json)) {
      const next = withSfxGlob(fs.readFileSync(json, 'utf8'), path.relative(dir, file).split(path.sep).join('/'));
      if (next !== undefined) {
        fs.writeFileSync(json, next);
        void vscode.window.showInformationMessage(`CPC Game Studio: added "${SFX_GLOB}" to cpcbuild.json's assets, so builds convert the bank.`);
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}
