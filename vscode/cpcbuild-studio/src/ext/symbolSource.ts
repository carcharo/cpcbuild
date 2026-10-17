/**
 * symbolSource.ts -- the symbol table of the active target: its zxbc map from the last build, kept
 * current when the map file, the target, the active editor or the settings change.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { parseMap } from '../core/map';
import { buildSymbols, SymbolTable } from '../core/symbols';
import { absFrom, readSettings } from './config';
import { libraryFor } from './library';
import { findProjects, pickProject, PROJECT_FILE, selectedTarget } from './projects';

export interface LoadedSymbols {
  table: SymbolTable;
  root: string;
  targetId: string;
  mapFile: string;
  /** The map is older than the target's main source. */
  stale: boolean;
}

export class SymbolSource implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;
  private readonly subs: vscode.Disposable[] = [];
  private current?: LoadedSymbols;
  /** Why there is no table (for the view's message). */
  missing = 'Build the project to list symbols.';
  /** Project root of the last lookup (breakpoints are kept per project). */
  root?: string;
  private pending?: Promise<void>;

  constructor() {
    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.reload()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpcbuild') && void this.reload()),
      this.emitter,
    );
  }

  get loaded(): LoadedSymbols | undefined {
    return this.current;
  }
  get table(): SymbolTable | undefined {
    return this.current?.table;
  }

  /** Watches exactly the active target's map file (not every *.map in the workspace); re-created when the target changes. */
  private mapWatch?: { file: string; sub: vscode.Disposable };
  /** The map file being watched (test hook). */
  get watchedMap(): string | undefined {
    return this.mapWatch?.file;
  }
  private watchMap(file: string | undefined): void {
    if (this.mapWatch?.file === file) return;
    this.mapWatch?.sub.dispose();
    this.mapWatch = undefined;
    if (!file) return;
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
    this.mapWatch = { file, sub: vscode.Disposable.from(w, w.onDidChange(() => void this.reload()), w.onDidCreate(() => void this.reload()), w.onDidDelete(() => void this.reload())) };
  }

  /** Re-reads the map of the active target. Concurrent calls share one run. */
  reload(): Promise<void> {
    this.pending ??= this.doReload().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }

  private async doReload(): Promise<void> {
    this.current = undefined;
    let watch: string | undefined;
    const lp = pickProject(await findProjects());
    if (!lp) {
      this.missing = `No ${PROJECT_FILE} in this workspace.`;
    } else if (!lp.project) {
      this.root = lp.root;
      this.missing = `${PROJECT_FILE} has problems; fix them and build.`;
    } else {
      this.root = lp.root;
      const s = readSettings(lp.root);
      const t = selectedTarget(lp, s.targetDefault);
      if (!t) this.missing = 'The project has no target.';
      else if (t.arch !== 'cpc') this.missing = `Target ${t.id} is not a CPC target (no zxbc memory map).`;
      else {
        const mapFile = path.join(absFrom(lp.root, s.outputDir), `${t.id}.map`);
        watch = mapFile;
        const st = fs.statSync(mapFile, { throwIfNoEntry: false });
        if (!st) this.missing = `No ${path.basename(mapFile)} yet. Build target ${t.id} to list its symbols.`;
        else {
          try {
            const info = libraryFor(lp.file);
            const isLib = info ? (n: string): boolean => info.index.byName.has(n.toLowerCase()) : undefined;
            const table = buildSymbols(parseMap(fs.readFileSync(mapFile, 'utf8')), { isLibrary: isLib });
            const main = fs.statSync(absFrom(lp.root, t.main), { throwIfNoEntry: false });
            this.current = { table, root: lp.root, targetId: t.id, mapFile, stale: !!main && main.mtimeMs > st.mtimeMs + 1000 };
            this.missing = '';
          } catch (e) {
            this.missing = `Cannot read ${mapFile}: ${(e as Error).message}`;
          }
        }
      }
    }
    this.watchMap(watch);
    this.emitter.fire();
  }

  dispose(): void {
    this.mapWatch?.sub.dispose();
    this.subs.forEach((d) => d.dispose());
  }
}
