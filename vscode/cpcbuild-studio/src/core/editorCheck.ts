/**
 * editorCheck.ts -- the compiler's own diagnostics for the editor (no VS Code here). One check compiles a build target's
 * main file as far as the IR: the include graph is the program's and the defines are the target's, so what the editor
 * shows is what the build reports for syntax, names and types (not for code generation, assembly or layout).
 *
 * Not `parseOnly`: that stops after the parser and the preprocessor, before the binder, so an undeclared name or a
 * type error is not found. Stopping at the IR (`dump: ['ir']` with no output format) finds them and costs about
 * 40 ms for Lamplighter against about 20 ms for `parseOnly` (a full build: about 250 ms).
 */
import * as path from 'node:path';
import { compile, diagnosticToJson, type DiagnosticJson, type FileTree } from '@cpcbuild/cpcbas';
import { lazyTree, readFileOrUndefined } from '@cpcbuild/cpcbas/node';
import { checksOf, type RawTarget } from './convert';

/** One program the project builds: a main file (POSIX, relative to the project root) and the defines of its targets. */
export interface CheckGroup {
  key: string;
  main: string;
  defines: Record<string, string>;
  targets: string[];
}

/** The distinct programs of a project's CPC targets. */
export function groupsOf(targets: readonly RawTarget[]): CheckGroup[] {
  return checksOf(targets).map((c) => ({ key: JSON.stringify([c.mains[0], Object.entries(c.defines).sort()]), main: c.mains[0], defines: c.defines, targets: c.targets }));
}

/** A file tree over the project folder in which an open document's text wins over the disk (`overlay`: absolute path to text). */
export function overlayTree(root: string, overlay: ReadonlyMap<string, string>): FileTree {
  const base = path.resolve(root);
  return lazyTree((p) => {
    const abs = path.resolve(base, p);
    const open = overlay.get(abs);
    return open !== undefined ? Buffer.from(open, 'utf8') : readFileOrUndefined(abs);
  });
}

export interface CheckResult {
  /** The diagnostics of user files by absolute path (library and runtime files' diagnostics are not the user's to fix here). */
  diags: Map<string, DiagnosticJson[]>;
  /** Every user file the compile read: the include graph. */
  files: Set<string>;
  /** Errors the compiler reported in a library file (shown on the main file when there is no better place). */
  libraryErrors: DiagnosticJson[];
  timeMs: number;
}

export interface CheckOptions {
  root: string;
  main: string;
  defines?: Record<string, string>;
  includePaths?: readonly string[];
  runtime: FileTree;
  overlay?: ReadonlyMap<string, string>;
  disabledWarnings?: readonly (string | number)[];
  /** Stop after the parser and the preprocessor (`parseOnly`): for a file that no program includes, whose names are other files' to declare. */
  syntaxOnly?: boolean;
}

/** Checks one program (the front end and the semantic checks, as far as the IR). Never throws for bad input. */
export function checkProgram(o: CheckOptions): CheckResult {
  const t0 = performance.now();
  const r = compile({
    files: overlayTree(o.root, o.overlay ?? new Map()),
    main: o.main,
    includePaths: o.includePaths,
    defines: o.defines,
    runtime: o.runtime,
    options: { ...(o.syntaxOnly ? { parseOnly: true } : { dump: ['ir' as const] }), format: 'none', disabledWarnings: o.disabledWarnings, now: () => performance.now() },
  });
  const diags = new Map<string, DiagnosticJson[]>();
  const libraryErrors: DiagnosticJson[] = [];
  const files = new Set<string>();
  for (const s of r.sources.all()) if (s.origin === 'user') files.add(path.resolve(o.root, s.path));
  for (const d of r.diagnostics) {
    const j = diagnosticToJson(d, r.sources);
    const origin = r.sources.byPath(j.file)?.origin ?? 'user';
    if (origin !== 'user') {
      if (j.severity === 'error') libraryErrors.push(j);
      continue;
    }
    const abs = path.resolve(o.root, j.file);
    (diags.get(abs) ?? diags.set(abs, []).get(abs)!).push(j);
  }
  return { diags, files, libraryErrors, timeMs: performance.now() - t0 };
}
