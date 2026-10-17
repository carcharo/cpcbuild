/**
 * libindex.ts -- an index of the library's SUB/FUNCTION declarations, built
 * from the .bas sources (spec 5.4). Pure TypeScript: callers pass file texts.
 *
 * Documentation comes from the file header (entries such as
 * `'   PutSprite(x, y, w, h, spr)   copy w*h bytes ...` with deeper-indented
 * continuation lines) and, for files without a header entry (the compiler's
 * cpc stdlib), from the comment block directly above the declaration.
 */
import { DECL_RE, END_ROUTINE_RE, mask } from './bastok';

export type Platform = 'cpc' | 'plus' | 'zx';

export interface LibParam {
  name: string;
  /** Upper-case Boriel type, or null when none was written. */
  type: string | null;
  default?: string;
}

export interface LibRoutine {
  name: string;
  kind: 'SUB' | 'FUNCTION';
  params: LibParam[];
  returns: string | null;
  fastcall: boolean;
  /** `PutSprite(x AS INTEGER, ...)` ready for display. */
  signature: string;
  /** What the header (or the comment above) says; soft-wrapped lines joined. */
  doc: string;
  /** Further header paragraphs about the same routine. */
  details: string;
  /** Path relative to its library root, with forward slashes. */
  file: string;
  /** 1-based line of the declaration. */
  line: number;
  /** `#require`d assembly files, in order. */
  requires: string[];
  platform: Platform;
  /** Only exists in one of the firmware / bare-metal builds (the other branch is a compile-time refusal). */
  restriction?: 'bare' | 'firmware';
}

export interface LibSetting {
  name: string;
  file: string;
  line: number;
  doc: string;
}

export interface LibFileInput {
  /** Relative to its library root, forward slashes: `cpcbuild/display.bas`. */
  path: string;
  text: string;
  platform: Platform;
}

export interface LibIndex {
  routines: LibRoutine[];
  settings: LibSetting[];
  byName: Map<string, LibRoutine[]>;
  /** Routines per file path. */
  perFile: Map<string, LibRoutine[]>;
}

interface Decl {
  name: string;
  kind: 'SUB' | 'FUNCTION';
  params: LibParam[];
  returns: string | null;
  fastcall: boolean;
  line: number;
  requires: string[];
  branch?: 'bare' | 'firmware';
  stub: boolean;
  above: string[];
}

export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter((x) => x !== '');
}

