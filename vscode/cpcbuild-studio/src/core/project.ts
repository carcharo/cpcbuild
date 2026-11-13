/**
 * project.ts -- cpcbuild.json (spec 2.4): parsing, validation, defaults, and
 * the compiler input for a target (spec 4.6). Pure TypeScript.
 */
import type { CompileOptions, OptLevel } from '@cpcbuild/cpcbas';

export type Arch = 'cpc';
export type PackageKind = 'dsk' | 'cpr' | 'bin';
export type Model = '464' | '664' | '6128' | 'plus';

export interface TargetInput {
  id: string;
  arch?: string;
  main: string;
  model?: string;
  defines?: string[];
  bare?: boolean;
  ownFont?: boolean;
  org?: number | string | null;
  heap?: number | null;
  optimize?: number | string | null;
  package?: string;
  disc?: string;
}

export interface Target {
  id: string;
  arch: Arch;
  main: string;
  model: Model;
  defines: string[];
  bare: boolean;
  ownFont: boolean;
  /** Address to pass as --org/-S, or undefined for the compiler's default. */
  org?: number;
  /** Heap size in bytes, or undefined for the compiler's default. */
  heap?: number;
  /** The optimisation level (-O), or undefined for the compiler's default (2). */
  optimize?: OptLevel;
  package: PackageKind;
  /** AMSDOS stem of the program on the disc (dsk packages), validated or derived. */
  disc: string;
}

export interface Project {
  version: 1;
  name: string;
  library: string | null;
  targets: Target[];
  assets: string[];
}

export interface Issue {
  /** JSON path, e.g. `targets[1].package`. */
  path: string;
  message: string;
}

export interface ParseResult {
  project?: Project;
  errors: Issue[];
  /** Notes that do not block a build (a derived disc name, ...). */
  notes: Issue[];
}

/** The message for a project that still has a Spectrum target (the Convert command offers to remove it). */
export const SPECTRUM_REMOVED = 'Spectrum targets were removed in CPCBuild 0.2.0; use CPCBuild 0.1.x for them, or remove the target ("Convert Project to CPC BASIC" offers to).';

export const MODELS: readonly Model[] = ['464', '664', '6128', 'plus'];
export const MIN_ORG = 0x40;
const DISC_RE = /^[A-Z0-9]{1,8}$/;

/** `0x40`, `&40`, `$40` or decimal; undefined when it is none of those. */
export function parseAddress(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 0xffff ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  let n: number;
  if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s.slice(2), 16);
  else if (/^[&$][0-9a-f]+$/i.test(s)) n = parseInt(s.slice(1), 16);
  else if (/^\d+$/.test(s)) n = parseInt(s, 10);
  else return undefined;
  return n >= 0 && n <= 0xffff ? n : undefined;
}

/** An AMSDOS stem from any text: upper-case [A-Z0-9], at most 8 characters (spec 4.5: shown to the user). */
export function deriveDiscStem(text: string): string {
  const s = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return s || 'PROG';
}

