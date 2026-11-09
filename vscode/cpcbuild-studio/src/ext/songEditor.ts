/**
 * songEditor.ts -- the music tracker (.cpcsong) as a custom editor. The document model and every rule are in
 * src/core/songDoc.ts, songOps.ts and songBuild.ts; this file is the glue: parse/serialise, the view the
 * webview draws, Play in emulator, the remembered "keys shown" choice and the New Song command.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { SongDoc, describeSongError, newSong, parseSong, serialiseSong, validateSong } from '../core/songDoc';
import { SongOp, applySongOp } from '../core/songOps';
import { demoSong } from '../core/songDemo';
import { SONG_GLOB, songBankName, songOutputs, withSongGlob } from '../core/songBuild';
import { Vt2Error, songProblems, songToVt2 } from '../core/vt2';
import type { SongView } from '../shared/protocol';
import { StudioDocument, StudioEditorProvider } from './customEditor';
import { absFrom, readSettings } from './config';
import { NOT_IN_PROJECT, projectRootOf } from './importer';
import { musicPlayCommand } from './music';
import { findProjects, pickProject } from './projects';

export const SONG_VIEW_TYPE = 'cpcbuild.songEditor';
export const SONG_FILE = /\.cpcsong$/i;
/** globalState key: { wide?: boolean, narrow?: boolean } */
const KEYS_KEY = 'cpcbuild.tracker.keysShown';

type KeysShown = { wide?: boolean; narrow?: boolean };

export class SongEditorProvider extends StudioEditorProvider<SongDoc, SongOp, SongView> {
  readonly viewType = SONG_VIEW_TYPE;
  readonly bundle = 'tracker';
  readonly title = 'CPC Music Tracker';
  protected readonly worklet = 'ayWorklet';

  /** An empty file opens as a new song (one empty pattern). */
  parse(text: string): SongDoc {
    if (text.trim() === '') return newSong();
    const r = parseSong(text);
    if (!r.doc) {
      const shown = r.errors.slice(0, 3).map(describeSongError).join('; ');
      throw new Error(`${shown}${r.errors.length > 3 ? ` (and ${r.errors.length - 3} more)` : ''}`);
    }
    return r.doc;
  }
  serialise(state: SongDoc): string {
    return serialiseSong(state);
  }
  saveProblem(state: SongDoc): string | undefined {
    const e = validateSong(state)[0];
    return e ? describeSongError(e) : undefined;
  }
  apply(state: SongDoc, op: SongOp) {
    return applySongOp(state, op);
  }
  view(s: SongDoc, doc: StudioDocument<SongDoc>): Omit<SongView, 'version' | 'canUndo' | 'canRedo' | 'fileName'> {
    const stem = path.basename(doc.uri.fsPath);
    return {
      doc: s,
      saveProblem: this.saveProblem(s),
      problems: songProblems(s),
      song: songBankName(stem),
      include: path.basename(songOutputs(stem).bas),
      keys: this.keysShown(),
    };
  }

  private keysShown(): KeysShown {
    const v = this.context.globalState.get<KeysShown>(KEYS_KEY);
    return { wide: typeof v?.wide === 'boolean' ? v.wide : undefined, narrow: typeof v?.narrow === 'boolean' ? v.narrow : undefined };
  }

  protected async handleRequest(doc: StudioDocument<SongDoc>, name: string, args: unknown): Promise<unknown> {
    if (name === 'playInEmulator') return this.playInEmulator(doc);
    if (name === 'setKeys') {
      const a = args as { width: 'wide' | 'narrow'; shown: boolean };
      if ((a.width !== 'wide' && a.width !== 'narrow') || typeof a.shown !== 'boolean') throw new Error('bad keys request');
      await this.context.globalState.update(KEYS_KEY, { ...this.keysShown(), [a.width]: a.shown });
      return { ok: true };
    }
    return super.handleRequest(doc, name, args);
  }

  /**
   * Plays the song as it is in the editor (saved or not) with the real player: it is written as a .vt2 under the
   * build folder's .preview and goes through Play Music as a song.
   */
  private async playInEmulator(doc: StudioDocument<SongDoc>): Promise<{ ok: true }> {
    const file = doc.uri.fsPath;
    const root = projectRootOf(file);
    if (!root) throw new Error(`${path.basename(file)} is ${NOT_IN_PROJECT}`);
    const name = songBankName(path.basename(file));
    let vt2: string;
    try {
      vt2 = songToVt2(doc.state, name);
    } catch (e) {
      if (e instanceof Vt2Error) throw new Error(e.message);
      throw e;
    }
    const dir = path.join(absFrom(root, readSettings(root).outputDir), '.preview');
    fs.mkdirSync(dir, { recursive: true });
    const input = path.join(dir, `${name}.vt2`);
    fs.writeFileSync(input, vt2, 'utf8');
    const r = await musicPlayCommand({ uri: vscode.Uri.file(input), name, quiet: true });
    if (!r?.ok) throw new Error(r?.error ?? 'the emulator preview did not start');
    void vscode.window.setStatusBarMessage(`CPC Game Studio: playing ${name} in the emulator; ESC or Stop Music ends it`, 5000);
    return { ok: true };
  }
}

/** The first of song.cpcsong, song2.cpcsong, ... that does not exist in `dir`. */
export function freeSongName(dir: string): string {
  for (let n = 1; ; n++) {
    const f = n === 1 ? 'song.cpcsong' : `song${n}.cpcsong`;
    if (!fs.existsSync(path.join(dir, f))) return f;
  }
}

/** CPC Game Studio: New Song. `args` lets tests and other commands choose the file or the project folder. */
export async function newSongCommand(args?: { uri?: vscode.Uri; root?: string }): Promise<vscode.Uri | undefined> {
  let uri = args?.uri;
  if (!uri) {
    const root = args?.root ?? pickProject(await findProjects())?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!root) {
      void vscode.window.showInformationMessage('CPC Game Studio: open a project folder first.');
      return undefined;
    }
    const dir = path.join(root, 'assets');
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir));
    uri = vscode.Uri.file(path.join(dir, freeSongName(dir)));
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serialiseSong(demoSong()), 'utf8'));
  coverInProject(uri.fsPath);
  await vscode.commands.executeCommand('vscode.openWith', uri, SONG_VIEW_TYPE);
  return uri;
}

/** Adds the .cpcsong glob to the nearest cpcbuild.json above `file` when its "assets" do not cover it, so builds convert the song. */
function coverInProject(file: string): void {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    const json = path.join(dir, 'cpcbuild.json');
    if (fs.existsSync(json)) {
      const next = withSongGlob(fs.readFileSync(json, 'utf8'), path.relative(dir, file).split(path.sep).join('/'));
      if (next !== undefined) {
        fs.writeFileSync(json, next);
        void vscode.window.showInformationMessage(`CPC Game Studio: added "${SONG_GLOB}" to cpcbuild.json's assets, so builds convert the song.`);
      }
      return;
    }
    if (path.dirname(dir) === dir) return;
  }
}
