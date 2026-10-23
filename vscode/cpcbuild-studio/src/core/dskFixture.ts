/** Test fixture: builds a small CPC .dsk image with a given catalogue (shared by the unit and extension-host tests). */
export interface DskOpts {
  extended?: boolean;
  /** First sector id of the directory track: &C1 Data, &41 System, &01 IBM. */
  base: number;
  /** Track holding the directory (0, 2 or 1). */
  dirTrack: number;
  files: string[];
  erased?: string[];
}

const entry = (full: string, user = 0): number[] => {
  const [n, e = ''] = full.split('.');
  const e32 = new Array(32).fill(0);
  e32[0] = user;
  for (let i = 0; i < 8; i++) e32[1 + i] = (n[i] ?? ' ').charCodeAt(0);
  for (let i = 0; i < 3; i++) e32[9 + i] = (e[i] ?? ' ').charCodeAt(0) | (i === 0 ? 0x80 : 0); // bit 7 = flag, must be masked
  return e32;
};

/** Builds a 10-track, 9-sector, 512-byte-sector disc in the standard or extended DSK format. */
export function mkDsk(o: DskOpts): Uint8Array {
  const tracks = 10;
  const secs = 9;
  const trackBytes = 0x100 + secs * 512;
  const out = new Uint8Array(0x100 + tracks * trackBytes);
  const put = (at: number, s: string): void => void [...s].forEach((c, i) => (out[at + i] = c.charCodeAt(0)));
  put(0, o.extended ? 'EXTENDED CPC DSK File\r\nDisk-Info\r\n' : 'MV - CPCEMU Disk-File\r\nDisk-Info\r\n');
  out[0x30] = tracks;
  out[0x31] = 1;
  if (o.extended) for (let t = 0; t < tracks; t++) out[0x34 + t] = trackBytes / 256;
  else (out[0x32] = trackBytes & 255), (out[0x33] = trackBytes >> 8);
  const dir: number[] = [];
  for (const f of o.files) dir.push(...entry(f));
  for (const f of o.erased ?? []) dir.push(...entry(f, 0xe5));
  while (dir.length < 2048) dir.push(0xe5);
  for (let t = 0; t < tracks; t++) {
    const p = 0x100 + t * trackBytes;
    put(p, 'Track-Info\r\n');
    out[p + 0x10] = t;
    out[p + 0x14] = 2;
    out[p + 0x15] = secs;
    for (let i = 0; i < secs; i++) {
      const e = p + 0x18 + i * 8;
      out[e] = t;
      out[e + 2] = o.base + i;
      out[e + 3] = 2;
      if (o.extended) (out[e + 6] = 0), (out[e + 7] = 2);
      if (t === o.dirTrack && i < 4) out.set(dir.slice(i * 512, i * 512 + 512), p + 0x100 + i * 512);
      else out.fill(0xe5, p + 0x100 + i * 512, p + 0x100 + (i + 1) * 512);
    }
  }
  return out;
}
