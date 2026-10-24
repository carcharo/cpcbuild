/** setup.ts -- pure helpers for the setup experience: release URLs and once-per-session logic. No vscode import. */

export const RELEASES_PAGE = 'https://github.com/carcharo/cpcbuild/releases';

export const emuVsixName = (version: string): string => `cpcbuild-emu-${version}.vsix`;

/** Where the emulator package of Studio's own version is published. */
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

export const NO_COMPILER_TEXT = 'CPCBuild: the Boriel BASIC compiler is not installed yet.';
export const DOWNLOAD_TOOLS_BUTTON = 'Download Tools';
export const GET_STARTED_BUTTON = 'Get Started';
export const NOT_NOW_BUTTON = 'Not Now';
export const DOWNLOAD_ARKOS_BUTTON = 'Download Arkos Tools';
