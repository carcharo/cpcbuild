import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetForKey, isPinned, ManifestError, parseManifest, toolsPlatform } from './tools';

const sha = 'a'.repeat(64);
const good = (): any => ({
  zxbasic: { version: '1.19.0-cpc.1', assets: { 'windows-x64': { url: 'https://h/z.zip', sha256: 'PIN' }, 'macos-arm64': { url: 'https://h/m.zip', sha256: sha } } },
  arkos: { version: '3.7', assets: { 'macos-arm64': { url: 'https://h/a.zip', sha256: sha }, 'macos-x64': 'macos-arm64' } },
});

describe('platform keys', () => {
  it('maps node platform and arch to the manifest keys', () => {
    expect(toolsPlatform('win32', 'x64')).toBe('windows-x64');
    expect(toolsPlatform('win32', 'arm64')).toBe('windows-arm64');
    expect(toolsPlatform('linux', 'x64')).toBe('linux-x64');
    expect(toolsPlatform('linux', 'arm64')).toBe('linux-arm64');
    expect(toolsPlatform('darwin', 'arm64')).toBe('macos-arm64');
    expect(toolsPlatform('darwin', 'x64')).toBe('macos-x64');
    expect(toolsPlatform('linux', 'ia32')).toBeUndefined();
    expect(toolsPlatform('win32', 'ia32')).toBeUndefined();
    expect(toolsPlatform('freebsd', 'x64')).toBeUndefined();
  });
  it('Windows on ARM takes its own asset, else the x64 one (emulated); no other platform falls back', () => {
    const x64 = { url: 'https://h/x.zip', sha256: sha };
    const arm = { url: 'https://h/a.zip', sha256: sha };
    expect(assetForKey({ version: '1', assets: { 'windows-x64': x64 } }, 'windows-arm64')).toBe(x64);
    expect(assetForKey({ version: '1', assets: { 'windows-x64': x64, 'windows-arm64': arm } }, 'windows-arm64')).toBe(arm);
    expect(assetForKey({ version: '1', assets: { 'linux-x64': x64 } }, 'linux-arm64')).toBeUndefined();
  });
});

describe('tools manifest', () => {
  it('accepts a good manifest and resolves aliases', () => {
    const m = parseManifest(good());
    expect(m.arkos.assets['macos-x64']).toEqual(m.arkos.assets['macos-arm64']);
    expect(m.zxbasic.version).toBe('1.19.0-cpc.1');
    expect(isPinned(m.zxbasic.assets['windows-x64']!)).toBe(false);
    expect(isPinned(m.zxbasic.assets['macos-arm64']!)).toBe(true);
  });
  it('rejects bad shapes with a message naming the field', () => {
    const bad = (f: (m: any) => void, re: RegExp): void => {
      const m = good();
      f(m);
      expect(() => parseManifest(m)).toThrow(ManifestError);
      expect(() => parseManifest(m)).toThrow(re);
    };
    bad((m) => delete m.arkos, /"arkos" is missing/);
    bad((m) => (m.zxbasic.version = ''), /zxbasic\.version/);
    bad((m) => (m.zxbasic.assets['linux-x64'] = { url: 'http://h/x', sha256: sha }), /https/);
    bad((m) => (m.zxbasic.assets['linux-x64'] = { url: 'https://h/x', sha256: 'abc' }), /sha256/);
    bad((m) => (m.zxbasic.assets['linux-x64'] = { url: 'https://h/x', sha256: 'A'.repeat(64) }), /lowercase/);
    bad((m) => (m.zxbasic.assets['beos-x64'] = { url: 'https://h/x', sha256: sha }), /unknown platform/);
    bad((m) => (m.arkos.assets['macos-x64'] = 'linux-x64'), /not an entry/);
    bad((m) => (m.arkos.assets['macos-x64'] = 'macos-x64'), /not an entry/);
    expect(() => parseManifest(null)).toThrow(ManifestError);
  });
  it('the manifest that ships is valid, covers every platform for the compiler and for Arkos', () => {
    const m = parseManifest(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools-manifest.json'), 'utf8')));
    expect(Object.keys(m.zxbasic.assets).sort()).toEqual(['linux-arm64', 'linux-x64', 'macos-arm64', 'macos-x64', 'windows-arm64', 'windows-x64']);
    expect(Object.keys(m.arkos.assets).sort()).toEqual(['linux-arm64', 'linux-x64', 'macos-arm64', 'macos-x64', 'windows-x64']);
    for (const [k, a] of Object.entries(m.zxbasic.assets)) {
      expect(a?.url).toBe(`https://github.com/carcharo/zxbasic/releases/download/v${m.zxbasic.version}/zxbasic-${m.zxbasic.version}-${k}.${k.startsWith('linux') ? 'tar.gz' : 'zip'}`);
    }
    for (const a of Object.values(m.arkos.assets)) expect(isPinned(a!)).toBe(true);
  });
  it('the manifest is listed in .vscodeignore (so it ships in the vsix)', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', '..', '.vscodeignore'), 'utf8').split(/\r?\n/)).toContain('!tools-manifest.json');
  });
});
