/** library.ts -- finds the project and the library behind a source file, and caches the library index. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { includesOf, mask, userDefinedNames } from '../core/bastok';
import { DocsIndex, indexDocs } from '../core/libdocs';
import { loadIndex, stdlibDirOf } from '../core/libfs';
import type { LibIndex } from '../core/libindex';
import { LoadedProject, loadProjectFile, PROJECT_FILE } from './projects';
import { readSettings, resolveLibrary } from './config';

export interface LibraryInfo {
  projectRoot: string;
  project: LoadedProject;
  libDir?: string;
  stdlibDir?: string;
  index: LibIndex;
  docsFile?: string;
  docs?: DocsIndex;
}

/** Nearest folder at or above the file that holds cpcbuild.json (undefined outside any Studio project). */
export function findProjectRoot(file: string): string | undefined {
  let d = path.dirname(file);
  for (let i = 0; i < 40; i++) {
    try {
      if (fs.existsSync(path.join(d, PROJECT_FILE))) return d;
    } catch {
      return undefined;
    }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return undefined;
}

interface Cached {
  index: LibIndex;
  docsFile?: string;
  docs?: DocsIndex;
}

const projectCache = new Map<string, { mtime: number; lp: LoadedProject }>();
const libCache = new Map<string, Cached>();

function projectAt(root: string): LoadedProject {
  const file = path.join(root, PROJECT_FILE);
  let mtime = 0;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    /* unreadable: loadProjectFile reports it */
  }
  const hit = projectCache.get(file);
  if (hit && hit.mtime === mtime) return hit.lp;
  const lp = loadProjectFile(file);
  projectCache.set(file, { mtime, lp });
  return lp;
}

/** Drops the cached indexes (library files changed, or a setting did). */
export function invalidateLibraries(): void {
  libCache.clear();
}

export function libraryFor(file: string): LibraryInfo | undefined {
  const root = findProjectRoot(file);
  if (!root) return undefined;
  const project = projectAt(root);
  const s = readSettings(root);
  const libDir = resolveLibrary(root, s, project.project?.library);
  let stdlibDir: string | undefined;
  const sibling = libDir ? path.resolve(libDir, '..', 'zxbasic') : undefined;
  for (const z of [s.zxbcCwd ? path.resolve(root, s.zxbcCwd) : undefined, sibling]) {
    if (z && (stdlibDir = stdlibDirOf(z))) break;
  }
  const key = `${libDir ?? ''}|${stdlibDir ?? ''}`;
  let c = libCache.get(key);
  if (!c) {
    const docsFile = libDir ? path.join(libDir, 'docs', 'library.md') : undefined;
    let docs: DocsIndex | undefined;
    try {
      docs = docsFile ? indexDocs(fs.readFileSync(docsFile, 'utf8')) : undefined;
    } catch {
      docs = undefined;
    }
    c = { index: loadIndex(libDir, stdlibDir), docsFile: docs ? docsFile : undefined, docs };
    libCache.set(key, c);
  }
  return { projectRoot: root, project, libDir, stdlibDir, ...c };
}

/** What the targets that build this file say about it; undefined where they disagree. */
export function targetFacts(info: LibraryInfo, file: string): { arch?: 'cpc' | 'zx48k'; bare?: boolean } {
  const ts = info.project.project?.targets ?? [];
  const mine = ts.filter((t) => path.resolve(info.projectRoot, t.main) === file);
  const use = mine.length ? mine : ts;
  if (!use.length) return {};
  const arch = use.every((t) => t.arch === use[0].arch) ? use[0].arch : undefined;
  const cpc = use.filter((t) => t.arch === 'cpc');
  const bare = cpc.length && cpc.every((t) => t.bare === cpc[0].bare) && arch === 'cpc' ? cpc[0].bare : undefined;
  return { arch, bare };
}

/** Names the file's own quoted includes define (up to three levels), lower case. */
export function includedUserNames(file: string, text: string, depth = 3, seen = new Set<string>()): Set<string> {
  const out = new Set<string>();
  if (depth <= 0) return out;
  const m = mask(text);
  for (const inc of includesOf(m)) {
    if (inc.angle) continue;
    const f = path.resolve(path.dirname(file), inc.rawPath);
    if (seen.has(f)) continue;
    seen.add(f);
    let t: string;
    try {
      t = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const n of userDefinedNames(mask(t).code)) out.add(n);
    for (const n of includedUserNames(f, t, depth - 1, seen)) out.add(n);
  }
  return out;
}
