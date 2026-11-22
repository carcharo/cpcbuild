/** setup.ts -- pure helpers for the setup experience: release URLs and once-per-session logic. No vscode import. */

export const RELEASES_PAGE = 'https://github.com/carcharo/cpcbuild/releases';

export const emuVsixName = (version: string): string => `cpcbuild-emu-${version}.vsix`;

/**
 * The release Studio was published in, as in its tag without the "v": the release workflow stamps
 * package.json's "cpcbuildRelease" from the tag (v0.2.0-rc1 -> "0.2.0-rc1"); other builds use "version".
 */
export const releaseVersion = (pkg: { version?: unknown; cpcbuildRelease?: unknown }): string =>
  typeof pkg.cpcbuildRelease === 'string' && pkg.cpcbuildRelease ? pkg.cpcbuildRelease : String(pkg.version);

/** Where the emulator package of Studio's own release is published. */
export const emuVsixUrl = (version: string, base: string = RELEASES_PAGE): string => `${base}/download/v${version}/${emuVsixName(version)}`;

/** Runs something once per session, by key. */
export class Once {
  private seen = new Set<string>();
  /** True the first time for this key only. */
  first(key: string): boolean {
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
  reset(): void {
    this.seen.clear();
  }
}

export const DOWNLOAD_ARKOS_BUTTON = 'Download Arkos Tools';