export function isValidDisc(s: string): boolean {
  return DISC_RE.test(s);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseProject(text: string): ParseResult {
  const errors: Issue[] = [];
  const notes: Issue[] = [];
  const err = (path: string, message: string): void => void errors.push({ path, message });

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    err('', `cpcbuild.json is not valid JSON (${(e as Error).message}). Fix the syntax, or create a fresh project with "CPC Game Studio: New Project".`);
    return { errors, notes };
  }
  if (!isObj(raw)) {
    err('', 'cpcbuild.json must contain a JSON object ({ "version": 1, "name": ..., "targets": [...] }).');
    return { errors, notes };
  }
  if (raw.version !== 1) err('version', `"version" must be 1 (found ${JSON.stringify(raw.version)}). This Studio understands project file version 1.`);
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  if (!name) err('name', '"name" is required: a short project name, e.g. "mygame".');
  let library: string | null = null;
  if (raw.library !== undefined && raw.library !== null) {
    if (typeof raw.library === 'string') library = raw.library;
    else err('library', '"library" must be a path to the cpcbuild checkout (folder with tools/), or null.');
  }
  let assets: string[] = [];
  if (raw.assets !== undefined) {
    if (Array.isArray(raw.assets) && raw.assets.every((a) => typeof a === 'string')) assets = raw.assets as string[];
    else err('assets', '"assets" must be a list of glob strings, e.g. ["assets/**/*.cpcspr"].');
  }

  const targets: Target[] = [];
  if (!Array.isArray(raw.targets) || raw.targets.length === 0) {
    err('targets', '"targets" must be a non-empty list. Add one, e.g. { "id": "cpc6128", "arch": "cpc", "main": "src/main.bas", "package": "dsk" }.');
  } else {
    const seen = new Set<string>();
    raw.targets.forEach((t, i) => {
      const p = `targets[${i}]`;
      if (!isObj(t)) return err(p, 'each target must be an object.');
      const id = typeof t.id === 'string' ? t.id : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) err(`${p}.id`, `"id" must be letters, digits, "-" or "_" (found ${JSON.stringify(t.id)}).`);
      else if (seen.has(id)) err(`${p}.id`, `target id "${id}" is used twice; ids must be unique.`);
      seen.add(id);
      const arch = t.arch === undefined ? 'cpc' : t.arch;
      if (arch === 'zx48k') err(`${p}.arch`, `${SPECTRUM_REMOVED} (target "${id}")`);
      else if (arch !== 'cpc') err(`${p}.arch`, `"arch" must be "cpc" (found ${JSON.stringify(t.arch)}).`);
      const main = typeof t.main === 'string' ? t.main : '';
      if (!main) err(`${p}.main`, '"main" is required: the .bas file to compile, e.g. "src/main.bas".');
      const model = t.model === undefined ? '6128' : t.model;
      if (!MODELS.includes(model as Model)) err(`${p}.model`, `"model" must be one of ${MODELS.join(', ')} (found ${JSON.stringify(t.model)}).`);
      let defines: string[] = [];
      if (t.defines !== undefined) {
        if (Array.isArray(t.defines) && t.defines.every((d) => typeof d === 'string' && d.trim() !== '' && !/\s/.test(d))) defines = t.defines as string[];
        else err(`${p}.defines`, '"defines" must be a list of NAME or NAME=VALUE strings without spaces, e.g. ["CPC6128"].');
      }
      for (const k of ['bare', 'ownFont'] as const) {
        if (t[k] !== undefined && typeof t[k] !== 'boolean') err(`${p}.${k}`, `"${k}" must be true or false.`);
      }
      const bare = t.bare === true;
      const ownFont = t.ownFont === true;
      let org: number | undefined;
      if (t.org !== undefined && t.org !== null && t.org !== '') {
        org = parseAddress(t.org);
        if (org === undefined) err(`${p}.org`, `"org" must be an address 0-65535 (0x8000, &8000 or decimal); found ${JSON.stringify(t.org)}.`);
        else if (org < MIN_ORG) err(`${p}.org`, `"org" &${org.toString(16).toUpperCase()} is below &0040: the compiler refuses an origin there on the CPC. Use 0x40 or higher, or remove "org".`);
      }
      let heap: number | undefined;
      if (t.heap !== undefined && t.heap !== null) {
        if (typeof t.heap === 'number' && Number.isInteger(t.heap) && t.heap >= 0) heap = t.heap;
        else err(`${p}.heap`, '"heap" must be a size in bytes (the compiler\'s --heap).');
      }
      let optimize: OptLevel | undefined;
      if (t.optimize !== undefined && t.optimize !== null) {
        optimize = parseOptLevel(t.optimize);
        if (optimize === undefined) err(`${p}.optimize`, `"optimize" must be 0, 1, 2, 3 or "s" (found ${JSON.stringify(t.optimize)}).`);
      }
      let pkg: PackageKind = 'dsk';
      if (t.package !== undefined) {
        if (t.package === 'tap') err(`${p}.package`, `"tap" was a Spectrum tape. ${SPECTRUM_REMOVED}`);
        else if (typeof t.package === 'string' && ['dsk', 'cpr', 'bin'].includes(t.package)) pkg = t.package as PackageKind;
        else err(`${p}.package`, `"package" must be one of dsk, cpr, bin (found ${JSON.stringify(t.package)}).`);
      }
      if (pkg === 'cpr' && (!bare || !ownFont)) {
        err(`${p}.package`, `package "cpr" needs "bare": true and "ownFont": true (a cartridge has no firmware and no firmware font). Set both on target "${id}", or choose package "dsk".`);
      }
      let disc = '';
      if (t.disc !== undefined) {
        if (typeof t.disc === 'string' && isValidDisc(t.disc)) disc = t.disc;
        else err(`${p}.disc`, `"disc" must be 1-8 upper-case letters or digits ([A-Z0-9]; Caprice32 cannot type "_" after run"), found ${JSON.stringify(t.disc)}. Try "${deriveDiscStem(String(t.disc))}".`);
      } else if (pkg === 'dsk') {
        disc = deriveDiscStem(id || name);
        notes.push({ path: `${p}.disc`, message: `no "disc" given: the AMSDOS name for target "${id}" will be ${disc} (run"${disc}).` });
      }
      targets.push({
        id,
        arch: 'cpc',
        main,
        model: (MODELS.includes(model as Model) ? model : '6128') as Model,
        defines,
        bare,
        ownFont,
        org,
        heap,
        optimize,
        package: pkg,
        disc,
      });
    });
  }
  if (errors.length) return { errors, notes };
  return { project: { version: 1, name, library, targets, assets }, errors, notes };
}

