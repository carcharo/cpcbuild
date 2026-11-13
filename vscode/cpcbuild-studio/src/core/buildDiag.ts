/**
 * buildDiag.ts -- the compiler's diagnostics as the Studio shows them (Problems panel, build output).
 * Pure TypeScript over the library's result: no vscode import.
 */
import * as path from 'node:path';
import { diagnosticToJson, type CompileResult } from '@cpcbuild/cpcbas';

export type DiagSeverity = 'error' | 'warning' | 'note';

export interface BuildDiagnostic {
  /** Absolute path: the project's own file, or the bundled library's. */
  file: string;
  /** 1-based, as the compiler reports them. */
  line: number;
  col: number;
  endLine: number;
  /** Exclusive. */
  endCol: number;
  severity: DiagSeverity;
  code: string;
  message: string;
  hint?: string;
  /** `user`: a file of the project; `library`/`runtime`/`generated`: the compiler's own. */
  origin: string;
  related?: { file: string; line: number; col: number; message: string }[];
}

/**
 * The diagnostics of a compile. `file` of the library's JSON is relative to the tree it came from: the project root for
 * the user's files (an absolute path passes through), the bundled `lib/` folder for the library's and the runtime's.
 */
export function buildDiagnostics(result: Pick<CompileResult, 'diagnostics' | 'sources'>, root: string, libDir: string): BuildDiagnostic[] {
  const where = (file: string): { file: string; origin: string } => {
    const origin = result.sources.byPath(file)?.origin ?? 'user';
    const base = origin === 'user' ? root : libDir;
    return { file: path.resolve(base, file), origin };
  };
  return result.diagnostics.map((d) => {
    const j = diagnosticToJson(d, result.sources);
    const w = where(j.file);
    const out: BuildDiagnostic = { file: w.file, line: j.line, col: j.col, endLine: j.endLine, endCol: j.endCol, severity: j.severity, code: j.code, message: j.message, origin: w.origin };
    if (j.hint !== undefined) out.hint = j.hint;
    if (j.related) out.related = j.related.map((r) => ({ ...r, file: where(r.file).file }));
    return out;
  });
}

/** `src/main.bas:3:7: error E101: message` (path relative to the project when it is inside it), a hint on a second line. */
export function formatBuildDiagnostic(d: BuildDiagnostic, root: string): string {
  const rel = path.relative(root, d.file);
  const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : d.file;
  const head = `${shown}:${d.line}:${d.col}: ${d.severity} ${d.code}: ${d.message}`;
  return d.hint ? `${head}\n  hint: ${d.hint}` : head;
}
