import { describe, expect, it } from 'vitest';
import { emuVsixName, emuVsixUrl, Once, RELEASES_PAGE } from './setup';

describe('setup helpers', () => {
  it('builds the emulator release URL from the version', () => {
    expect(emuVsixName('0.1.0')).toBe('cpcbuild-emu-0.1.0.vsix');
    expect(emuVsixUrl('0.1.0')).toBe('https://github.com/carcharo/cpcbuild/releases/download/v0.1.0/cpcbuild-emu-0.1.0.vsix');
    expect(emuVsixUrl('1.2.3', 'http://127.0.0.1:9')).toBe('http://127.0.0.1:9/download/v1.2.3/cpcbuild-emu-1.2.3.vsix');
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
