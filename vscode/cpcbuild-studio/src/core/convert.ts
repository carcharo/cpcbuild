/**
 * convert.ts -- "Convert Project to CPC BASIC" without the editor: runs the compiler package's `migrate` over the
 * sources of a project and works out what to write (the changed files, the cpcbuild.json edit). Pure TypeScript
 * apart from the compiler import; the command in ext/convertProject.ts reads and writes the files and asks the
 * questions.
 *
 * It reads the project's `cpcbuild.json` as plain JSON (not through `parseProject`): a 0.1.x project with a
 * Spectrum target is exactly what this has to open.
 */
import { migrate, type FileTree, type MigrateDiagnostic, type MigrateReport } from '@cpcbuild/cpcbas';

/** One compile check of the translated program: the main files and the defines of a build target. */
export interface CheckConfig {
  mains: string[];
  defines: Record<string, string>;
  /** The target ids this check stands for (for the report). */
  targets: string[];
}

export interface RawTarget {
  id?: unknown;
  arch?: unknown;
  main?: unknown;
  defines?: unknown;
  bare?: unknown;
  ownFont?: unknown;
  package?: unknown;
}

/** The targets of a cpcbuild.json text (any version), or undefined when it is not JSON with a `targets` array. */
export function rawTargets(projectJson: string): RawTarget[] | undefined {
  try {
    const p = JSON.parse(projectJson) as { targets?: unknown };
    return Array.isArray(p.targets) ? (p.targets.filter((t) => t && typeof t === 'object') as RawTarget[]) : undefined;
  } catch {
    return undefined;
  }
}

/** Spectrum targets: `arch` "zx48k", or a tape package. */
export const isSpectrumTarget = (t: RawTarget): boolean => t.arch === 'zx48k' || t.package === 'tap';

const posix = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');

/** The `-D` map a target builds with: its `defines`, `CPC_BAREMETAL` for `bare`, `CPC_OWNFONT` for `ownFont`. */
export function targetDefines(t: RawTarget): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(t.defines)) {
    for (const d of t.defines) {
      if (typeof d !== 'string' || !d.trim()) continue;
      const eq = d.indexOf('=');
      if (eq < 0) out[d.trim()] = '';
      else out[d.slice(0, eq).trim()] = d.slice(eq + 1).trim();
    }
  }
  if (t.bare === true) out.CPC_BAREMETAL = '';
  if (t.ownFont === true) out.CPC_OWNFONT = '';
  return out;
}

/**
 * The compile checks of a project: one per distinct (main file, defines) pair among its CPC targets, so that a
 * Plus target is checked with `PLUS` and a bare one with `CPC_BAREMETAL`. Spectrum targets are not checked (the
 * code they build is under `__ZX48K__`, which the CPC never compiles). No targets: no checks (the translator then
 * compiles every `.bas` that no other file includes).
 */
export function targetChecks(projectJson: string | undefined): CheckConfig[] {
  return checksOf((projectJson ? rawTargets(projectJson) : undefined) ?? []);
}

/** {@link targetChecks} for targets already read. */
export function checksOf(ts: readonly RawTarget[]): CheckConfig[] {
  const out: CheckConfig[] = [];
  for (const t of ts) {
    if (isSpectrumTarget(t) || typeof t.main !== 'string') continue;
    const defines = targetDefines(t);
    const key = JSON.stringify([posix(t.main), Object.entries(defines).sort()]);
    const same = out.find((c) => JSON.stringify([c.mains[0], Object.entries(c.defines).sort()]) === key);
    const id = typeof t.id === 'string' ? t.id : '?';
    if (same) same.targets.push(id);
    else out.push({ mains: [posix(t.main)], defines, targets: [id] });
  }
  return out;
}

export interface ConvertOptions {
  /** `'boriel'`: the sources are Boriel BASIC (the first conversion of a 0.1.x project); `'auto'`: the translator decides. */
  from: 'auto' | 'boriel';
  /** The bundled library tree: with it the translated program is compile-checked (W725, W737). */
  runtime?: FileTree;
  /** One compile check per target (see {@link targetChecks}); empty: the translator's default. */
  checks?: CheckConfig[];
  renames?: Record<string, string>;
}

export interface ConvertResult {
  /** New text of each file whose content changes, by project-relative path. */
  changed: Map<string, string>;
  /** The merged report: every finding once, in file order. */
  report: MigrateReport;
  /** How the run read the sources. */
  dialect: 'boriel' | 'cpcbas';
}

const key = (path: string, d: MigrateDiagnostic): string => `${path}:${d.line}:${d.col}:${d.code}:${d.message}`;