/** 0..3 or "s" (also "O2", "-O2", "2"), as the compiler takes it; undefined when it is none of those. */
export function parseOptLevel(v: unknown): OptLevel | undefined {
  const t = String(v).trim().replace(/^-?O\s*/i, '').toLowerCase();
  if (t === 's') return 's';
  return /^[0-3]$/.test(t) ? (Number(t) as 0 | 1 | 2 | 3) : undefined;
}

/** The compiler's own number syntax: `&4000`, `&H4000`, `0x4000`, `$4000` or decimal. */
function parseFlagNumber(v: string): number | undefined {
  const t = v.trim();
  let n: number;
  const m = /^(?:&[hH]?|0[xX]|\$)([0-9a-fA-F]+)$/.exec(t);
  if (m) n = parseInt(m[1] as string, 16);
  else if (/^[0-9]+$/.test(t)) n = parseInt(t, 10);
  else return undefined;
  return n <= 0xffff ? n : undefined;
}

/** What the Studio takes from `cpcbuild.compiler.args` (the CLI's own flags). */
export interface CompilerArgs {
  optimize?: OptLevel;
  heap?: number;
  heapAddress?: number;
  org?: number;
  defines: Record<string, string>;
  includes: string[];
  /** `-W CODE`: warnings to disable. */
  disabled: (string | number)[];
  werror: boolean;
  implicit: boolean;
  optDisable: string[];
  /** What was not understood or not honoured, as sentences for the build output. */
  warnings: string[];
}

/** The flags the Studio honours; every other one is named in `warnings` (the Studio sets output, map, format and tree itself). */
export function parseCompilerArgs(args: readonly string[]): CompilerArgs {
  const r: CompilerArgs = { defines: {}, includes: [], disabled: [], werror: false, implicit: false, optDisable: [], warnings: [] };
  const LONG = new Set(['--heap', '--heap-address', '--org', '--opt-disable']);
  const SHORT = new Set(['-O', '-D', '-I', '-W']);
  // flags of the command line that take a value and that the Studio decides itself
  const SET_BY_STUDIO = new Set(['-f', '-o', '-M', '--asm', '--stage', '--diagnostics', '--dsk-add', '--runtime']);
  const ignored = (flag: string): void => void r.warnings.push(`"cpcbuild.compiler.args": ${flag} is not used by the Studio (it sets the output, the map and the format itself).`);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === '-Werror') { r.werror = true; continue; }
    if (arg === '-Wimplicit') { r.implicit = true; continue; }
    let name = arg;
    let value: string | undefined;
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) { name = arg.slice(0, eq); value = arg.slice(eq + 1); }
      if (!LONG.has(name)) {
        ignored(name);
        if (SET_BY_STUDIO.has(name) && value === undefined) i++;
        continue;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      name = arg.slice(0, 2);
      if (!SHORT.has(name)) {
        ignored(name);
        if (SET_BY_STUDIO.has(name) && arg.length === 2) i++;
        continue;
      }
      if (arg.length > 2) value = arg.slice(2);
    } else {
      r.warnings.push(`"cpcbuild.compiler.args": "${arg}" is not a flag; the main file comes from the target.`);
      continue;
    }
    if (value === undefined) {
      value = args[++i];
      if (value === undefined) { r.warnings.push(`"cpcbuild.compiler.args": ${name} needs a value.`); break; }
    }
    const bad = (why: string): void => void r.warnings.push(`"cpcbuild.compiler.args": ${name} ${value}: ${why}`);
    switch (name) {
      case '-O': {
        const o = /^[0-3s]$/.test(value) ? parseOptLevel(value) : undefined;
        if (o === undefined) bad('not 0, 1, 2, 3 or s');
        else r.optimize = o;
        break;
      }
      case '--heap':
      case '--heap-address':
      case '--org': {
        const n = parseFlagNumber(value);
        if (n === undefined) bad('not an address (&4000, 0x4000, $4000 or decimal, up to 65535)');
        else if (name === '--heap') r.heap = n;
        else if (name === '--heap-address') r.heapAddress = n;
        else r.org = n;
        break;
      }
      case '-D': {
        const eq = value.indexOf('=');
        const n = eq < 0 ? value : value.slice(0, eq);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) bad('not NAME or NAME=VALUE');
        else r.defines[n] = eq < 0 ? '' : value.slice(eq + 1);
        break;
      }
      case '-I':
        r.includes.push(value);
        break;
      case '-W':
        for (const w of value.split(',')) {
          const t = w.trim();
          if (/^[0-9]{1,3}$/.test(t)) r.disabled.push(Number(t));
          else if (/^W[0-9]{1,3}$/i.test(t)) r.disabled.push(t.toUpperCase());
          else bad(`"${t}" is not a warning code (301 or W301)`);
        }
        break;
      case '--opt-disable':
        for (const n of value.split(',')) {
          const t = n.trim();
          if (/^[a-z0-9][a-z0-9_-]*$/.test(t)) r.optDisable.push(t);
          else bad(`"${t}" is not a pass, rule or feature name`);
        }
        break;
    }
  }
  return r;
}

