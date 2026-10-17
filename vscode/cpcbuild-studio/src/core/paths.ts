/**
 * paths.ts -- containment of recipe- and document-supplied paths. A path that a .cpcimp, .cpcspr,
 * .tmx or .cpcpal names (a source image, an output file, a palette file) must stay inside the
 * project folder: not absolute, no "..", and no symlink that leads out. No vscode import.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class PathEscapeError extends Error {
  constructor(public readonly rel: string, why: string) {
    super(`"${rel}" ${why}`);
    this.name = 'PathEscapeError';
  }
}

const within = (root: string, abs: string): boolean => {
  const r = path.relative(root, abs);
  return r === '' || (!r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r));
};

/** realpath of the deepest existing ancestor of `abs`, with the rest re-appended. */
function realish(abs: string): string {
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return abs;
      rest.push(path.basename(cur));
      cur = up;
    }
  }
}

/** The absolute path of `rel` under `root`; throws PathEscapeError when it is absolute or leaves `root` (also through a symlink). */
export function insideRoot(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel === '' || rel.includes('\0')) throw new PathEscapeError(String(rel), 'is not a usable path');
  if (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || path.posix.isAbsolute(rel)) {
    throw new PathEscapeError(rel, 'is an absolute path; use a path inside the project folder');
  }
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, rel);
  if (!within(absRoot, abs)) throw new PathEscapeError(rel, 'is outside the project folder');
  if (!within(realish(absRoot), realish(abs))) throw new PathEscapeError(rel, 'leads outside the project folder through a symbolic link');
  return abs;
}

/** insideRoot, as a boolean. */
export function isInsideRoot(root: string, rel: string): boolean {
  try {
    insideRoot(root, rel);
    return true;
  } catch {
    return false;
  }
}

/**
 * For a path a document writes relative to its own folder (`baseDir`): the absolute path, which must
 * stay inside `root` (the project folder). Absolute paths and escapes throw PathEscapeError.
 */
export function insideRootFrom(root: string, baseDir: string, rel: string): string {
  if (typeof rel === 'string' && (path.isAbsolute(rel) || path.win32.isAbsolute(rel) || path.posix.isAbsolute(rel))) {
    throw new PathEscapeError(rel, 'is an absolute path; use a path inside the project folder');
  }
  const abs = path.resolve(baseDir, rel);
  const r = path.relative(path.resolve(root), abs);
  if (path.isAbsolute(r)) throw new PathEscapeError(rel, 'is outside the project folder');
  const p = insideRoot(root, r === '' ? '.' : r);
  return p;
}
