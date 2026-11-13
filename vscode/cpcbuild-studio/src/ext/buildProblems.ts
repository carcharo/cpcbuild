/** buildProblems.ts -- the compiler's diagnostics in the Problems panel (one collection, replaced by each build of a project). */
import * as vscode from 'vscode';
import type { BuildDiagnostic } from '../core/buildDiag';

let collection: vscode.DiagnosticCollection | undefined;
/** Files each project root last had diagnostics in, so the next build clears exactly those. */
const published = new Map<string, Set<string>>();

export function buildProblems(): vscode.DiagnosticCollection {
  return (collection ??= vscode.languages.createDiagnosticCollection('cpcbas'));
}

const SEVERITY: Record<BuildDiagnostic['severity'], vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  note: vscode.DiagnosticSeverity.Information,
};

/** A compiler diagnostic as the editor's: 1-based line and column to 0-based, the end column being exclusive in both. */
export function toVsDiagnostic(d: BuildDiagnostic): vscode.Diagnostic {
  const range = new vscode.Range(Math.max(0, d.line - 1), Math.max(0, d.col - 1), Math.max(0, d.endLine - 1), Math.max(0, d.endCol - 1));
  const out = new vscode.Diagnostic(range, d.hint ? `${d.message}\nHint: ${d.hint}` : d.message, SEVERITY[d.severity]);
  out.code = d.code;
  out.source = 'cpcbas';
  if (d.related?.length) {
    out.relatedInformation = d.related.map((r) => new vscode.DiagnosticRelatedInformation(new vscode.Location(vscode.Uri.file(r.file), new vscode.Position(Math.max(0, r.line - 1), Math.max(0, r.col - 1))), r.message));
  }
  return out;
}

/** Replaces the diagnostics of the project in `root` with `ds`. */
export function publishBuildDiagnostics(root: string, ds: readonly BuildDiagnostic[]): void {
  const coll = buildProblems();
  for (const f of published.get(root) ?? []) coll.delete(vscode.Uri.file(f));
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of ds) {
    const list = byFile.get(d.file) ?? [];
    list.push(toVsDiagnostic(d));
    byFile.set(d.file, list);
  }
  for (const [f, list] of byFile) coll.set(vscode.Uri.file(f), list);
  published.set(root, new Set(byFile.keys()));
}

export function clearBuildDiagnostics(): void {
  collection?.clear();
  published.clear();
}
