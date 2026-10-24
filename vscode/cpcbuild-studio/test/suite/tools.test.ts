import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeTarGz, makeZip, FixEntry } from '../../src/core/archiveFixture';
import { toolsPlatform, ToolsManifest, ToolsPlatform } from '../../src/core/tools';
import { test } from './harness';

const win = process.platform === 'win32';
const x = (n: string): string => (win ? `${n}.exe` : n);
const script = (out: string): string => `#!/bin/sh\necho "${out}"\n`;
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** A tiny stand-in for the compiler bundle and the Arkos zip, in the format the real ones have on this platform. */
function archives(): { zx: Buffer; ar: Buffer; zxExt: string } {
  const exec = 0o755;
  const zxFiles: FixEntry[] = [
    { name: 'zxbasic/' },
    ...['zxbc', 'zxbasm', 'zxbpp', 'mkdsk'].map((n) => ({ name: `zxbasic/${x(n)}`, data: script(`${n} 9.9.9-test`), mode: exec })),
    { name: 'zxbasic/_internal/' },
    { name: 'zxbasic/_internal/base_library.zip', data: 'stub' },
  ];
  const arFiles: FixEntry[] = ['SongToAkg', 'SongToSoundEffects', 'SongToAkm'].map((n) => ({ name: `ArkosTracker3/tools/${x(n)}`, data: script(n), mode: exec }));
  const tar = process.platform === 'linux';
  return { zx: tar ? makeTarGz(zxFiles) : makeZip(zxFiles), ar: makeZip(arFiles), zxExt: tar ? 'tar.gz' : 'zip' };
}

