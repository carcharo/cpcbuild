import { describe, expect, it } from 'vitest';
import { emuVsixName, emuVsixUrl, Once, RELEASES_PAGE, releaseVersion } from './setup';

describe('setup helpers', () => {
  it('builds the emulator release URL from the version', () => {
    expect(emuVsixName('0.1.0')).toBe('cpcbuild-emu-0.1.0.vsix');
    expect(emuVsixUrl('0.1.0')).toBe('https://github.com/carcharo/cpcbuild/releases/download/v0.1.0/cpcbuild-emu-0.1.0.vsix');
    expect(emuVsixUrl('1.2.3', 'http://127.0.0.1:9')).toBe('http://127.0.0.1:9/download/v1.2.3/cpcbuild-emu-1.2.3.vsix');
    // a release candidate: the stamped release names the rc's tag and file (H2-3: v0.2.0 was a 404 on rc1)
    expect(emuVsixUrl(releaseVersion({ version: '0.2.0', cpcbuildRelease: '0.2.0-rc1' }))).toBe('https://github.com/carcharo/cpcbuild/releases/download/v0.2.0-rc1/cpcbuild-emu-0.2.0-rc1.vsix');
  });

  it('releaseVersion: the stamped release, else the package version', () => {
    expect(releaseVersion({ version: '0.2.0', cpcbuildRelease: '0.2.0-rc2' })).toBe('0.2.0-rc2');
    expect(releaseVersion({ version: '0.2.0' })).toBe('0.2.0');
    expect(releaseVersion({ version: '0.2.0', cpcbuildRelease: '' })).toBe('0.2.0');
    expect(RELEASES_PAGE).toBe('https://github.com/carcharo/cpcbuild/releases');
  });
  it('Once fires once per key until reset', () => {
    const o = new Once();
    expect(o.first('a')).toBe(true);
    expect(o.first('a')).toBe(false);
    expect(o.first('b')).toBe(true);
    o.reset();
    expect(o.first('a')).toBe(true);
  });
});