export function parseParams(text: string | undefined): LibParam[] {
  if (!text || !text.trim()) return [];
  return splitTop(text).map((p) => {
    const m = /^(?:byval\s+|byref\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*(?:as\s+(\w+))?\s*(?:=\s*(.+))?$/i.exec(p);
    if (!m) return { name: p, type: null };
    return { name: m[1], type: m[2] ? m[2].toUpperCase() : null, ...(m[3] ? { default: m[3].trim() } : {}) };
  });
}

export function signatureOf(d: { name: string; kind: string; params: LibParam[]; returns: string | null }): string {
  const ps = d.params.map((p) => `${p.name}${p.type ? ` AS ${p.type}` : ''}${p.default ? ` = ${p.default}` : ''}`).join(', ');
  return `${d.kind} ${d.name}(${ps})${d.returns ? ` AS ${d.returns}` : ''}`;
}

/** Joins soft-wrapped comment lines; a line indented deeper than the first continuation line starts a new line. */
function joinWrapped(lines: { indent: number; text: string }[]): string {
  let out = '';
  let base = -1;
  for (const l of lines) {
    if (base < 0) base = l.indent;
    if (!out) out = l.text;
    else if (l.indent > base + 2 || /^[A-Za-z0-9_]+:\s/.test(l.text)) out += '\n' + l.text;
    else out += ' ' + l.text;
  }
  return out.trim();
}

const commentOf = (raw: string): { indent: number; text: string } | undefined => {
  const m = /^\s*'( *)(.*?)\s*$/.exec(raw);
  return m ? { indent: m[1].length, text: m[2] } : undefined;
};

interface HeaderEntry {
  names: string[];
  doc: string;
}

/** Header entries: comment lines (before the first code line) that start with a known routine name. */
function headerEntries(raw: string[], known: Set<string>): HeaderEntry[] {
  const out: HeaderEntry[] = [];
  let end = raw.findIndex((l) => !/^\s*'/.test(l));
  if (end < 0) end = raw.length;
  for (let i = 0; i < end; i++) {
    const c = commentOf(raw[i]);
    if (!c || c.indent < 2 || c.indent > 8 || c.text === '') continue;
    const m = /^([A-Za-z_]\w*)(?=\(|\s|$)/.exec(c.text);
    if (!m || !known.has(m[1].toLowerCase())) continue;
    const rest = c.text.slice(m[1].length);
    // an entry has `(` right after the name, a gap of 2+ spaces, `Name args  text`, or nothing else on the line
    if (!(rest.startsWith('(') || /^\s{2,}\S/.test(rest) || /^\s+\S(?:.*?\S)?\s{2,}\S/.test(rest) || rest.trim() === '')) continue;
    // signature part: up to the first gap of 2+ spaces
    const gap = /\s{2,}/.exec(c.text);
    const sig = gap ? c.text.slice(0, gap.index) : c.text;
    const desc = gap ? c.text.slice(gap.index).trim() : '';
    // `MusicInit(a, b)   MusicFrame()   MusicStop()`: a list of names, no description
    const segs = c.text.split(/\s{2,}/);
    if (segs.length > 1 && segs.every((s) => known.has((/^([A-Za-z_]\w*)\(/.exec(s)?.[1] ?? '').toLowerCase()))) {
      out.push({ names: segs.map((s) => /^([A-Za-z_]\w*)/.exec(s)![1]), doc: '' });
      continue;
    }
    const names = sig
      .split(/\s+\/\s+|\s*,\s+(?=[A-Za-z_]\w*\()/)
      .map((s) => /^([A-Za-z_]\w*)/.exec(s.trim())?.[1])
      .filter((n): n is string => !!n && known.has(n.toLowerCase()));
    const cont: { indent: number; text: string }[] = [];
    if (desc) cont.push({ indent: c.indent + gap!.index + gap![0].length, text: desc });
    for (let j = i + 1; j < end; j++) {
      const n = commentOf(raw[j]);
      if (!n || n.text === '' || n.indent <= c.indent) break;
      cont.push({ indent: n.indent, text: n.text });
    }
    out.push({ names: names.length ? names : [m[1]], doc: joinWrapped(cont) });
  }
  return out;
}

function parseDecls(file: string, raw: string[], code: string[]): Decl[] {
  const out: Decl[] = [];
  // conditional-compilation stack: bare/firmware branch of `#ifdef CPC_BAREMETAL`
  const stack: ('bare' | 'firmware' | null)[] = [];
  let cur: Decl | undefined;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const l = code[i];
    const pp = /^\s*#\s*(ifdef|ifndef|if|else|endif)\b\s*(.*)$/i.exec(l);
    if (pp) {
      const d = pp[1].toLowerCase();
      if (d === 'ifdef' || d === 'ifndef') {
        const isBare = /^CPC_BAREMETAL\b/i.test(pp[2].trim());
        stack.push(isBare ? ((d === 'ifdef') === true ? 'bare' : 'firmware') : null);
      } else if (d === 'if') stack.push(null);
      else if (d === 'else') {
        const t = stack.pop();
        stack.push(t === 'bare' ? 'firmware' : t === 'firmware' ? 'bare' : null);
      } else stack.pop();
      continue;
    }
    const rq = /^\s*#\s*require\s+"([^"]+)"/i.exec(raw[i]);
    if (rq && cur && depth === 1) cur.requires.push(rq[1]);
    const m = DECL_RE.exec(l);
    if (m) {
      depth++;
      if (depth === 1 && !/^private/i.test(m[3])) {
        const above: string[] = [];
        for (let j = i - 1; j >= 0; j--) {
          const c = commentOf(raw[j]);
          if (!c) break;
          above.unshift(raw[j]);
        }
        cur = {
          name: m[3],
          kind: m[1].toUpperCase() as 'SUB' | 'FUNCTION',
          params: parseParams(m[4]),
          returns: m[5] ? m[5].toUpperCase() : null,
          fastcall: /fastcall/i.test(m[2] ?? ''),
          line: i + 1,
          requires: [],
          branch: [...stack].reverse().find((x) => x) ?? undefined,
          stub: false,
          above,
        };
        out.push(cur);
      }
      continue;
    }
    if (END_ROUTINE_RE.test(l)) {
      depth = Math.max(0, depth - 1);
      if (depth === 0) cur = undefined;
    }
  }
  // the asm body is masked out of `code`, so look for the refusal marker in the raw text of each body
  for (let k = 0; k < out.length; k++) {
    const from = out[k].line;
    const to = k + 1 < out.length ? out[k + 1].line : raw.length;
    out[k].stub = raw.slice(from, to).some((r) => /\.core\.\w+_needs_/i.test(r));
  }
  void file;
  return out;
}

function settingsOf(file: string, raw: string[]): LibSetting[] {
  const out: LibSetting[] = [];
  const seen = new Set<string>();
  let end = raw.findIndex((l) => l.trim() !== '' && !/^\s*'/.test(l));
  if (end < 0) end = raw.length;
  for (let i = 0; i < end; i++) {
    const m = /^\s*'.*#define\s+([A-Z][A-Z0-9_]+)\b/.exec(raw[i]);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    // the paragraph: the comment lines around, up to a blank comment line
    let a = i;
    let b = i;
    while (a > 0 && commentOf(raw[a - 1])?.text) a--;
    while (b + 1 < end && commentOf(raw[b + 1])?.text) b++;
    const lines = raw.slice(a, b + 1).map((r) => commentOf(r)!).map((c) => ({ indent: c.indent, text: c.text }));
    out.push({ name: m[1], file, line: i + 1, doc: joinWrapped(lines) });
  }
  return out;
}

/** Builds the index from file texts. Pass the files of one library root (the cpcbuild lib/ folder, or the compiler's cpc stdlib folder). */
export function buildIndex(files: LibFileInput[]): LibIndex {
  const masked = files.map((f) => mask(f.text));
  const decls = files.map((f, i) => parseDecls(f.path, masked[i].raw, masked[i].code));
  const known = new Set<string>();
  for (const ds of decls) for (const d of ds) known.add(d.name.toLowerCase());

  // header entries per file, and across the files of one folder (music.bas documents music_cpc.bas)
  const entries = files.map((f, i) => headerEntries(masked[i].raw, known));
  const dirOf = (p: string): string => p.slice(0, p.lastIndexOf('/') + 1);

  const routines: LibRoutine[] = [];
  const settings: LibSetting[] = [];
  files.forEach((f, fi) => {
    settings.push(...settingsOf(f.path, masked[fi].raw));
    // merge duplicate declarations (the #ifdef CPC_BAREMETAL / #else pairs)
    const groups = new Map<string, Decl[]>();
    for (const d of decls[fi]) {
      const k = d.name.toLowerCase();
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(d);
    }
    for (const [k, ds] of groups) {
      const real = ds.filter((d) => !d.stub);
      const primary = real[0] ?? ds[0];
      let restriction: 'bare' | 'firmware' | undefined;
      const stub = ds.find((d) => d.stub && d.branch);
      if (stub && real.length && real.every((d) => d.branch === (stub.branch === 'bare' ? 'firmware' : 'bare'))) {
        restriction = stub.branch === 'bare' ? 'firmware' : 'bare';
      }
      const own = entries[fi].filter((e) => e.names.some((n) => n.toLowerCase() === k)).map((e) => e.doc).filter(Boolean);
      const sibling = own.length
        ? []
        : files.flatMap((g, gi) =>
            gi !== fi && dirOf(g.path) === dirOf(f.path) && (!/_(cpc|zx)\.bas$/.test(g.path) || platformOfPath(g.path) === f.platform) ? entries[gi] : [],
          )
            .filter((e) => e.names.some((n) => n.toLowerCase() === k))
            .map((e) => e.doc)
            .filter(Boolean);
      let docs = own.length ? own : sibling;
      const aboveText = joinWrapped(
        primary.above
          .map((r) => commentOf(r)!)
          .filter((c) => c.text !== '')
          .map((c) => ({ indent: c.indent, text: c.text })),
      );
      if (!docs.length && aboveText) docs = [aboveText];
      // the compiler's top-level stdlib files document their routines above the declaration too: keep that as details
      else if (aboveText && !f.path.includes('/')) docs = [...docs, aboveText];
      const rt: LibRoutine = {
        name: primary.name,
        kind: primary.kind,
        params: primary.params,
        returns: primary.returns,
        fastcall: primary.fastcall,
        signature: signatureOf(primary),
        doc: docs[0] ?? '',
        details: [...new Set(docs.slice(1))].join('\n\n'),
        file: f.path,
        line: primary.line,
        requires: [...new Set(primary.requires)],
        platform: f.platform,
        ...(restriction ? { restriction } : {}),
      };
      routines.push(rt);
    }
  });

  const byName = new Map<string, LibRoutine[]>();
  const perFile = new Map<string, LibRoutine[]>();
  for (const r of routines) {
    (byName.get(r.name.toLowerCase()) ?? byName.set(r.name.toLowerCase(), []).get(r.name.toLowerCase())!).push(r);
    (perFile.get(r.file) ?? perFile.set(r.file, []).get(r.file)!).push(r);
  }
  return { routines, settings, byName, perFile };
}

/** First routine of that name (any case), preferring one for the given platform. */
export function lookup(idx: LibIndex, name: string, prefer?: Platform): LibRoutine | undefined {
  const l = idx.byName.get(name.toLowerCase());
  if (!l) return undefined;
  return (prefer && l.find((r) => r.platform === prefer)) || l[0];
}

/** Platform of a library file from its path (`cpcplus/` is the Plus, `zxbuild/` and `*_zx.bas` the Spectrum). */
export function platformOfPath(p: string): Platform {
  if (/(^|\/)cpcplus\//.test(p)) return 'plus';
  if (/(^|\/)zxbuild\//.test(p) || /_zx\.bas$/.test(p)) return 'zx';
  return 'cpc';
}
