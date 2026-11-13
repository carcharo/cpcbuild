/** libfs.ts -- reads the library files from disk and builds the index (Node only, no vscode). */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildIndex, LibFileInput, LibIndex, platformOfPath } from './libindex';

function bas(dir: string, rel: string): LibFileInput[] {
  const d = path.join(dir, rel);
  let names: string[];
  try {
    names = fs.readdirSync(d).filter((n) => n.toLowerCase().endsWith('.bas')).sort();
  } catch {
    return [];
  }
  return names.map((n) => {
    const p = rel ? `${rel}/${n}` : n;
    return { path: p, text: fs.readFileSync(path.join(d, n), 'utf8'), platform: platformOfPath(p) };
  });
}

/** `lib/*.bas` and its subfolders `cpcbuild`, `cpcplus`, `stdlib`, `music` under `libraryDir` (the folder that holds `lib/`: the bundled copy of cpcbas's library). */
export function libraryFiles(libraryDir: string): LibFileInput[] {
  const lib = path.join(libraryDir, 'lib');
  return [...bas(lib, ''), ...bas(lib, 'cpcbuild'), ...bas(lib, 'cpcplus'), ...bas(lib, 'stdlib'), ...bas(lib, 'music')];
}

/** Index of the library. */
export function loadIndex(libraryDir: string | undefined): LibIndex {
  return buildIndex(libraryDir ? libraryFiles(libraryDir) : []);
}
