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
import { arkosBinDir, arkosInstalled, extractEntries, failureText, partName, installArkos, NoToolsError, UnpinnedError } from './toolsInstall';

const unix = process.platform !== 'win32';
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');
const script = (out: string): string => `#!/bin/sh\necho "${out}"\n`;
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

/** A manifest whose Arkos asset is served by the local server; `o` can unpin or corrupt the entry. */
function manifestOf(v: string, o: { ar?: Buffer; arName?: string; arSha?: string }): ToolsManifest {
  const ar = o.ar ?? makeZip(arkosFiles);
  const arUrl = serve(o.arName ?? `arkos-${v}.zip`, ar);
  return { arkos: { version: v, assets: { 'linux-x64': { url: arUrl, sha256: o.arSha ?? sha(ar) }, 'windows-x64': { url: arUrl, sha256: o.arSha ?? sha(ar) } } } };
}
const fresh = (): string => fs.mkdtempSync(path.join(root0, 'r-'));
const left = (root: string): string[] => fs.readdirSync(root).sort();

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
  it('refuses an unpinned entry (sha256 "PIN") before downloading anything', async () => {
    const root = fresh();
    const m = manifestOf('3.11', { arSha: 'PIN' });
    await expect(installArkos({ manifest: m, root, platform: 'linux', arch: 'x64' })).rejects.toBeInstanceOf(UnpinnedError);
    expect(fs.existsSync(root) ? left(root) : []).toEqual([]);
  });
  it('refuses an archive that tries to escape the folder', async () => {
    const root = fresh();
    const evil = manifestOf('3.12', { ar: makeZip([{ name: 'ArkosTracker3/tools/../../../evil.txt', data: 'x' }]), arName: 'evil.zip' });
    await expect(installArkos({ manifest: evil, root, platform: 'linux', arch: 'x64' })).rejects.toThrow();
    expect(left(root)).toEqual([]);
    expect(fs.existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
  });
  it('is not offered where its manifest has no entry', async () => {
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
      { name: 'bundle/_internal/Python.framework/Versions/3.14/Python', data: 'lib', mode: 0o755 },
      { name: 'bundle/_internal/Python.framework/Versions/Current', link: '3.14' },
      { name: 'bundle/_internal/Python.framework/Python', link: 'Versions/Current/Python' },
      { name: 'bundle/_internal/Python', link: 'Python.framework/Versions/3.14/Python' },
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
  const m = manifestOf('3.7', {});
  it('checksum, network, unpinned and no-Arkos', () => {
    expect(failureText(new ChecksumError('a', 'b'), 'arkos', m)).toBe('CPC Game Studio: the download of Arkos Tracker 3.7 did not match its checksum and was deleted. Try again; if it keeps failing, report it.');
    expect(failureText(new DownloadError('getaddrinfo ENOTFOUND github.com'), 'arkos', m)).toBe('CPC Game Studio: could not download Arkos Tracker 3.7: getaddrinfo ENOTFOUND github.com. Check the connection or "http.proxy", or download the SDK zip from the releases page.');
    expect(failureText(new UnpinnedError('arkos'), 'arkos', m)).toMatch(/no checksum for the Arkos Tracker 3.7 download yet/);
    expect(failureText(new NoToolsError('arkos', 'linux-arm64'), 'arkos', m)).toBe('CPC Game Studio: Arkos Tracker has no command-line tools for linux-arm64, so music conversion is not available here. Convert songs on another computer, or set "cpcbuild.arkos.toolsPath".');
  });
  it('the Done text names what was installed', () => {
    expect(partName('arkos', m)).toBe('Arkos 3.7');
  });
});
