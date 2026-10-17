/** projects.ts -- finding cpcbuild.json files, loading and validating them, and the status of the selected target. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Issue, parseProject, Project, Target } from '../core/project';

export interface LoadedProject {
  /** Folder holding cpcbuild.json. */
  root: string;
  file: string;
  project?: Project;
  errors: Issue[];
  notes: Issue[];
}

export const PROJECT_FILE = 'cpcbuild.json';

export function loadProjectFile(file: string): LoadedProject {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return { root: path.dirname(file), file, errors: [{ path: '', message: `cannot read ${file}: ${(e as Error).message}` }], notes: [] };
  }
  const r = parseProject(text);
  return { root: path.dirname(file), file, project: r.project, errors: r.errors, notes: r.notes };
}

export async function findProjects(): Promise<LoadedProject[]> {
  const uris = await vscode.workspace.findFiles(`**/${PROJECT_FILE}`, '**/{node_modules,build,.git,out,dist}/**', 50);
  return uris.map((u) => loadProjectFile(u.fsPath)).sort((a, b) => a.file.localeCompare(b.file));
}

/** The project the user means: the one containing the active editor's file, else the first. */
export function pickProject(projects: LoadedProject[]): LoadedProject | undefined {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  if (active) {
    const best = projects.filter((p) => active.startsWith(p.root + path.sep)).sort((a, b) => b.root.length - a.root.length)[0];
    if (best) return best;
  }
  return projects[0];
}

export function selectedTarget(p: LoadedProject, targetDefault: string): Target | undefined {
  const ts = p.project?.targets ?? [];
  return ts.find((t) => t.id === targetDefault) ?? ts[0];
}

/** Rough position of a JSON path in the text, for a diagnostic squiggle. */
export function locate(text: string, issuePath: string): vscode.Range {
  const lines = text.split('\n');
  const find = (needle: string, fromOffset = 0): number => text.indexOf(needle, fromOffset);
  let off = -1;
  const m = /^targets\[(\d+)\](?:\.(\w+))?$/.exec(issuePath);
  if (m) {
    let at = find('"targets"');
    for (let i = 0; i <= Number(m[1]) && at >= 0; i++) at = find('"id"', at + 1);
    if (at >= 0) off = m[2] && m[2] !== 'id' ? Math.max(find(`"${m[2]}"`, at), -1) : at;
    if (off < 0) off = at;
  } else if (issuePath) {
    off = find(`"${issuePath.replace(/\[.*$/, '')}"`);
  }
  if (off < 0) off = 0;
  const before = text.slice(0, off).split('\n');
  const line = before.length - 1;
  const col = before[before.length - 1].length;
  const len = Math.max(1, (lines[line] ?? '').length - col);
  return new vscode.Range(line, col, line, col + len);
}

export function publishDiagnostics(coll: vscode.DiagnosticCollection, p: LoadedProject): void {
  const uri = vscode.Uri.file(p.file);
  let text = '';
  try {
    text = fs.readFileSync(p.file, 'utf8');
  } catch {
    /* unreadable: diagnostics at line 0 */
  }
  const ds = p.errors.map((e) => {
    const d = new vscode.Diagnostic(locate(text, e.path), e.message, vscode.DiagnosticSeverity.Error);
    d.source = 'cpcbuild';
    return d;
  });
  coll.set(uri, ds);
}