/** Translates the files of a project (path to bytes, as `readTree` gives them). Runs the compile check once per check config and merges the findings. */
export function convertSources(files: ReadonlyMap<string, Uint8Array>, opts: ConvertOptions): ConvertResult {
  const checks: (CheckConfig | undefined)[] = opts.checks?.length && opts.runtime ? opts.checks : [undefined];
  const runs = checks.map((c) =>
    migrate(files, {
      from: opts.from,
      renames: opts.renames,
      ...(opts.runtime ? { runtime: opts.runtime, ...(c ? { mains: c.mains, defines: c.defines } : {}) } : {}),
    }),
  );
  const first = runs[0];
  // The translation does not depend on the defines: every run writes the same files; only the compile check differs.
  const seen = new Set<string>();
  const report: MigrateReport = JSON.parse(JSON.stringify(first.report));
  report.files.forEach((f, fi) => {
    f.diagnostics.forEach((d) => seen.add(key(f.path, d)));
    for (const r of runs.slice(1)) {
      const g = r.report.files[fi];
      for (const d of g?.diagnostics ?? []) {
        if (seen.has(key(f.path, d))) continue;
        seen.add(key(f.path, d));
        f.diagnostics.push(d);
        report.summary.counts[d.code] = (report.summary.counts[d.code] ?? 0) + 1;
      }
    }
    f.diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  });
  const changed = new Map<string, string>();
  for (const f of first.report.files) if (f.changed) changed.set(f.path, first.files.get(f.path)!);
  return { changed, report, dialect: report.summary.dialect };
}

/** The report as text, one line per finding as the compiler prints diagnostics, then a summary. Notes (rewrites) are counted, not listed, unless `notes`. */
export function formatReport(report: MigrateReport, opts: { notes?: boolean } = {}): string {
  const lines: string[] = [];
  for (const f of report.files) {
    for (const d of f.diagnostics) {
      if (d.severity === 'note' && !opts.notes) continue;
      lines.push(`${f.path}:${d.line}:${d.col}: ${d.severity} ${d.code}: ${d.message}`);
      if (d.hint) lines.push(`  hint: ${d.hint}`);
    }
  }
  const counts = Object.entries(report.summary.counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([c, n]) => `${c} x${n}`)
    .join(', ');
  lines.push('', `${report.summary.files} file(s) read, ${report.summary.changed} changed. Read as ${report.summary.dialect === 'boriel' ? 'Boriel BASIC' : 'CPC BASIC'}.`);
  if (counts) lines.push(`Findings: ${counts}.`);
  return lines.join('\n') + '\n';
}

/** Must-fix findings left in the report (W720-W725): the project does not build until a person changes these. */
export function mustFix(report: MigrateReport): { path: string; d: MigrateDiagnostic }[] {
  const out: { path: string; d: MigrateDiagnostic }[] = [];
  for (const f of report.files) for (const d of f.diagnostics) if (/^W72[0-5]$/.test(d.code)) out.push({ path: f.path, d });
  return out;
}

export interface SpectrumRemoval {
  /** The new cpcbuild.json text. */
  text: string;
  /** Ids of the targets removed. */
  removed: string[];
}

/**
 * cpcbuild.json without its Spectrum targets (`arch` "zx48k" or a `tap` package); everything else as it was: the same
 * key order, indent and line ending. undefined when there is nothing to remove, the text is not a project, or removing
 * them would leave no target.
 */
export function removeSpectrumTargets(projectJson: string): SpectrumRemoval | undefined {
  let p: { targets?: unknown };
  try {
    p = JSON.parse(projectJson) as { targets?: unknown };
  } catch {
    return undefined;
  }
  if (!Array.isArray(p.targets)) return undefined;
  const keep = p.targets.filter((t) => !(t && typeof t === 'object' && isSpectrumTarget(t as RawTarget)));
  if (keep.length === p.targets.length || keep.length === 0) return undefined;
  const removed = p.targets.filter((t) => !keep.includes(t)).map((t) => String((t as RawTarget).id ?? '?'));
  p.targets = keep;
  const indent = /^\t/m.test(projectJson) ? '\t' : (/^( +)\S/m.exec(projectJson)?.[1].length ?? 2);
  const eol = projectJson.includes('\r\n') ? '\r\n' : '\n';
  let text = JSON.stringify(p, null, indent);
  if (eol === '\r\n') text = text.replace(/\n/g, eol);
  if (/\r?\n$/.test(projectJson)) text += eol;
  return { text, removed };
}

/** True when the project has a Spectrum target and at least one other (so removing them is possible). */
export function hasSpectrumTargets(projectJson: string): boolean {
  const ts = rawTargets(projectJson);
  return !!ts && ts.some(isSpectrumTarget);
}
