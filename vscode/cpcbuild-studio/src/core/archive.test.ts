import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ArchiveError, safeEntryPath } from './archive';
import { makeTarGz, makeZip, FixEntry } from './archiveFixture';
import { readTar, readTarGz } from './tar';
import { scratchDir } from './testutil';
import { readZip } from './zip';

const tmp = scratchDir('archive-');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const files: FixEntry[] = [
  { name: 'zxbasic/' },
  { name: 'zxbasic/zxbc', data: '#!/bin/sh\necho 1.19\n', mode: 0o755 },
  { name: 'zxbasic/_internal/', },
  { name: 'zxbasic/_internal/lib.dylib', data: Buffer.alloc(70000, 7), mode: 0o644 },
  { name: 'zxbasic/_internal/empty.txt', data: '' },
  { name: 'zxbasic/stored.txt', data: 'kept as is', stored: true },
];

describe('safeEntryPath', () => {
  it('normalises separators and refuses .., absolute paths, drive letters and NUL', () => {
    expect(safeEntryPath('a/b/./c')).toBe('a/b/c');
    expect(safeEntryPath('a\\b\\c.txt')).toBe('a/b/c.txt');
    expect(safeEntryPath('dir/')).toBe('dir');
    for (const bad of ['../x', 'a/../../x', 'a/..', '/etc/passwd', '\\evil', 'C:\\x', 'c:/x', 'a\0b']) expect(() => safeEntryPath(bad), bad).toThrow(ArchiveError);
  });
});

describe('zip reader', () => {
  const entries = readZip(makeZip(files));
  const by = (n: string) => entries.find((e) => e.path === n);
  it('lists files and directories with their unix modes', () => {
    expect(entries.map((e) => `${e.kind}:${e.path}`)).toEqual([
      'dir:zxbasic', 'file:zxbasic/zxbc', 'dir:zxbasic/_internal', 'file:zxbasic/_internal/lib.dylib', 'file:zxbasic/_internal/empty.txt', 'file:zxbasic/stored.txt',
    ]);
    expect(by('zxbasic/zxbc')?.mode).toBe(0o755);
    expect(by('zxbasic/_internal/lib.dylib')?.mode).toBe(0o644);
  });
  it('inflates deflated and stored entries', () => {
    expect(by('zxbasic/zxbc')?.data().toString()).toBe('#!/bin/sh\necho 1.19\n');
    expect(by('zxbasic/_internal/lib.dylib')?.data().equals(Buffer.alloc(70000, 7))).toBe(true);
    expect(by('zxbasic/_internal/empty.txt')?.data().length).toBe(0);
    expect(by('zxbasic/stored.txt')?.data().toString()).toBe('kept as is');
  });
  it('returns symlinks with their target and gives no mode when the zip is not from unix', () => {
    const z = readZip(makeZip([{ name: 'a/l', link: '../../etc/passwd' }]));
    expect(z[0].kind).toBe('symlink');
    expect(z[0].linkTarget).toBe('../../etc/passwd');
    expect(z[0].data().length).toBe(0);
    expect(readZip(makeZip([{ name: 'x.txt', data: 'x', mode: 0o755 }], { unix: false }))[0].mode).toBe(0);
  });
  it('refuses traversal and absolute names while reading', () => {
    for (const name of ['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:\\win.txt']) {
      expect(() => readZip(makeZip([{ name, data: 'x' }])), name).toThrow(ArchiveError);
    }
  });
  it('reports damage plainly', () => {
    expect(() => readZip(Buffer.from('not a zip at all'))).toThrow(/not a zip/);
    const z = makeZip(files);
    expect(() => readZip(z.subarray(0, z.length - 40))).toThrow(ArchiveError);
    const cut = Buffer.from(z);
    cut.writeUInt32LE(cut.readUInt32LE(cut.length - 6) + 1000, cut.length - 6); // central directory offset beyond the file
    expect(() => readZip(cut)).toThrow(ArchiveError);
  });
  const ditto = process.platform === 'darwin' && spawnSync('ditto', ['-h']).error === undefined;
  (ditto ? it : it.skip)('reads a real `ditto -c -k --keepParent` zip (how the macOS bundles are made), modes included', () => {
    const src = path.join(tmp, 'ditto', 'zxbasic');
    fs.mkdirSync(path.join(src, '_internal'), { recursive: true });
    fs.writeFileSync(path.join(src, 'zxbc'), 'x');
    fs.chmodSync(path.join(src, 'zxbc'), 0o755);
    fs.writeFileSync(path.join(src, '_internal', 'data.txt'), 'y'.repeat(5000));
    const out = path.join(tmp, 'ditto.zip');
    expect(spawnSync('ditto', ['-c', '-k', '--keepParent', src, out]).status).toBe(0);
    const e = readZip(fs.readFileSync(out));
    expect(e.find((x) => x.path === 'zxbasic/zxbc')?.mode).toBe(0o755);
    expect(e.find((x) => x.path === 'zxbasic/_internal/data.txt')?.data().length).toBe(5000);
    expect(e.some((x) => x.path.startsWith('__MACOSX'))).toBe(false);
  });
});

