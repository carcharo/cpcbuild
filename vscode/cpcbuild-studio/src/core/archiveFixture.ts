/** archiveFixture.ts -- builds small .zip and .tar.gz archives for tests (any entry name, any mode, symlinks). */
import * as zlib from 'node:zlib';

export interface FixEntry {
  name: string;
  /** Text or bytes; omit for a directory (name ends with "/") . */
  data?: string | Buffer;
  /** Unix permission bits (default 0o644 for files, 0o755 for directories). */
  mode?: number;
  /** A symlink to this target (data is the target). */
  link?: string;
  /** zip: store instead of deflate. */
  stored?: boolean;
}

const crcTable = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t.push(c >>> 0);
  }
  return t;
})();
export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function makeZip(entries: FixEntry[], opts: { unix?: boolean } = {}): Buffer {
  const unix = opts.unix ?? true;
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name);
    const isDir = /[/\\]$/.test(e.name);
    const raw = e.link !== undefined ? Buffer.from(e.link) : Buffer.from(e.data ?? '');
    const method = e.stored || isDir || raw.length === 0 ? 0 : 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    parts.push(lh, name, body);
    const mode = e.link !== undefined ? 0o120777 : isDir ? 0o040000 | (e.mode ?? 0o755) : 0o100000 | (e.mode ?? 0o644);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(((unix ? 3 : 0) << 8) | 20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(unix ? (mode << 16) >>> 0 : isDir ? 0x10 : 0, 38);
    ch.writeUInt32LE(off, 42);
    central.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

const oct = (n: number, len: number): string => n.toString(8).padStart(len - 1, '0') + '\0';

export function makeTar(entries: FixEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const e of entries) {
    const isDir = /[/\\]$/.test(e.name);
    const data = e.link !== undefined ? Buffer.alloc(0) : Buffer.from(e.data ?? '');
    const h = Buffer.alloc(512);
    // long names: a GNU 'L' record first
    if (Buffer.byteLength(e.name) > 100) {
      const nm = Buffer.from(e.name + '\0');
      blocks.push(...tarBlock('././@LongLink', nm, 'L', 0o644), Buffer.alloc(0));
    }
    h.write(e.name.slice(0, 100), 0);
    h.write(oct(e.mode ?? (isDir ? 0o755 : 0o644), 8), 100);
    h.write(oct(0, 8), 108);
    h.write(oct(0, 8), 116);
    h.write(oct(data.length, 12), 124);
    h.write(oct(0, 12), 136);
    h.write('        ', 148);
    h.write(e.link !== undefined ? '2' : isDir ? '5' : '0', 156);
    if (e.link !== undefined) h.write(e.link, 157);
    h.write('ustar\0' + '00', 257);
    let sum = 0;
    for (const x of h) sum += x;
    h.write(oct(sum, 7) + ' ', 148);
    blocks.push(h);
    if (data.length) blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function tarBlock(name: string, data: Buffer, type: string, mode: number): Buffer[] {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write(oct(mode, 8), 100);
  h.write(oct(data.length, 12), 124);
  h.write('        ', 148);
  h.write(type, 156);
  h.write('ustar\0' + '00', 257);
  let sum = 0;
  for (const x of h) sum += x;
  h.write(oct(sum, 7) + ' ', 148);
  return [h, data, Buffer.alloc((512 - (data.length % 512)) % 512)];
}

export const makeTarGz = (entries: FixEntry[]): Buffer => zlib.gzipSync(makeTar(entries));
