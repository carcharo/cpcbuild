/**
 * bastok.ts -- just enough Boriel BASIC lexing for the library index and the
 * lint rules (spec 5.4). Pure TypeScript. Not a parser: it blanks out what is
 * not code (comments, string contents, asm blocks) and finds calls by name.
 */

export interface Masked {
  /** The source lines as written. */
  raw: string[];
  /** Same lengths as `raw`: comments, string contents and asm blocks replaced by spaces. */
  code: string[];
}

/** Blanks comments (`'`, `REM`, `/' '/`), the inside of strings, and `ASM ... END ASM` blocks. Columns are preserved. */
export function mask(text: string): Masked {
  const raw = text.split(/\r?\n/);
  const code: string[] = [];
  let inBlock = false;
  let inAsm = false;
  for (const line of raw) {
    if (inAsm) {
      if (/^\s*end\s+asm\b/i.test(line)) inAsm = false;
      code.push(' '.repeat(line.length));
      continue;
    }
    let out = '';
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inBlock) {
        if (ch === "'" && line[i + 1] === '/') {
          inBlock = false;
          out += '  ';
          i++;
        } else out += ' ';
        continue;
      }
      if (inStr) {
        if (ch === '"') {
          inStr = false;
          out += '"';
        } else out += ' ';
        continue;
      }
      if (ch === '"') {
        inStr = true;
        out += '"';
        continue;
      }
      if (ch === '/' && line[i + 1] === "'") {
        inBlock = true;
        out += '  ';
        i++;
        continue;
      }
      if (ch === "'") {
        out += ' '.repeat(line.length - i);
        break;
      }
      if ((ch === 'r' || ch === 'R') && /^rem\b/i.test(line.slice(i)) && /(^|:)\s*$/.test(out)) {
        out += ' '.repeat(line.length - i);
        break;
      }
      out += ch;
    }
    if (/^\s*asm\b/i.test(out) && !/\bend\s+asm\b/i.test(out)) {
      inAsm = true;
      out = ' '.repeat(line.length);
    } else if (/^\s*asm\b/i.test(out)) out = ' '.repeat(line.length);
    code.push(out);
  }
  return { raw, code };
}

export const DECL_RE = /^\s*(?:public\s+|private\s+)?(sub|function)\s+(fastcall\s+|stdcall\s+)?([A-Za-z_]\w*)\s*(?:\((.*)\))?\s*(?:as\s+(\w+))?\s*$/i;
export const END_ROUTINE_RE = /^\s*end\s+(sub|function)\b/i;

/** The scope number of each line: every SUB/FUNCTION (and the code between them) is its own scope. */
export function scopesOf(code: string[]): number[] {
  const out: number[] = [];
  let id = 0;
  let depth = 0;
  for (const l of code) {
    if (DECL_RE.test(l)) {
      if (depth === 0) id++;
      depth++;
      out.push(id);
    } else if (END_ROUTINE_RE.test(l)) {
      out.push(id);
      if (depth > 0) depth--;
      if (depth === 0) id++;
    } else out.push(id);
  }
  return out;
}

