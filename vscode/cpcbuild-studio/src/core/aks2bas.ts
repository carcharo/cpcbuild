/**
 * aks2bas.ts -- the post-processing half of tools/aks2bas.py, ported: an Arkos source export (AKG song or
 * AKX sound effects) -> a Boriel include, a binary song image -> an include of `db` lines, and the PSG
 * clock rewrite of an .aks. The same text / bytes for the same input and options.
 *
 * Running the Arkos command-line tools is not here (src/ext/arkos.ts does it through runTool).
 *
 * Pure TypeScript, no vscode or node imports (pako for the zip an .aks is saved as).
 */
import * as pako from 'pako';

export class Aks2basError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Aks2basError';
  }
}

const DIRECTIVES = new Set(['db', 'dw', 'defb', 'defw', 'defs', 'ds', 'org', 'equ', 'dm', 'defm']);
// `.` of the Python pattern is "anything but \n"; the text has no \r left by then
const LABEL_RE = /^([A-Za-z_][A-Za-z0-9_]*)(:?)(?:[ \t]+([^\n]*))?$/;
const HEX_HASH = /(?<![A-Za-z0-9_$#])#([0-9A-Fa-f]+)\b/g;

/** Splits `code ; comment`, ignoring ';' inside double-quoted strings. */
function splitCodeComment(s: string): [string, string] {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') q = !q;
    else if (ch === ';' && !q) return [s.slice(0, i), s.slice(i)];
  }
  return [s, ''];
}

function mapOutsideStrings(code: string, fn: (p: string) => string): string {
  return code
    .split(/("[^"]*")/)
    .map((p) => (p.startsWith('"') ? p : fn(p)))
    .join('');
}

/** A label the include can use: anything else becomes `_`, and a leading digit gets one in front. */
export function sanitizeName(name: string): string {
  let n = name.replace(/[^A-Za-z0-9_]/g, '_');
  if (!n || /^[0-9]/.test(n)) n = '_' + n;
  return n;
}

/** Python's str.strip() / lstrip(): the whitespace JS's trim() also removes (the two sets agree for source text). */
const isBlank = (s: string): boolean => s.trim() === '';

/** Post-processes an Arkos source export into a Boriel include (.bas). `prefix` is added to every label (the tools already did it). */
export function toBoriel(text: string, name: string, prefix = '', kind: 'song' | 'sfx' = 'song'): string {
  const raw = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  // Pass 1: every column-0 label (with or without ':').
  const labels: string[] = [];
  for (const line of raw) {
    if (!line || ' \t;'.includes(line[0])) continue;
    const m = LABEL_RE.exec(line.trimEnd());
    if (m && !DIRECTIVES.has(m[1].toLowerCase())) labels.push(m[1]);
  }
  if (!labels.length) throw new Aks2basError('no labels found: not an Arkos source export?');
  const lset = new Set(labels);

  const fixOps = (code: string): string =>
    mapOutsideStrings(code, (p0) => {
      let p = p0.replace(HEX_HASH, (_m, h: string) => '0x' + h);
      if (prefix) p = p.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (id) => (lset.has(id) ? prefix + id : id));
      return p;
    });

  const out: string[] = [];
  for (const line of raw) {
    if (isBlank(line)) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (line.trimStart()[0] === ';') {
      out.push('    ' + line.trim());
      continue;
    }
    if (!' \t'.includes(line[0])) {
      const m = LABEL_RE.exec(line.trimEnd());
      if (m && !DIRECTIVES.has(m[1].toLowerCase())) {
        out.push(`${prefix}${m[1]}:`);
        const rest = m[3];
        if (rest) {
          const [code, com] = splitCodeComment(rest);
          if (code.trim()) out.push('    ' + (fixOps(code.trim()) + (com ? ' ' + com : '')));
          else if (com) out.push('    ' + com);
        }
        continue;
      }
    }
    const [code0, com] = splitCodeComment(line);
    const code = fixOps(code0.trim());
    out.push('    ' + (code + (com ? '    ' + com : '')).trim());
  }
  while (out.length && out[out.length - 1] === '') out.pop();

  const guard = '__AKS_' + name.toUpperCase() + '__';
  const skip = '__aks_' + name + '_end';
  const what = kind === 'song' ? 'Arkos AKG song' : 'Arkos sound effects (AKX)';
  const head = [
    `' ${name}.bas -- ${what}, converted by tools/aks2bas.py. Do not edit.`,
    `' Use: #include this at the top level, then pass @${name} to ` + (kind === 'song' ? `MusicInit(@${name}, subsong).` : `SfxInit(@${name}).`),
    '',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    'asm',
    `    jp ${skip}`,
    'end asm',
    `${name}:`,
    'asm',
  ];
  const tail = [`${skip}:`, 'end asm', '', '#endif', ''];
  return [...head, ...out, ...tail].join('\n');
}

/** Python's `{v:#06x}`. */
export const hex06 = (v: number): string => '0x' + v.toString(16).padStart(4, '0');

/** A .bas include holding a binary song image assembled for `adr`. */
export function bankInclude(data: Uint8Array, name: string, adr: number): string {
  const guard = '__AKS_' + name.toUpperCase() + '__';
  const skip = '__aks_' + name + '_end';
  const lines: string[] = [];
  for (let i = 0; i < data.length; i += 16) {
    lines.push('    db ' + Array.from(data.subarray(i, i + 16), (b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(', '));
  }
  const head = [
    `' ${name}.bas -- Arkos AKG song assembled for bank address ${hex06(adr)}, converted by tools/aks2bas.py --at.`,
    `' Do not edit. ${name} is the image (in the program, to copy into a bank at ${hex06(adr)} with`,
    `' BankCopyIn); ${name}_length is its size; start it with MusicInitBank(${hex06(adr)}, subsong, bank).`,
    '',
    `#ifndef ${guard}`,
    `#define ${guard}`,
    '',
    `const ${name}_length as uinteger = ${data.length}`,
    'asm',
    `    jp ${skip}`,
    'end asm',
    `${name}:`,
    'asm',
  ];
  const tail = [`${skip}:`, 'end asm', '', '#endif', ''];
  return [...head, ...lines, ...tail].join('\n');
}

export const PSG_HZ = { cpc: 1_000_000, spectrum: 1_773_400 } as const;

/** Bytes <-> a string of one char per byte (TextDecoder's "latin1" is windows-1252, so by hand). */
const latin1 = (b: Uint8Array): string => Array.from({ length: Math.ceil(b.length / 8192) }, (_, i) => String.fromCharCode(...b.subarray(i * 8192, (i + 1) * 8192))).join('');
const fromLatin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** The first file of a zip archive (the order of the central directory), or throws. Stored and deflated entries only. */
function firstZipEntry(z: Uint8Array): Uint8Array {
  const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  let eocd = -1;
  for (let i = z.length - 22; i >= Math.max(0, z.length - 22 - 0xffff); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Aks2basError('File is not a zip file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (p + 46 > z.length || dv.getUint32(p, true) !== 0x02014b50) throw new Aks2basError('Bad zip file');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = latin1(z.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const body = z.subarray(start, start + csize);
    if (method === 0) return body;
    if (method === 8) return pako.inflateRaw(body);
    throw new Aks2basError(`That compression method is not supported (${method})`);
  }
  throw new Aks2basError('empty .aks archive');
}

/**
 * The .aks XML (`data` may be the zip a tracker saves, or plain XML) with every PSG <frequencyHz> set to `hz`.
 * Works on bytes (latin1 in between), so the rest of the song is untouched.
 */
export function setPsgClock(data: Uint8Array, hz: number): Uint8Array {
  if (data[0] === 0x50 && data[1] === 0x4b) data = firstZipEntry(data);
  const s = latin1(data);
  let n = 0;
  const out = s.replace(/(<frequencyHz>)[ \t\n\r\f\v]*[0-9.]+[ \t\n\r\f\v]*(<\/frequencyHz>)/g, (_m, a: string, b: string) => {
    n++;
    return a + String(hz) + b;
  });
  if (n === 0) throw new Aks2basError('no <frequencyHz> in the song: not an Arkos .aks?');
  return fromLatin1(out);
}

/** Python's `int(s, 0)` for the forms --at takes (decimal without leading zeros, 0x / 0o / 0b); NaN when it is not a number. */
export function pyInt0(s: string): number {
  const t = s.trim().replace(/_(?=[0-9a-fA-F])/g, '');
  const m = /^([+-]?)(?:0[xX]([0-9a-fA-F]+)|0[oO]([0-7]+)|0[bB]([01]+)|(0+|[1-9][0-9]*))$/.exec(t);
  if (!m) return NaN;
  const v = m[2] ? parseInt(m[2], 16) : m[3] ? parseInt(m[3], 8) : m[4] ? parseInt(m[4], 2) : parseInt(m[5], 10);
  return m[1] === '-' ? -v : v;
}
