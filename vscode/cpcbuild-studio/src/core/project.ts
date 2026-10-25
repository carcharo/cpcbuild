/**
 * project.ts -- cpcbuild.json (spec 2.4): parsing, validation, defaults, and
 * the zxbc argument list for a target (spec 4.6). Pure TypeScript.
 */

export type Arch = 'cpc' | 'zx48k';
export type PackageKind = 'dsk' | 'cpr' | 'bin' | 'tap';
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
  /** zxbc -H (heap size), used by the Spectrum targets. */
  heap?: number;
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
    else err('library', '"library" must be a path to the cpcbuild checkout (folder with lib/ and tools/), or null.');
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
      if (arch !== 'cpc' && arch !== 'zx48k') err(`${p}.arch`, `"arch" must be "cpc" or "zx48k" (found ${JSON.stringify(t.arch)}).`);
      const main = typeof t.main === 'string' ? t.main : '';
      if (!main) err(`${p}.main`, '"main" is required: the .bas file to compile, e.g. "src/main.bas".');
      const model = t.model === undefined ? '6128' : t.model;
      if (arch === 'cpc' && !MODELS.includes(model as Model)) err(`${p}.model`, `"model" must be one of ${MODELS.join(', ')} (found ${JSON.stringify(t.model)}).`);
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
      if (arch === 'zx48k' && (bare || ownFont)) err(`${p}`, '"bare" and "ownFont" only apply to arch "cpc"; remove them from this Spectrum target.');
      let org: number | undefined;
      if (t.org !== undefined && t.org !== null && t.org !== '') {
        org = parseAddress(t.org);
        if (org === undefined) err(`${p}.org`, `"org" must be an address 0-65535 (0x8000, &8000 or decimal); found ${JSON.stringify(t.org)}.`);
        else if (arch === 'cpc' && org < MIN_ORG) err(`${p}.org`, `"org" &${org.toString(16).toUpperCase()} is below &0040: the compiler refuses an origin there on the CPC. Use 0x40 or higher, or remove "org".`);
      }
      let heap: number | undefined;
      if (t.heap !== undefined && t.heap !== null) {
        if (typeof t.heap === 'number' && Number.isInteger(t.heap) && t.heap >= 0) heap = t.heap;
        else err(`${p}.heap`, '"heap" must be a size in bytes (passed to zxbc -H).');
      }
      let pkg: PackageKind = arch === 'cpc' ? 'dsk' : 'tap';
      if (t.package !== undefined) {
        const ok = arch === 'cpc' ? ['dsk', 'cpr', 'bin'] : ['tap', 'bin'];
        if (typeof t.package === 'string' && ok.includes(t.package)) pkg = t.package as PackageKind;
        else err(`${p}.package`, `"package" for arch "${arch}" must be one of ${ok.join(', ')} (found ${JSON.stringify(t.package)}).`);
      }
      if (arch === 'cpc' && pkg === 'cpr' && (!bare || !ownFont)) {
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
        arch: arch === 'zx48k' ? 'zx48k' : 'cpc',
        main,
        model: (MODELS.includes(model as Model) ? model : '6128') as Model,
        defines,
        bare,
        ownFont,
        org,
        heap,
        package: pkg,
        disc,
      });
    });
  }
  if (errors.length) return { errors, notes };
  return { project: { version: 1, name, library, targets, assets }, errors, notes };
}

export interface ArgOptions {
  /** Folder containing lib/ (the cpcbuild checkout). */
  libraryDir: string;
  /** Absolute path of the source file. */
  main: string;
  /** Absolute path of the compiler output (.bin, or .tap for Spectrum tape). */
  out: string;
  /** Absolute path of the map file (cpc builds). */
  map?: string;
  /** Default origin from cpcbuild.build.org. */
  defaultOrg?: number;
  /** cpcbuild.zxbc.args. */
  extra?: string[];
}

/** The library include path, with the separator `dir` already uses (zxbc accepts both; a mix just reads oddly). */
function libInclude(dir: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return dir.replace(/[\\/]+$/, '') + sep + 'lib';
}

/** The zxbc arguments for a target (everything after the compiler command). Golden-tested. */
export function zxbcArgs(t: Target, o: ArgOptions): string[] {
  const a: string[] = ['--arch', t.arch];
  const org = t.org ?? o.defaultOrg;
  if (t.arch === 'cpc') {
    if (org !== undefined) a.push('--org', '0x' + org.toString(16).toUpperCase());
  } else {
    a.push('-f', t.package === 'tap' ? 'tap' : 'bin');
    if (t.package === 'tap') a.push('-B', '-a');
    if (org !== undefined) a.push('--org', String(org));
    if (t.heap !== undefined) a.push('-H', String(t.heap));
  }
  a.push('-I', libInclude(o.libraryDir));
  for (const d of t.defines) a.push('-D', d);
  if (t.bare) a.push('-D', 'CPC_BAREMETAL');
  if (t.ownFont) a.push('-D', 'CPC_OWNFONT');
  if (o.map && t.arch === 'cpc') a.push('-M', o.map);
  a.push(...(o.extra ?? []));
  a.push('-o', o.out, o.main);
  return a;
}
