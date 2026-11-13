/**
 * editorDiagnostics.ts -- the compiler's own diagnostics in the editor. After a pause in typing (and on open, save
 * and a change of the project or of the settings), the project's programs are checked with the compiler's
 * `parseOnly`: one check per distinct (main file, defines) of the project's targets, so the include graph and the
 * defines are the build's. Diagnostics go to the files they belong to (an included file gets its own), source
 * "cpcbas", with the compiler's code, range and hint. A file that no target's program includes is checked alone.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { loadRuntime } from '@cpcbuild/cpcbas/node';
import type { DiagnosticJson, FileTree } from '@cpcbuild/cpcbas';
import { checkProgram, CheckGroup, CheckResult, groupsOf } from '../core/editorCheck';
import { libraryFor } from './library';

export const DIAGNOSTIC_SOURCE = 'cpcbas';
const DEBOUNCE_MS = 400;

const isBasicPath = (p: string): boolean => /\.bas$/i.test(p);
const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  note: vscode.DiagnosticSeverity.Information,
};

interface ProjectState {
  root: string;
  results: Map<string, CheckResult>;
  /** Absolute paths that have diagnostics from this project now. */
  published: Set<string>;
}

const runtimes = new Map<string, FileTree>();
function runtimeFor(libDir: string): FileTree {
  let r = runtimes.get(libDir);
  if (!r) runtimes.set(libDir, (r = loadRuntime(path.join(libDir, 'lib'))));
  return r;
}

export function toVsDiagnostic(j: DiagnosticJson): vscode.Diagnostic {
  const range = new vscode.Range(Math.max(0, j.line - 1), Math.max(0, j.col - 1), Math.max(0, j.endLine - 1), Math.max(0, j.endCol - 1));
  const d = new vscode.Diagnostic(range, j.hint ? `${j.message}\n${j.hint}` : j.message, SEVERITY[j.severity] ?? vscode.DiagnosticSeverity.Error);
  d.source = DIAGNOSTIC_SOURCE;
  d.code = j.code;
  return d;
}

export interface EditorDiagnostics {
  /** How many checks have covered a document (the extension-host tests wait on this instead of sleeping past the debounce). */
  runs(uri: vscode.Uri): number;
  /** Checks now every project that has an open .bas document, and returns when done (tests). */
  checkNow(): void;
}