/** The settings `compileInput` reads. */
export interface CompileSettings {
  /** cpcbuild.build.org. */
  buildOrg?: number;
  /** cpcbuild.compiler.args. */
  compilerArgs?: readonly string[];
}

type Writable<T> = { -readonly [K in keyof T]: T[K] };

/** What `build.ts` hands the compiler besides the file trees (those and the clock are the host's). */
export interface CompileInput {
  /** Relative to the project root, POSIX separators. */
  main: string;
  includePaths: string[];
  defines: Record<string, string>;
  options: Writable<Pick<CompileOptions, 'format' | 'dskName' | 'org' | 'heapSize' | 'heapAddress' | 'optimize' | 'optDisable' | 'map' | 'disabledWarnings' | 'warningsAsErrors' | 'warnImplicit'>>;
  /** Flags of `cpcbuild.compiler.args` that were not honoured. */
  warnings: string[];
}

const posix = (p: string): string => p.replace(/\\/g, '/');

/** The compiler input for a target. Golden-tested. */
export function compileInput(t: Target, _project: Project, settings: CompileSettings = {}): CompileInput {
  const a = parseCompilerArgs(settings.compilerArgs ?? []);
  const defines: Record<string, string> = {};
  for (const d of t.defines) {
    const eq = d.indexOf('=');
    defines[eq < 0 ? d : d.slice(0, eq)] = eq < 0 ? '' : d.slice(eq + 1);
  }
  if (t.bare) defines.CPC_BAREMETAL = '';
  if (t.ownFont) defines.CPC_OWNFONT = '';
  Object.assign(defines, a.defines);
  const options: CompileInput['options'] = { format: t.package, map: true };
  if (t.package === 'dsk') options.dskName = `${t.disc}.BIN`;
  const org = t.org ?? a.org ?? settings.buildOrg;
  if (org !== undefined) options.org = org;
  const heap = t.heap ?? a.heap;
  if (heap !== undefined) options.heapSize = heap;
  if (a.heapAddress !== undefined) options.heapAddress = a.heapAddress;
  const optimize = t.optimize ?? a.optimize;
  if (optimize !== undefined) options.optimize = optimize;
  if (a.optDisable.length) options.optDisable = a.optDisable;
  if (a.disabled.length) options.disabledWarnings = a.disabled;
  if (a.werror) options.warningsAsErrors = true;
  if (a.implicit) options.warnImplicit = true;
  return { main: posix(t.main), includePaths: a.includes.map(posix), defines, options, warnings: a.warnings };
}
