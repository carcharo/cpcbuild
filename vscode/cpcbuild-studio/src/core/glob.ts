/**
 * glob.ts -- the small glob dialect of cpcbuild.json "assets" (spec 2.4): `**` any number of
 * folders, `*` any run of characters inside one name, `?` one character. Paths use `/`.
 * Pure TypeScript.
 */

export function globToRegExp(glob: string): RegExp {
  let re = '';
  const g = glob.replace(/\\/g, '/').replace(/^\.\//, '');
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++;
        if (g[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

export function matchesAny(globs: readonly string[], relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(p));
}

/** The folder a glob starts in (its literal prefix), so a walker need not scan the whole project. */
export function globBase(glob: string): string {
  const parts = glob.replace(/\\/g, '/').replace(/^\.\//, '').split('/');
  const base: string[] = [];
  for (const p of parts.slice(0, -1)) {
    if (/[*?]/.test(p)) break;
    base.push(p);
  }
  return base.join('/');
}