/** Lower-case names the program defines itself (SUB, FUNCTION, DIM, CONST, #define): they shadow library names. */
export function userDefinedNames(code: string[]): Set<string> {
  const out = new Set<string>();
  for (const l of code) {
    let m = DECL_RE.exec(l);
    if (m) out.add(m[3].toLowerCase());
    m = /^\s*(?:(?:dim|const)\s+)(?:\w+\s*,\s*)*([A-Za-z_]\w*)/i.exec(l);
    if (m) out.add(m[1].toLowerCase());
    m = /^\s*#\s*define\s+([A-Za-z_]\w*)/i.exec(l);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

export interface Arg {
  text: string;
  line: number;
  col: number;
}

export interface Call {
  /** Name as written. */
  name: string;
  lower: string;
  line: number;
  col: number;
  form: 'paren' | 'stmt';
  /** Undefined when the argument list does not end on the line (a continued call). */
  args?: Arg[];
}

function splitArgs(s: string, line: number, base: number): Arg[] {
  const out: Arg[] = [];
  let depth = 0;
  let start = 0;
  const push = (end: number): void => {
    const seg = s.slice(start, end);
    const t = seg.trim();
    if (t || out.length || end < s.length) out.push({ text: t, line, col: base + start + (seg.length - seg.trimStart().length) });
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(s.length);
  return out.length === 1 && out[0].text === '' ? [] : out;
}

const NOT_CALL_BEFORE = new Set(['sub', 'function', 'declare', 'dim', 'const', 'as', 'goto', 'gosub', 'let', 'for', 'next']);

/** Calls (in source order) of the given lower-case names, in either `Name(args)` or `Name args` (statement) form. */
export function findCalls(code: string[], names: ReadonlySet<string>): Call[] {
  const out: Call[] = [];
  code.forEach((l, line) => {
    if (/^\s*#/.test(l)) return;
    const re = /[A-Za-z_]\w*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) {
      const lower = m[0].toLowerCase();
      if (!names.has(lower)) continue;
      const idx = m.index;
      const prevCh = l[idx - 1];
      if (prevCh === '.' || prevCh === '@' || prevCh === '$' || prevCh === '&') continue;
      const before = l.slice(0, idx);
      const pw = /([A-Za-z_]\w*)\s*$/.exec(before);
      if (pw && NOT_CALL_BEFORE.has(pw[1].toLowerCase())) continue;
      const after = l.slice(idx + m[0].length);
      const next = after.trimStart();
      if (next[0] === '(') {
        const open = idx + m[0].length + (after.length - next.length);
        let depth = 0;
        let close = -1;
        for (let i = open; i < l.length; i++) {
          if (l[i] === '(') depth++;
          else if (l[i] === ')' && --depth === 0) {
            close = i;
            break;
          }
        }
        out.push({
          name: m[0],
          lower,
          line,
          col: idx,
          form: 'paren',
          args: close >= 0 ? splitArgs(l.slice(open + 1, close), line, open + 1) : undefined,
        });
        continue;
      }
      if (next[0] === '=') continue; // assignment to a variable of that name
      const stmtStart = before.trim() === '' || /:\s*$/.test(before) || /\b(then|else)\s*$/i.test(before) || /^\s*\d+\s*$/.test(before);
      if (!stmtStart) continue;
      // statement form: arguments to the next ':' or ELSE at depth 0
      let depth = 0;
      let end = after.length;
      for (let i = 0; i < after.length; i++) {
        const c = after[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        else if (c === ':' && depth === 0) {
          end = i;
          break;
        } else if (depth === 0 && /^\belse\b/i.test(after.slice(i)) && !/\w/.test(after[i - 1] ?? ' ')) {
          end = i;
          break;
        }
      }
      const argText = after.slice(0, end);
      out.push({ name: m[0], lower, line, col: idx, form: 'stmt', args: splitArgs(argText, line, idx + m[0].length) });
    }
  });
  return out;
}

export interface PpInclude {
  line: number;
  /** Lower-case path as written, without the brackets or quotes. */
  path: string;
  /** Column of the path text. */
  col: number;
  angle: boolean;
  /** The path with its original case (file names are case-sensitive on Linux and macOS volumes). */
  rawPath: string;
}

/** `#include` lines (outside comments); `depth` is the number of open #if blocks at that line. */
export function includesOf(m: Masked): (PpInclude & { depth: number })[] {
  const out: (PpInclude & { depth: number })[] = [];
  const depths = ppDepths(m.code);
  m.code.forEach((l, line) => {
    if (!/^\s*#\s*include\b/i.test(l)) return;
    const r = /^\s*#\s*include\s+(?:once\s+)?([<"])([^>"]+)[>"]/i.exec(m.raw[line]);
    if (!r) return;
    out.push({ line, path: r[2].trim().toLowerCase().replace(/\\/g, '/'), col: m.raw[line].indexOf(r[2], r.index), angle: r[1] === '<', rawPath: r[2].trim(), depth: depths[line] });
  });
  return out;
}

/** Number of open #if/#ifdef/#ifndef blocks at each line (the line of #if itself counts as outside). */
export function ppDepths(code: string[]): number[] {
  const out: number[] = [];
  let d = 0;
  for (const l of code) {
    if (/^\s*#\s*(?:if|ifdef|ifndef)\b/i.test(l)) {
      out.push(d);
      d++;
    } else if (/^\s*#\s*endif\b/i.test(l)) {
      d = Math.max(0, d - 1);
      out.push(d);
    } else out.push(d);
  }
  return out;
}
