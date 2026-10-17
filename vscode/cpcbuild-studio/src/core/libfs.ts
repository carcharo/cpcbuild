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

/** `lib/*.bas` and its subfolders `cpcbuild`, `cpcplus`, `zxbuild`, `music` under the cpcbuild checkout. */
export function libraryFiles(libraryDir: string): LibFileInput[] {
  const lib = path.join(libraryDir, 'lib');
  return [...bas(lib, ''), ...bas(lib, 'cpcbuild'), ...bas(lib, 'cpcplus'), ...bas(lib, 'zxbuild'), ...bas(lib, 'music')];
}

/** The compiler's cpc stdlib folder inside a zxbasic checkout, if it is there. */
export function stdlibDirOf(zxbasicDir: string): string | undefined {
  const d = path.join(zxbasicDir, 'src', 'lib', 'arch', 'cpc', 'stdlib');
  return fs.existsSync(d) ? d : undefined;
}

export function stdlibFiles(stdlibDir: string): LibFileInput[] {
  return bas(stdlibDir, '').map((f) => ({ ...f, platform: 'cpc' as const }));
}

/** Index of the library (and, when given, the compiler's cpc stdlib). Library routines come first. */
export function loadIndex(libraryDir: string | undefined, stdlibDir?: string): LibIndex {
  const a = libraryDir ? buildIndex(libraryFiles(libraryDir)) : buildIndex([]);
  if (!stdlibDir) return a;
  const b = buildIndex(stdlibFiles(stdlibDir));
  const routines = [...a.routines, ...b.routines];
  const byName: LibIndex['byName'] = new Map();
  const perFile: LibIndex['perFile'] = new Map();
  for (const r of routines) {
    const k = r.name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), r]);
    perFile.set(r.file, [...(perFile.get(r.file) ?? []), r]);
  }
  return { routines, settings: [...a.settings, ...b.settings], byName, perFile };
}
