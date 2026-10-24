import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArchiveError } from '../core/archive';
import { FixEntry, makeTarGz, makeZip } from '../core/archiveFixture';
import { readTarGz } from '../core/tar';
import { readZip } from '../core/zip';
import { ToolsManifest } from '../core/tools';
import { scratchDir } from '../core/testutil';
import { ChecksumError, DownloadError } from './download';
import { arkosBinDir, arkosInstalled, extractEntries, failureText, partName, installArkos, installZxbasic, NoToolsError, UnpinnedError, zxbasicDir, zxbasicInstalled } from './toolsInstall';

const unix = process.platform !== 'win32';
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const script = (out: string): string => `#!/bin/sh\necho "${out}"\n`;
const compilerFiles = (v: string): FixEntry[] => [
  { name: 'zxbasic/' },
  { name: 'zxbasic/zxbc', data: script(`zxbc ${v}`), mode: 0o755 },
  { name: 'zxbasic/zxbasm', data: script('zxbasm'), mode: 0o644 }, // a zip without modes still gets chmod 755 on unix
  { name: 'zxbasic/zxbpp', data: script('zxbpp'), mode: 0o755 },
  { name: 'zxbasic/mkdsk', data: script('mkdsk'), mode: 0o755 },
  { name: 'zxbasic/_internal/' },
  { name: 'zxbasic/_internal/base.zip', data: Buffer.alloc(40000, 3) },
];
const arkosFiles: FixEntry[] = [
  { name: 'ArkosTracker3/' },
  { name: 'ArkosTracker3/ArkosTracker3', data: 'gui', mode: 0o755 },
  { name: 'ArkosTracker3/songs/Song.aks', data: 'song' },
  { name: 'ArkosTracker3/tools/SongToAkg', data: script('akg'), mode: 0o755 },
  { name: 'ArkosTracker3/tools/SongToSoundEffects', data: script('sfx'), mode: 0o755 },
  { name: 'ArkosTracker3/tools/SongToAkm', data: script('akm'), mode: 0o755 },
];
const arkosWin: FixEntry[] = [
  { name: 'ArkosTracker3/tools/SongToAkg.exe', data: 'MZ-akg' },
  { name: 'ArkosTracker3/tools/SongToSoundEffects.exe', data: 'MZ-sfx' },
  { name: 'ArkosTracker3/tools/SongToAkm.exe', data: 'MZ-akm' },
];

const root0 = scratchDir('toolsinstall-');
afterAll(() => fs.rmSync(root0, { recursive: true, force: true }));
let server: http.Server;
let base = '';
const blobs = new Map<string, Buffer>();
const serve = (name: string, b: Buffer): string => (blobs.set(`/${name}`, b), `${base}/${name}`);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const b = blobs.get(req.url ?? '');
    if (!b) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Length': b.length }).end(b);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

/** A manifest whose assets are served by the local server; `tweak` can unpin or corrupt entries. */
function manifestOf(v: string, o: { zx?: Buffer; ar?: Buffer; zxName?: string; arName?: string; zxSha?: string; arSha?: string }): ToolsManifest {
  const zx = o.zx ?? makeTarGz(compilerFiles(v));
  const ar = o.ar ?? makeZip(arkosFiles);
  const zxUrl = serve(o.zxName ?? `zxbasic-${v}.tar.gz`, zx);
  const arUrl = serve(o.arName ?? `arkos-${v}.zip`, ar);
  return {
    zxbasic: { version: v, assets: { 'linux-x64': { url: zxUrl, sha256: o.zxSha ?? sha(zx) }, 'windows-x64': { url: zxUrl, sha256: o.zxSha ?? sha(zx) } } },
    arkos: { version: v, assets: { 'linux-x64': { url: arUrl, sha256: o.arSha ?? sha(ar) }, 'windows-x64': { url: arUrl, sha256: o.arSha ?? sha(ar) } } },
  };
}
const fresh = (): string => fs.mkdtempSync(path.join(root0, 'r-'));
const left = (root: string): string[] => fs.readdirSync(root).sort();

