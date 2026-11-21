/** doctorText.ts -- the texts of "Check Environment" that do not depend on VS Code (they are tested here). */

export const DOWNLOAD_HINT = 'Run "CPC Game Studio: Download Tools".';

/** What a missing Arkos toolset needs, when a download exists for this platform. */
export const ARKOS_FIX = `${DOWNLOAD_HINT} Or set "cpcbuild.arkos.toolsPath" to a folder with the Arkos Tracker command-line tools. Only needed to convert music and sound effects.`;

/** The fix for a chosen external emulator that is not found. */
export function emulatorFix(emu: 'caprice32' | 'cpcec' | 'rvm'): string {
  if (emu === 'rvm') return 'Install Retro Virtual Machine or set "cpcbuild.run.rvmPath".';
  return `Set "cpcbuild.run.${emu === 'caprice32' ? 'caprice32Path' : 'cpcecPath'}" to the ${emu === 'caprice32' ? 'Caprice32' : 'CPCEC'} program, or choose "emu" in "cpcbuild.run.emulator".`;
}

/** An optional item that needs no action: said as a note, not as a fix. */
export const PYTHON_NOTE = 'Only needed with the python image engine; the built-in engine needs nothing.';

export const emulatorLabel = 'Emulator: CPC Game Studio Emulator';
export const emulatorDetail = (version: string | undefined): string => `installed, ${version ?? 'version unknown'}`;
export const EMULATOR_MISSING = 'not installed (Run uses an external emulator instead)';
