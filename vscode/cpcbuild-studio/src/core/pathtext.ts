/**
 * pathtext.ts -- path strings the way the Python tools print them (forward slashes). No node imports,
 * so the webview bundle may use it. The tools write Path.as_posix(), so a header reads the same on
 * every OS; on Windows the paths Studio and Node hand over use backslashes.
 */
const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';

/** `p` with "\" turned into "/" where "\" is a path separator (Windows); other systems keep it (a legal file-name character). */
export const posixSlashes = (p: string, win: boolean = IS_WIN): string => (win ? p.replace(/\\/g, '/') : p);

/** The last component of a path (either separator on Windows). */
export const baseName = (p: string, win: boolean = IS_WIN): string => {
  const q = posixSlashes(p, win);
  return q.slice(q.lastIndexOf('/') + 1);
};
