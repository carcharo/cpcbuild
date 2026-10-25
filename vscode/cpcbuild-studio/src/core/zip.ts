/**
 * zip.ts -- a small zip reader on node:zlib (stored and deflate entries; no zip64, no encryption).
 * Keeps the unix mode in the external attributes (macOS `ditto -c -k` and Info-ZIP write it) and returns
 * symlinks with their target. Every entry name goes through safeEntryPath. No vscode import.
 */
import * as zlib from 'node:zlib';
import { ArchiveEntry, ArchiveError, S_IFDIR, S_IFLNK, S_IFMT, safeEntryPath } from './archive';

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

export function readZip(buf: Buffer): ArchiveEntry[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ArchiveError('not a zip file (no end-of-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new ArchiveError('zip64 archives are not supported');
  const out: ArchiveEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN) throw new ArchiveError('damaged zip (bad central directory)');
    const madeBy = buf.readUInt16LE(p + 4);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const attr = buf.readUInt32LE(p + 38);
    const local = buf.readUInt32LE(p + 42);
    const rawName = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 1) throw new ArchiveError(`encrypted zip entries are not supported (${rawName})`);
    const unixMode = madeBy >> 8 === 3 ? attr >>> 16 : 0;
    // Windows PowerShell's Compress-Archive writes `\` separators, so a folder can end in either; MS-DOS
    // attributes (made by 0) mark folders with 0x10.
    const isDir = /[/\\]$/.test(rawName) || (unixMode & S_IFMT) === S_IFDIR || (madeBy >> 8 === 0 && (attr & 0x10) !== 0);
    const isLink = (unixMode & S_IFMT) === S_IFLNK;
    const name = safeEntryPath(rawName);
    if (!name) continue; // "./" or the like
    const data = (): Buffer => {
      if (isDir) return Buffer.alloc(0);
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== LOC) throw new ArchiveError(`damaged zip (bad local header for ${rawName})`);
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      if (raw.length !== csize) throw new ArchiveError(`damaged zip (${rawName} is cut short)`);
      let d: Buffer;
      if (method === 0) d = Buffer.from(raw);
      else if (method === 8) d = zlib.inflateRawSync(raw);
      else throw new ArchiveError(`unsupported zip compression method ${method} (${rawName})`);
      if (d.length !== usize) throw new ArchiveError(`damaged zip (${rawName} has the wrong size)`);
      return d;
    };
    if (isLink) out.push({ path: name, kind: 'symlink', mode: unixMode & 0o777, data: () => Buffer.alloc(0), linkTarget: data().toString('utf8') });
    else out.push({ path: name, kind: isDir ? 'dir' : 'file', mode: unixMode & 0o777, data });
  }
  return out;
}
