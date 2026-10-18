/**
 * dsk.ts -- reads the catalogue of a CPC .dsk image (standard "MV - CPCEMU" and "EXTENDED CPC DSK") to find
 * what to RUN. The directory is 64 entries of 32 bytes in four 512-byte sectors: on track 0 for Data format
 * (sector ids &C1..), on track 2 for System format (&41..) and on track 1 for IBM format (&01..). No vscode import.
 */

export interface DskFile {
  /** Upper-case name without the extension, spaces trimmed. */
  name: string;
  /** Upper-case extension, spaces trimmed (may be empty). */
  ext: string;
  user: number;
}

interface Sector {
  r: number;
  data: Uint8Array;
}

const ascii = (b: Uint8Array, from: number, len: number): string => String.fromCharCode(...b.subarray(from, from + len));

/** The sectors of one track (side 0), in disc order; undefined when the track does not exist or is unformatted. */
function readTrack(img: Uint8Array, track: number): Sector[] | undefined {
  const extended = ascii(img, 0, 8) === 'EXTENDED';
  if (!extended && ascii(img, 0, 8) !== 'MV - CPC') return undefined;
  const tracks = img[0x30];
  const sides = img[0x31] || 1;
  if (track >= tracks) return undefined;
  const stdSize = img[0x32] | (img[0x33] << 8);
  let pos = 0x100;
  for (let t = 0; t < track * sides; t++) {
    const size = extended ? img[0x34 + t] * 256 : stdSize;
    pos += size;
  }
  const index = track * sides;
  if (extended && img[0x34 + index] === 0) return undefined;
  if (ascii(img, pos, 10) !== 'Track-Info') return undefined;
  const count = img[pos + 0x15];
  const out: Sector[] = [];
  let data = pos + 0x100;
  for (let i = 0; i < count; i++) {
    const e = pos + 0x18 + i * 8;
    const r = img[e + 2];
    const n = img[e + 3];
    const len = extended ? img[e + 6] | (img[e + 7] << 8) : 128 << n;
    if (data + len > img.length) return undefined;
    out.push({ r, data: img.subarray(data, data + len) });
    data += len;
  }
  return out;
}

/** The files in the catalogue (each file once, user 0..15), or undefined when this is not a readable CPC disc image. */
export function readDskCatalogue(img: Uint8Array): DskFile[] | undefined {
  const t0 = readTrack(img, 0);
  if (!t0 || !t0.length) return undefined;
  const base = Math.min(...t0.map((s) => s.r));
  const dirTrack = (base & 0xc0) === 0xc0 ? 0 : (base & 0xc0) === 0x40 ? 2 : 1;
  const sectors = dirTrack === 0 ? t0 : readTrack(img, dirTrack);
  if (!sectors) return undefined;
  const first = Math.min(...sectors.map((s) => s.r));
  const dir: number[] = [];
  for (let r = first; r < first + 4; r++) {
    const s = sectors.find((x) => x.r === r);
    if (!s) break;
    dir.push(...s.data);
  }
  const files: DskFile[] = [];
  const seen = new Set<string>();
  for (let o = 0; o + 32 <= dir.length; o += 32) {
    const user = dir[o];
    if (user > 15) continue; // &E5 = erased
    const key = entryKey(dir, o);
    if (seen.has(key)) continue;
    seen.add(key);
    const text = (from: number, len: number): string =>
      String.fromCharCode(...dir.slice(o + from, o + from + len).map((c) => c & 0x7f)).trim();
    const name = text(1, 8);
    if (!name) continue;
    files.push({ name: name.toUpperCase(), ext: text(9, 3).toUpperCase(), user });
  }
  return files;
}

const entryKey = (dir: number[], o: number): string => `${dir[o]}:${dir.slice(o + 1, o + 12).map((c) => c & 0x7f).join(',')}`;

export type RunChoice =
  | { kind: 'none' }
  | { kind: 'one'; name: string }
  | { kind: 'many'; candidates: string[] };

/**
 * What to type after `RUN"`: the only .BIN or .BAS program (its stem, or NAME.EXT when the same stem exists
 * with both extensions); with several, the candidates to pick from (as NAME.EXT).
 */
export function chooseRunnable(files: readonly DskFile[]): RunChoice {
  const progs = files.filter((f) => f.user === 0 && (f.ext === 'BIN' || f.ext === 'BAS'));
  if (progs.length === 0) return { kind: 'none' };
  if (progs.length === 1) return { kind: 'one', name: progs[0].name };
  return { kind: 'many', candidates: progs.map((f) => `${f.name}.${f.ext}`) };
}