async function withServer<T>(blobs: Record<string, Buffer>, fn: (base: string) => Promise<T>): Promise<T> {
  const server = http.createServer();
  server.on('request', (req, res) => {
    const url = req.url ?? '';
    if (!url.startsWith('/real/')) return void res.writeHead(302, { Location: `/real${url}` }).end();
    const b = blobs[url.slice(5)];
    if (!b) return void res.writeHead(404).end();
    res.writeHead(200, { 'Content-Length': b.length }).end(b);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(`http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

const key = (): ToolsPlatform => {
  const k = toolsPlatform(process.platform, process.arch);
  assert.ok(k, `no tools platform for ${process.platform}-${process.arch}`);
  return k;
};

function manifest(base: string, a: { zx: Buffer; ar: Buffer; zxExt: string }, over: { zxSha?: string; arSha?: string } = {}): ToolsManifest {
  const k = key();
  return {
    zxbasic: { version: '9.9.9-test', assets: { [k]: { url: `${base}/zxbasic.${a.zxExt}`, sha256: over.zxSha ?? sha(a.zx) } } },
    arkos: { version: '9.9', assets: { [k]: { url: `${base}/arkos.zip`, sha256: over.arSha ?? sha(a.ar) } } },
  };
}

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-tools-'));
const download = (arg: unknown): Thenable<any> => vscode.commands.executeCommand('cpcbuild.downloadTools', arg);

test('download tools: the command is contributed and registered', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
  assert.ok(ext);
  await (ext.isActive ? Promise.resolve() : ext.activate());
  const cmd = (ext.packageJSON.contributes.commands as { command: string; title: string; category: string }[]).find((c) => c.command === 'cpcbuild.downloadTools');
  assert.deepStrictEqual(cmd && [cmd.title, cmd.category], ['Download Tools', 'CPCBuild']);
  assert.ok((await vscode.commands.getCommands(true)).includes('cpcbuild.downloadTools'));
  assert.ok((ext.packageJSON.contributes.configuration.properties as Record<string, unknown>)['cpcbuild.sdk.path']);
});

test('download tools: fetches both from a local server (redirect, checksum, unpack), then everything is installed', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    await withServer({ [`/zxbasic.${a.zxExt}`]: a.zx, '/arkos.zip': a.ar }, async (base) => {
      const r = await download({ manifest: manifest(base, a), root, quiet: true });
      assert.strictEqual(r.ok, true, r.message);
      assert.strictEqual(r.message, 'CPCBuild: tools installed: Boriel BASIC 9.9.9-test, Arkos 9.9.');
      assert.deepStrictEqual(r.installed, ['zxbasic', 'arkos']);
      const zx = path.join(root, 'zxbasic-9.9.9-test');
      for (const n of ['zxbc', 'zxbasm', 'zxbpp', 'mkdsk']) assert.ok(fs.existsSync(path.join(zx, x(n))), n);
      assert.ok(fs.existsSync(path.join(zx, '_internal', 'base_library.zip')));
      if (!win) {
        assert.strictEqual(fs.statSync(path.join(zx, 'zxbc')).mode & 0o777, 0o755);
        assert.strictEqual(r.version, 'zxbc 9.9.9-test');
      }
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'arkos-9.9', 'bin')).sort(), [x('SongToAkg'), x('SongToSoundEffects')]);
      assert.deepStrictEqual(fs.readdirSync(root).sort(), ['arkos-9.9', 'zxbasic-9.9.9-test']);
      // a second run has nothing to do
      const again = await download({ manifest: manifest(base, a), root, quiet: true });
      assert.strictEqual(again.ok, true);
      assert.deepStrictEqual(again.installed, []);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('download tools: a wrong checksum is refused with the exact text and installs nothing', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    await withServer({ [`/zxbasic.${a.zxExt}`]: a.zx, '/arkos.zip': a.ar }, async (base) => {
      const r = await download({ manifest: manifest(base, a, { zxSha: '0'.repeat(64) }), root, quiet: true, parts: ['zxbasic'] });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.message, 'CPCBuild: the download of Boriel BASIC 9.9.9-test did not match its checksum and was deleted. Try again; if it keeps failing, report it.');
      assert.deepStrictEqual(fs.readdirSync(root), []);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('download tools: an unpinned entry is refused, and a dead server gives the network text', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    const unpinned = manifest('http://127.0.0.1:9', a, { zxSha: 'PIN' });
    const r = await download({ manifest: unpinned, root, quiet: true, parts: ['zxbasic'] });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /has no checksum for the Boriel BASIC 9\.9\.9-test download yet/);
    const dead = await download({ manifest: manifest('http://127.0.0.1:9', a), root, quiet: true, parts: ['arkos'] });
    assert.strictEqual(dead.ok, false);
    assert.match(dead.message, /^CPCBuild: could not download Arkos Tracker 9\.9: .*\. Check the connection or "http\.proxy", or download the SDK zip from the releases page\.$/);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('download tools: no Arkos tools for linux-arm64 is said plainly', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    const m = manifest('http://127.0.0.1:9', a);
    const r = await download({ manifest: m, root, quiet: true, parts: ['arkos'], platform: 'linux', arch: 'arm64' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.message, 'CPCBuild: Arkos Tracker has no command-line tools for linux-arm64, so music conversion is not available here. Convert songs on another computer, or set "cpcbuild.arkos.toolsPath".');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Runs only when CPCBUILD_SDK_BUNDLE names an unpacked compiler bundle (the `zxbasic/` folder of a release zip):
// the whole path of a user who has no Python and no checkout, through an SDK folder (bin/ = the bundle, lib/ = the library).
const bundle = process.env.CPCBUILD_SDK_BUNDLE;
(bundle ? test : (n: string, _f: () => Promise<void>) => console.log(`  skip ${n} (set CPCBUILD_SDK_BUNDLE)`))('sdk folder: a project builds with the bundled compiler and mkdsk, no Python, no checkout', async () => {
  const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
  const REPO = path.resolve(__dirname, '../../../../..');
  const sdk = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-sdk-'));
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const keys = ['zxbc.command', 'zxbc.cwd', 'library.path', 'sdk.path', 'python.path', 'assets.engine'];
  const saved = keys.map((k) => [k, cfg.inspect(k)?.workspaceValue] as const);
  try {
    fs.cpSync(bundle as string, path.join(sdk, 'bin'), { recursive: true });
    fs.cpSync(path.join(REPO, 'lib'), path.join(sdk, 'lib'), { recursive: true });
    for (const k of keys) await cfg.update(k, undefined, vscode.ConfigurationTarget.Workspace); // back to the defaults
    await cfg.update('sdk.path', sdk, vscode.ConfigurationTarget.Workspace);
    await cfg.update('python.path', path.join(sdk, 'no-python-here'), vscode.ConfigurationTarget.Workspace); // any use of Python would fail
    const ext = vscode.extensions.getExtension<import('../../src/ext/activate').StudioApi>('cpcbuild.cpcbuild-studio');
    assert.ok(ext);
    const api = ext.isActive ? ext.exports : await ext.activate();
    const r = await api.build(fs.realpathSync(ws), 'cpc6128');
    assert.ok(r.ok, r.message);
    assert.ok(r.artifacts.dsk && fs.statSync(r.artifacts.dsk).size > 1000, 'a disc image was written by the bundled mkdsk');
    assert.ok(r.reportLines.length > 0);
  } finally {
    for (const [k, v] of saved) await cfg.update(k, v, vscode.ConfigurationTarget.Workspace);
    fs.rmSync(sdk, { recursive: true, force: true });
  }
});