describe('tar.gz reader', () => {
  it('lists files with modes and returns their bytes', () => {
    const e = readTarGz(makeTarGz(files.filter((f) => !f.stored)));
    expect(e.map((x) => `${x.kind}:${x.path}`)).toEqual(['dir:zxbasic', 'file:zxbasic/zxbc', 'dir:zxbasic/_internal', 'file:zxbasic/_internal/lib.dylib', 'file:zxbasic/_internal/empty.txt']);
    expect(e[1].mode).toBe(0o755);
    expect(e[1].data().toString()).toBe('#!/bin/sh\necho 1.19\n');
    expect(e[3].data().equals(Buffer.alloc(70000, 7))).toBe(true);
  });
  it('reads GNU long names', () => {
    const name = 'zxbasic/' + 'deep/'.repeat(30) + 'file.txt';
    const e = readTarGz(makeTarGz([{ name, data: 'hi' }]));
    expect(e[0].path).toBe(name);
  });
  it('returns symlinks with their target and refuses traversal and absolute names', () => {
    expect(readTarGz(makeTarGz([{ name: 'l', link: '/etc/passwd' }]))[0]).toMatchObject({ kind: 'symlink', linkTarget: '/etc/passwd' });
    for (const name of ['../evil', 'a/../../evil', '/abs']) expect(() => readTarGz(makeTarGz([{ name, data: 'x' }])), name).toThrow(ArchiveError);
  });
  it('reports damage plainly', () => {
    expect(() => readTarGz(Buffer.from('plain text'))).toThrow(/gzip/);
    expect(() => readTar(Buffer.from('x'.repeat(512)))).toThrow(/checksum/);
  });
  const tar = spawnSync('tar', ['--version']).error === undefined;
  (tar ? it : it.skip)('reads a real `tar czf` archive', () => {
    const src = path.join(tmp, 'tar', 'zxbasic');
    fs.mkdirSync(path.join(src, '_internal'), { recursive: true });
    fs.writeFileSync(path.join(src, 'zxbc'), 'x');
    fs.chmodSync(path.join(src, 'zxbc'), 0o755);
    fs.writeFileSync(path.join(src, '_internal', 'a.so'), 'z'.repeat(3000));
    // relative names from inside tmp: GNU tar reads "C:\\..." as host:file
    const t = spawnSync('tar', ['czf', 'real.tar.gz', '-C', 'tar', 'zxbasic'], { cwd: tmp, encoding: 'utf8' });
    expect(t.status, t.stderr).toBe(0);
    const e = readTarGz(fs.readFileSync(path.join(tmp, 'real.tar.gz')));
    // unix modes do not exist on a Windows file system
    if (process.platform !== 'win32') expect(e.find((x) => x.path === 'zxbasic/zxbc')?.mode).toBe(0o755);
    else expect(e.find((x) => x.path === 'zxbasic/zxbc')).toBeDefined();
    expect(e.find((x) => x.path === 'zxbasic/_internal/a.so')?.data().length).toBe(3000);
  });
});
