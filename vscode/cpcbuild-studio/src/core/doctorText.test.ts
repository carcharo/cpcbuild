import { describe, expect, it } from 'vitest';
import { ARKOS_FIX, emulatorDetail, emulatorFix, emulatorLabel, EMULATOR_MISSING, PYTHON_NOTE } from './doctorText';

describe('Check Environment texts', () => {
  it('no fix talks to a developer: no checkout, make target or fetch script', () => {
    for (const t of [ARKOS_FIX, emulatorFix('caprice32'), emulatorFix('cpcec'), emulatorFix('rvm')]) {
      expect(t).not.toMatch(/checkout|make |fetch\.sh|`/);
    }
    expect(emulatorFix('caprice32')).toBe('Set "cpcbuild.run.caprice32Path" to the Caprice32 program, or choose "emu" in "cpcbuild.run.emulator".');
    expect(emulatorFix('cpcec')).toContain('"cpcbuild.run.cpcecPath"');
  });
  it('the emulator line names the extension by its product name and says it is installed, with its version', () => {
    expect(emulatorLabel).toBe('Emulator: CPC Game Studio Emulator');
    expect(emulatorDetail('0.2.0')).toBe('installed, 0.2.0');
    expect(emulatorDetail(undefined)).toBe('installed, version unknown');
    expect(EMULATOR_MISSING).toContain('not installed');
    expect(`${emulatorLabel}: ${emulatorDetail('0.2.0')}`).not.toContain('cpcbuild.emu.version');
  });
  it('an optional Python that is missing is a note, not a fix', () => {
    expect(PYTHON_NOTE).toMatch(/^Only needed with the python image engine/);
  });
});
