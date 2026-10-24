/**
 * tar.ts -- a small reader for .tar.gz on node:zlib: ustar, GNU long names and pax path records.
 * Regular files and directories are returned with their mode, symlinks with their target; hard links
 * and other types are ignored. Every name goes through safeEntryPath.
 * No vscode import.
 */
import * as zlib from 'node:zlib';
import { ArchiveEntry, ArchiveError, safeEntryPath } from './archive';

const octal = (b: Buffer, off: number, len: number): number => {
  const t = b.toString('latin1', off, off + len).replace(/\0.*$/s, '').trim();
  return t ? parseInt(t, 8) : 0;
};
const cstr = (b: Buffer, off: number, len: number): string => b.toString('utf8', off, off + len).replace(/\0.*$/s, '');

export function readTarGz(gz: Buffer): ArchiveEntry[] {
  let buf: Buffer;
  try {
    buf = zlib.gunzipSync(gz);
  } catch (e) {
    throw new ArchiveError(`not a gzip file: ${(e as Error).message}`);
  }
  return readTar(buf);
}

export function readTar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let p = 0;
  let longName: string | undefined;
  let paxPath: string | undefined;
  let paxLink: string | undefined;
  while (p + 512 <= buf.length) {
    const h = buf.subarray(p, p + 512);
    if (h.every((x) => x === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== octal(h, 148, 8)) throw new ArchiveError('damaged tar (bad header checksum)');
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] || 48);
    const body = buf.subarray(p + 512, p + 512 + size);
    if (body.length !== size) throw new ArchiveError('damaged tar (cut short)');
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') {
      longName = cstr(body, 0, body.length);
      continue;
    }
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'));
      if (m) paxPath = m[1];
      const l = /(?:^|\n)\d+ linkpath=([^\n]*)\n/.exec(body.toString('utf8'));
      if (l) paxLink = l[1];
      continue;
    }
    if (type === 'g') continue;
    const prefix = cstr(h, 345, 155);
    const name = paxPath ?? longName ?? (prefix && cstr(h, 257, 5) === 'ustar' ? `${prefix}/` : '') + cstr(h, 0, 100);
    const linkTarget = paxLink ?? cstr(h, 157, 100);
    longName = paxPath = paxLink = undefined;
    const mode = octal(h, 100, 8) & 0o777;
    if (type === '0' || type === '7') {
      const rel = safeEntryPath(name);
      if (rel) out.push({ path: rel, kind: 'file', mode, data: () => Buffer.from(body) });
    } else if (type === '5') {
      const rel = safeEntryPath(name);
      if (rel) out.push({ path: rel, kind: 'dir', mode, data: () => Buffer.alloc(0) });
    } else if (type === '2') {
      const rel = safeEntryPath(name);
      if (rel) out.push({ path: rel, kind: 'symlink', mode, data: () => Buffer.alloc(0), linkTarget });
    }
  }
  return out;
}
