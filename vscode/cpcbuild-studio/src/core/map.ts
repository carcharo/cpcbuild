/**
 * map.ts -- the zxbc `-M` memory map and the build report (spec 4.6).
 *
 * A map line is `HHHH: label` (field 1 = hex address with a trailing colon,
 * field 2 = label: the awk in games/shooter/build_cpc.sh). Labels are as zxbc
 * writes them: `.core.__START_PROGRAM`, `._name`, ... Pure TypeScript.
 */

export interface MapEntry {
  addr: number;
  label: string;
}

export function parseMap(text: string): MapEntry[] {
  const out: MapEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([0-9A-Fa-f]+):\s+(\S+)/.exec(line);
    if (m) out.push({ addr: parseInt(m[1], 16), label: m[2] });
  }
  return out;
}

/** Address of the first entry with exactly this label (e.g. `.core.__START_PROGRAM`). */
export function findLabel(entries: readonly MapEntry[], label: string): number | undefined {
  return entries.find((e) => e.label === label)?.addr;
}

export const START_LABEL = '.core.__START_PROGRAM';
export const HIDATA_LABEL = '.__HIDATA_BACK_0';

/** The origin zxbc compiled for (first byte of the .bin and its entry point). */
export function programStart(entries: readonly MapEntry[]): number | undefined {
  return findLabel(entries, START_LABEL);
}

export interface LimitLine {
  /** What the line is. */
  name: string;
  limit: number;
  /** The address the headroom is measured from. */
  from: number;
  /** limit - from; negative = over. */
  headroom: number;
  /** `limit` = a hard line (over it is a problem); `info` = only a capability (e.g. double buffering). */
  kind: 'limit' | 'info';
}

export interface MemoryReport {
  start: number;
  /** One past the last byte of the image: start + bytes. */
  end: number;
  bytes: number;
  /** End of the program proper: `__HIDATA_BACK_0` when `#pragma hidata` put arrays above it, else `end`. */
  lowEnd: number;
  /** Set when there is a high-data segment: it ends at `end`. */
  highData?: { end: number; bytes: number };
  lines: LimitLine[];
}

export interface ReportOptions {
  bare: boolean;
  /** `dsk`, `cpr` or `bin`: which reference lines apply. */
  pkg: string;
  /** User lines (cpcbuild.build.memoryLimits): name -> address. */
  extraLimits?: Record<string, number>;
}

/** The reference lines of the notes, per kind of build (spec 4.6). */
export function referenceLines(opts: ReportOptions): { name: string; limit: number; kind: 'limit' | 'info'; low?: boolean }[] {
  const lines: { name: string; limit: number; kind: 'limit' | 'info'; low?: boolean }[] = [
    { name: 'back screen / banks (double buffering)', limit: 0x4000, kind: 'info', low: true },
  ];
  if (!opts.bare) {
    lines.push({ name: 'firmware heap start', limit: 0x8b60, kind: 'limit' });
  } else {
    if (opts.pkg !== 'cpr') lines.push({ name: 'bare program loaded by RUN"', limit: 0xa67b, kind: 'limit' });
    lines.push({ name: 'bare limit', limit: 0xb800, kind: 'limit' });
  }
  return lines;
}

export function memoryReport(entries: readonly MapEntry[], bytes: number, opts: ReportOptions): MemoryReport {
  const start = programStart(entries);
  if (start === undefined) throw new Error(`no ${START_LABEL} in the map: cannot tell the program's origin`);
  const end = start + bytes;
  const hi = findLabel(entries, HIDATA_LABEL);
  const lowEnd = hi !== undefined && hi < end ? hi : end;
  const lines: LimitLine[] = [];
  for (const r of referenceLines(opts)) {
    const from = r.low ? lowEnd : end;
    lines.push({ name: r.name, limit: r.limit, from, headroom: r.limit - from, kind: r.kind });
  }
  for (const [name, limit] of Object.entries(opts.extraLimits ?? {})) {
    if (typeof limit === 'number' && Number.isFinite(limit)) lines.push({ name, limit, from: end, headroom: limit - end, kind: 'limit' });
  }
  const report: MemoryReport = { start, end, bytes, lowEnd, lines };
  if (lowEnd < end) report.highData = { end, bytes: end - lowEnd };
  return report;
}

export function hex4(n: number): string {
  return '&' + n.toString(16).toUpperCase().padStart(4, '0');
}

/** The report as text lines (output channel). */
export function formatReport(r: MemoryReport): string[] {
  const out: string[] = [];
  if (r.highData) {
    out.push(`${r.bytes} bytes, low segment ${hex4(r.start)}-${hex4(r.lowEnd)}, high data to ${hex4(r.end)}`);
  } else {
    out.push(`${r.bytes} bytes, ${hex4(r.start)}-${hex4(r.end)}`);
  }
  for (const l of r.lines) {
    const label = `${l.name} (${hex4(l.limit)})`;
    if (l.headroom >= 0) out.push(`  headroom below ${hex4(l.limit)}: ${l.headroom} bytes  [${l.name}]`);
    else out.push(`  ${l.kind === 'limit' ? 'OVER' : 'over'} ${label} by ${-l.headroom} bytes`);
  }
  return out;
}