export function registerEditorDiagnostics(context: vscode.ExtensionContext): EditorDiagnostics {
  const collection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
  const projects = new Map<string, ProjectState>();
  const pending = new Map<string, { timer: NodeJS.Timeout; files: Set<string> | 'all' }>();
  const runs = new Map<string, number>();
  context.subscriptions.push(collection, { dispose: () => pending.forEach((p) => clearTimeout(p.timer)) });

  const overlay = (): Map<string, string> => {
    const m = new Map<string, string>();
    for (const d of vscode.workspace.textDocuments) if (d.uri.scheme === 'file' && isBasicPath(d.uri.fsPath)) m.set(d.uri.fsPath, d.getText());
    return m;
  };

  function check(file: string, changed: Set<string> | 'all'): void {
    const info = libraryFor(file);
    if (!info?.libDir) return;
    const root = info.projectRoot;
    const st = projects.get(root) ?? projects.set(root, { root, results: new Map(), published: new Set() }).get(root)!;
    const runtime = runtimeFor(info.libDir);
    const text = overlay();
    const groups: CheckGroup[] = groupsOf(info.project.project?.targets ?? []);
    const mainOf = (g: CheckGroup): string => path.resolve(root, g.main);
    const covered = (f: string): boolean => groups.some((g) => st.results.get(g.key)?.files.has(f) || mainOf(g) === f);
    const todo: CheckGroup[] = [];
    for (const g of groups) {
      const prev = st.results.get(g.key);
      if (changed === 'all' || !prev || [...changed].some((f) => prev.files.has(f) || mainOf(g) === f)) todo.push(g);
    }
    // a file that no target's program includes (any file, in a project with no CPC target) is checked alone
    for (const f of [...text.keys()].filter((f) => f.startsWith(root + path.sep) && !covered(f))) {
      const key = orphanKey(f);
      if (changed === 'all' || changed.has(f) || !st.results.has(key)) {
        todo.push({ key, main: path.relative(root, f).split(path.sep).join('/'), defines: {}, targets: [] });
      }
    }
    for (const g of todo) {
      const r = checkProgram({ root, main: g.main, defines: g.defines, runtime, overlay: text });
      st.results.set(g.key, r);
      for (const f of r.files) {
        const k = vscode.Uri.file(f).toString();
        runs.set(k, (runs.get(k) ?? 0) + 1);
      }
    }
    // an orphan's result goes when a target's program includes the file now
    for (const k of [...st.results.keys()]) if (k.startsWith('file:') && covered(k.slice(5))) st.results.delete(k);
    publish(st);
  }
  const orphanKey = (f: string): string => `file:${f}`;

  function publish(st: ProjectState): void {
    const byFile = new Map<string, Map<string, DiagnosticJson>>();
    const add = (abs: string, j: DiagnosticJson): void => {
      const m = byFile.get(abs) ?? byFile.set(abs, new Map()).get(abs)!;
      m.set(`${j.line}:${j.col}:${j.code}:${j.message}`, j);
    };
    for (const r of st.results.values()) for (const [abs, ds] of r.diags) for (const j of ds) add(abs, j);
    const now = new Set(byFile.keys());
    for (const [abs, m] of byFile) collection.set(vscode.Uri.file(abs), [...m.values()].map(toVsDiagnostic));
    for (const abs of st.published) if (!now.has(abs)) collection.delete(vscode.Uri.file(abs));
    st.published = now;
  }

  function schedule(doc: vscode.TextDocument | undefined, ms = DEBOUNCE_MS, all = false): void {
    const file = doc?.uri.fsPath;
    if (doc && (doc.uri.scheme !== 'file' || !isBasicPath(file!))) return;
    const info = file ? libraryFor(file) : undefined;
    if (file && !info) return;
    if (!vscode.workspace.getConfiguration('cpcbuild').get<boolean>('lint.enable', true)) {
      if (info) clearProject(info.projectRoot);
      return;
    }
    const root = info?.projectRoot ?? '';
    const cur = pending.get(root);
    if (cur) clearTimeout(cur.timer);
    const files: Set<string> | 'all' = all || cur?.files === 'all' ? 'all' : new Set([...(cur?.files ?? []), ...(file ? [file] : [])]);
    pending.set(root, {
      files,
      timer: setTimeout(() => {
        pending.delete(root);
        const f = file ?? [...(files === 'all' ? [] : files)][0];
        if (f) check(f, files);
      }, ms),
    });
  }

  function clearProject(root: string): void {
    const st = projects.get(root);
    if (!st) return;
    for (const abs of st.published) collection.delete(vscode.Uri.file(abs));
    projects.delete(root);
  }

  const everything = (): void => {
    for (const st of projects.values()) st.results.clear();
    vscode.workspace.textDocuments.forEach((d) => schedule(d, 20, true));
  };

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((d) => schedule(d, 20)),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidSaveTextDocument((d) => schedule(d, 20)),
    vscode.workspace.onDidCloseTextDocument((d) => {
      // an unsaved edit that was thrown away: the disk text is what counts again
      if (d.isDirty) schedule(d, 20, true);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('cpcbuild') && everything()),
  );
  const w = vscode.workspace.createFileSystemWatcher('**/cpcbuild.json');
  context.subscriptions.push(w, w.onDidChange(everything), w.onDidCreate(everything), w.onDidDelete(everything));
  vscode.workspace.textDocuments.forEach((d) => schedule(d, 20));

  return {
    runs: (uri) => runs.get(uri.toString()) ?? 0,
    checkNow: () => {
      for (const [root, p] of [...pending]) {
        clearTimeout(p.timer);
        pending.delete(root);
      }
      vscode.workspace.textDocuments.forEach((d) => {
        if (d.uri.scheme === 'file' && isBasicPath(d.uri.fsPath)) check(d.uri.fsPath, 'all');
      });
    },
  };
}