describe('install the compiler', () => {
  (unix ? it : it.skip)('downloads, verifies, unpacks into tools/zxbasic-<version>, keeps modes and runs zxbc --version', async () => {
    const root = fresh();
    const m = manifestOf('1.2.3', {});
    const r = await installZxbasic({ manifest: m, root, platform: 'linux', arch: 'x64' });
    const dir = zxbasicDir(root, m);
    expect(r.dir).toBe(dir);
    expect(r.version).toBe('zxbc 1.2.3');
    expect(path.basename(dir)).toBe('zxbasic-1.2.3');
    expect(zxbasicInstalled(root, m, 'linux')).toBe(true);
    for (const n of ['zxbc', 'zxbasm', 'zxbpp', 'mkdsk']) expect(fs.statSync(path.join(dir, n)).mode & 0o777, n).toBe(0o755);
    expect(fs.statSync(path.join(dir, '_internal', 'base.zip')).size).toBe(40000);
    expect(left(root)).toEqual(['zxbasic-1.2.3']); // no staging left behind
  });
  (unix ? it : it.skip)('replaces an older version and the same version again', async () => {
    const root = fresh();
    await installZxbasic({ manifest: manifestOf('1.0.0', {}), root, platform: 'linux', arch: 'x64' });
    fs.mkdirSync(path.join(root, 'arkos-3.7')); // not ours to delete
    const m2 = manifestOf('1.1.0', {});
    await installZxbasic({ manifest: m2, root, platform: 'linux', arch: 'x64' });
    expect(left(root)).toEqual(['arkos-3.7', 'zxbasic-1.1.0']);
    fs.writeFileSync(path.join(zxbasicDir(root, m2), 'stale.txt'), 'x');
    await installZxbasic({ manifest: m2, root, platform: 'linux', arch: 'x64' });
    expect(fs.existsSync(path.join(zxbasicDir(root, m2), 'stale.txt'))).toBe(false);
    expect(left(root)).toEqual(['arkos-3.7', 'zxbasic-1.1.0']);
  });
  it('unpacks a .zip bundle too and runs its zxbc.exe', async () => {
    const root = fresh();
    const files = compilerFiles('2.0.0').map((f) => ({ ...f, name: f.name.replace(/(zxbc|zxbasm|zxbpp|mkdsk)$/, '$1.exe') }));
    const m = manifestOf('2.0.0', { zx: makeZip(files), zxName: 'zx.zip' });
    const r = await installZxbasic({ manifest: m, root, platform: 'win32', arch: 'x64' });
    expect(zxbasicInstalled(root, m, 'win32')).toBe(true);
    expect(fs.existsSync(path.join(r.dir, 'mkdsk.exe'))).toBe(true);
    expect(r.version ?? r.versionError).toBeTruthy(); // a script named zxbc.exe runs on unix; on Windows it would be reported, not thrown
  });
  it('refuses a download that does not match its checksum: deleted, nothing installed, no staging left', async () => {
    const root = fresh();
    const m = manifestOf('3.0.0', { zxSha: '0'.repeat(64) });
    const e = await installZxbasic({ manifest: m, root, platform: 'linux', arch: 'x64' }).catch((x) => x);
    expect(e).toBeInstanceOf(ChecksumError);
    expect(left(root)).toEqual([]);
  });
  it('refuses an unpinned entry (sha256 "PIN") before downloading anything', async () => {
    const root = fresh();
    const m = manifestOf('3.1.0', { zxSha: 'PIN' });
    const hits = blobs.size;
    await expect(installZxbasic({ manifest: m, root, platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(UnpinnedError);
    expect(fs.existsSync(root) ? left(root) : []).toEqual([]);
    expect(blobs.size).toBe(hits);
  });
  it('says so when the platform has no tools', async () => {
    const e = await installZxbasic({ manifest: manifestOf('3.2.0', {}), root: fresh(), platform: 'linux', arch: 'arm64' }).catch((x) => x);
    expect(e).toBeInstanceOf(NoToolsError);
    expect(e.platform).toBe('linux-arm64');
  });
  it('refuses an archive without zxbc, and one that tries to escape', async () => {
    const root = fresh();
    const noZxbc = manifestOf('3.3.0', { zx: makeTarGz([{ name: 'zxbasic/readme.txt', data: 'x' }]), zxName: 'nozx.tar.gz' });
    await expect(installZxbasic({ manifest: noZxbc, root, platform: 'linux', arch: 'x64' })).rejects.toThrow(/holds no zxbc/);
    const evil = manifestOf('3.4.0', { zx: makeZip([{ name: 'zxbasic/../../evil.txt', data: 'x' }]), zxName: 'evil.zip' });
    await expect(installZxbasic({ manifest: { ...evil, zxbasic: { ...evil.zxbasic, assets: { 'linux-x64': evil.zxbasic.assets['windows-x64']! } } }, root, platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(ArchiveError);
    expect(left(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
  });
});

describe('install Arkos', () => {
  (unix ? it : it.skip)('copies only SongToAkg and SongToSoundEffects into tools/arkos-<version>/bin, executable', async () => {
    const root = fresh();
    const m = manifestOf('3.7', {});
    const r = await installArkos({ manifest: m, root, platform: 'linux', arch: 'x64' });
    expect(r.dir).toBe(arkosBinDir(root, m));
    expect(left(r.dir)).toEqual(['SongToAkg', 'SongToSoundEffects']);
    for (const n of left(r.dir)) expect(fs.statSync(path.join(r.dir, n)).mode & 0o777).toBe(0o755);
    expect(fs.readFileSync(path.join(r.dir, 'SongToAkg'), 'utf8')).toContain('akg');
    expect(arkosInstalled(root, m, 'linux')).toBe(true);
    expect(left(root)).toEqual(['arkos-3.7']);
  });
  it('takes the .exe tools from the Windows layout (tools/SongToAkg.exe, nothing else needed)', async () => {
    const root = fresh();
    const m = manifestOf('3.8', { ar: makeZip(arkosWin), arName: 'arkos-win.zip' });
    const r = await installArkos({ manifest: m, root, platform: 'win32', arch: 'x64' });
    expect(left(r.dir)).toEqual(['SongToAkg.exe', 'SongToSoundEffects.exe']);
    expect(arkosInstalled(root, m, 'win32')).toBe(true);
    expect(arkosInstalled(root, m, 'linux')).toBe(false);
  });
  it('fails clearly when the zip lacks a tool, and on a bad checksum', async () => {
    const root = fresh();
    const lacking = manifestOf('3.9', { ar: makeZip(arkosFiles.slice(0, 4)), arName: 'lacking.zip' });
    await expect(installArkos({ manifest: lacking, root, platform: 'linux', arch: 'x64' })).rejects.toThrow(/holds no SongToSoundEffects/);
    const bad = manifestOf('3.9', { arSha: 'f'.repeat(64) });
    await expect(installArkos({ manifest: bad, root, platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(ChecksumError);
    expect(left(root)).toEqual([]);
  });
  it('is not offered for linux-arm64', async () => {
    const m = manifestOf('3.10', {});
    await expect(installArkos({ manifest: m, root: fresh(), platform: 'linux', arch: 'arm64' })).rejects.toBeInstanceOf(NoToolsError);
  });
});

describe('extractEntries', () => {
  const entries = (files: FixEntry[]) => readZip(makeZip(files));
  it('writes files with their modes, creates directories and strips the top folder', () => {
    const d = fresh();
    const r = extractEntries(entries([{ name: 'top/' }, { name: 'top/a/b.txt', data: 'b', mode: 0o755 }, { name: 'top/empty/' }]), d, 1);
    expect(r).toEqual({ files: 1, links: 0, skippedLinks: 0 });
    expect(fs.readFileSync(path.join(d, 'a', 'b.txt'), 'utf8')).toBe('b');
    if (unix) expect(fs.statSync(path.join(d, 'a', 'b.txt')).mode & 0o777).toBe(0o755);
    expect(fs.statSync(path.join(d, 'empty')).isDirectory()).toBe(true);
  });
  it('makes the links of a macOS PyInstaller bundle (_internal/Python -> Python.framework/...)', () => {
    const files: FixEntry[] = [
      { name: 'zxbasic/_internal/Python.framework/Versions/3.14/Python', data: 'lib', mode: 0o755 },
      { name: 'zxbasic/_internal/Python.framework/Versions/Current', link: '3.14' },
      { name: 'zxbasic/_internal/Python.framework/Python', link: 'Versions/Current/Python' },
      { name: 'zxbasic/_internal/Python', link: 'Python.framework/Versions/3.14/Python' },
    ];
    for (const read of [entries, (f: FixEntry[]) => readTarGz(makeTarGz(f))]) {
      const d = fresh();
      if (!unix) {
        expect(extractEntries(read(files), d, 1, 'win32')).toEqual({ files: 1, links: 0, skippedLinks: 3 });
        continue;
      }
      expect(extractEntries(read(files), d, 1)).toEqual({ files: 1, links: 3, skippedLinks: 0 });
      expect(fs.readFileSync(path.join(d, '_internal', 'Python'), 'utf8')).toBe('lib');
      expect(fs.readFileSync(path.join(d, '_internal', 'Python.framework', 'Python'), 'utf8')).toBe('lib');
      expect(fs.lstatSync(path.join(d, '_internal', 'Python')).isSymbolicLink()).toBe(true);
    }
  });
  it('refuses links that are absolute or point outside the folder', () => {
    for (const link of ['/etc/passwd', '../../outside', 'a/../../../x', 'C:\\Windows']) {
      const d = fresh();
      expect(() => extractEntries(entries([{ name: 'top/a/l', link }]), d, 1), link).toThrow(ArchiveError);
      expect(fs.existsSync(path.join(d, 'a', 'l')), link).toBe(false);
    }
  });
  it('refuses an entry that would land outside the folder even if a reader let it through', () => {
    const d = fresh();
    const sneaky = [{ path: 'a/../../x.txt', kind: 'file' as const, mode: 0o644, data: () => Buffer.from('x') }];
    expect(() => extractEntries(sneaky, d)).toThrow(ArchiveError);
    expect(fs.existsSync(path.join(d, '..', 'x.txt'))).toBe(false);
  });
});

describe('the messages (exact text)', () => {
  const m = manifestOf('1.19.0-cpc.1', {});
  const arkosM = { ...m, arkos: { ...m.arkos, version: '3.7' } };
  it('checksum, network, unpinned and no-Arkos', () => {
    expect(failureText(new ChecksumError('a', 'b'), 'zxbasic', arkosM)).toBe('CPC Game Studio: the download of Boriel BASIC 1.19.0-cpc.1 did not match its checksum and was deleted. Try again; if it keeps failing, report it.');
    expect(failureText(new DownloadError('getaddrinfo ENOTFOUND github.com'), 'arkos', arkosM)).toBe('CPC Game Studio: could not download Arkos Tracker 3.7: getaddrinfo ENOTFOUND github.com. Check the connection or "http.proxy", or download the SDK zip from the releases page.');
    expect(failureText(new UnpinnedError('zxbasic'), 'zxbasic', arkosM)).toMatch(/no checksum for the Boriel BASIC 1.19.0-cpc.1 download yet/);
    expect(failureText(new NoToolsError('arkos', 'linux-arm64'), 'arkos', arkosM)).toBe('CPC Game Studio: Arkos Tracker has no command-line tools for linux-arm64, so music conversion is not available here. Convert songs on another computer, or set "cpcbuild.arkos.toolsPath".');
  });
  it('the Done text lists what was installed', () => {
    expect(partName('zxbasic', arkosM)).toBe('Boriel BASIC 1.19.0-cpc.1');
    expect(partName('arkos', arkosM)).toBe('Arkos 3.7');
  });
});
