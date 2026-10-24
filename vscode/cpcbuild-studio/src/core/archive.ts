/** archive.ts -- what the zip and tar readers return, and the path rules every entry must pass. No vscode import. */

export class ArchiveError extends Error {}

export interface ArchiveEntry {
  /** Relative, forward slashes, no leading or trailing slash, no `..`. */
  path: string;
  kind: 'file' | 'dir' | 'symlink';
  /** Unix permission bits (0o755, ...); 0 when the archive does not say. */
  mode: number;
  /** The file's bytes (empty for directories and symlinks). Decompresses on call. */
  data(): Buffer;
  /** A symlink's target as stored (relative to the link's folder); the extractor checks it stays inside. */
  linkTarget?: string;
}

/**
 * The entry name as a safe relative path. Refuses (throws ArchiveError) absolute paths, drive letters, `..`
 * segments and NUL bytes: an archive that tries them is damaged or hostile, so nothing is extracted.
 */
export function safeEntryPath(name: string): string {
  if (name.includes('\0')) throw new ArchiveError(`unsafe path in the archive (NUL byte): ${JSON.stringify(name)}`);
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[A-Za-z]:/.test(n)) throw new ArchiveError(`unsafe path in the archive (absolute): ${name}`);
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.includes('..')) throw new ArchiveError(`unsafe path in the archive (".."): ${name}`);
  return parts.join('/');
}

export const S_IFMT = 0o170000;
export const S_IFLNK = 0o120000;
export const S_IFDIR = 0o040000;
