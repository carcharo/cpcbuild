import * as assert from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { makeZip, FixEntry } from '../../src/core/archiveFixture';
import { toolsPlatform, ToolsManifest, ToolsPlatform } from '../../src/core/tools';
import { rmrf, test } from './harness';

const win = process.platform === 'win32';
const x = (n: string): string => (win ? `${n}.exe` : n);
const script = (out: string): string => `#!/bin/sh\necho "${out}"\n`;
const sha = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/** A tiny stand-in for the Arkos zip, in the format the real one has on this platform. */
function archives(): { ar: Buffer } {
  const exec = 0o755;
  const arFiles: FixEntry[] = ['SongToAkg', 'SongToSoundEffects', 'SongToAkm'].map((n) => ({ name: `ArkosTracker3/tools/${x(n)}`, data: script(n), mode: exec }));
  return { ar: makeZip(arFiles) };
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

function manifest(base: string, a: { ar: Buffer }, over: { arSha?: string } = {}): ToolsManifest {
  const k = key();
  return { arkos: { version: '9.9', assets: { [k]: { url: `${base}/arkos.zip`, sha256: over.arSha ?? sha(a.ar) } } } };
}

const tmpRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-tools-'));
const download = (arg: unknown): Thenable<any> => vscode.commands.executeCommand('cpcbuild.downloadTools', arg);

test('download tools: the command is contributed and registered', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
  assert.ok(ext);
  await (ext.isActive ? Promise.resolve() : ext.activate());
  const cmd = (ext.packageJSON.contributes.commands as { command: string; title: string; category: string }[]).find((c) => c.command === 'cpcbuild.downloadTools');
  assert.deepStrictEqual(cmd && [cmd.title, cmd.category], ['Download Tools', 'CPC Game Studio']);
  assert.ok((await vscode.commands.getCommands(true)).includes('cpcbuild.downloadTools'));
  assert.ok((ext.packageJSON.contributes.configuration.properties as Record<string, unknown>)['cpcbuild.sdk.path']);
});

test('download tools offers Arkos only: the compiler is inside the extension', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    await withServer({ '/arkos.zip': a.ar }, async (base) => {
      const r = await download({ manifest: manifest(base, a), root, quiet: true });
      assert.deepStrictEqual(r.offered, ['arkos']);
      assert.strictEqual(r.ok, true, r.message);
      assert.strictEqual(r.message, 'CPC Game Studio: tools installed: Arkos 9.9.');
      assert.deepStrictEqual(r.installed, ['arkos']);
    });
  } finally {
    rmrf(root);
  }
});

test('download tools: fetches Arkos from a local server (redirect, checksum, unpack), then everything is installed', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    await withServer({ '/arkos.zip': a.ar }, async (base) => {
      const r = await download({ manifest: manifest(base, a), root, quiet: true });
      assert.strictEqual(r.ok, true, r.message);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'arkos-9.9', 'bin')).sort(), [x('SongToAkg'), x('SongToSoundEffects')]);
      assert.deepStrictEqual(fs.readdirSync(root).sort(), ['arkos-9.9']);
      // a second run has nothing to do
      const again = await download({ manifest: manifest(base, a), root, quiet: true });
      assert.strictEqual(again.ok, true);
      assert.deepStrictEqual(again.installed, []);
    });
  } finally {
    rmrf(root);
  }
});

test('download tools: a wrong checksum is refused with the exact text and installs nothing', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    await withServer({ '/arkos.zip': a.ar }, async (base) => {
      const r = await download({ manifest: manifest(base, a, { arSha: '0'.repeat(64) }), root, quiet: true, parts: ['arkos'] });
      assert.strictEqual(r.ok, false);
      assert.strictEqual(r.message, 'CPC Game Studio: the download of Arkos Tracker 9.9 did not match its checksum and was deleted. Try again; if it keeps failing, report it.');
      assert.deepStrictEqual(fs.readdirSync(root), []);
    });
  } finally {
    rmrf(root);
  }
});

test('download tools: an unpinned entry is refused, and a dead server gives the network text', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    const unpinned = manifest('http://127.0.0.1:9', a, { arSha: 'PIN' });
    const r = await download({ manifest: unpinned, root, quiet: true, parts: ['arkos'] });
    assert.strictEqual(r.ok, false);
    assert.match(r.message, /has no checksum for the Arkos Tracker 9\.9 download yet/);
    const dead = await download({ manifest: manifest('http://127.0.0.1:9', a), root, quiet: true, parts: ['arkos'] });
    assert.strictEqual(dead.ok, false);
    assert.match(dead.message, /^CPC Game Studio: could not download Arkos Tracker 9\.9: .*\. Check the connection or "http\.proxy", or download the SDK zip from the releases page\.$/);
    assert.deepStrictEqual(fs.readdirSync(root), []);
  } finally {
    rmrf(root);
  }
});

test('download tools: no Arkos tools for linux-arm64 is said plainly', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    const m = manifest('http://127.0.0.1:9', a);
    const r = await download({ manifest: m, root, quiet: true, parts: ['arkos'], platform: 'linux', arch: 'arm64' });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.message, 'CPC Game Studio: Arkos Tracker has no command-line tools for linux-arm64, so music conversion is not available here. Convert songs on another computer, or set "cpcbuild.arkos.toolsPath".');
    // and with nothing else to offer, the pick says it at once
    const all = await download({ manifest: m, root, quiet: true, platform: 'linux', arch: 'arm64' });
    assert.strictEqual(all.ok, false);
    assert.match(all.message, /no command-line tools for linux-arm64/);
  } finally {
    rmrf(root);
  }
});

test('download tools: Windows on ARM is offered the x64 tools (they run under emulation)', async () => {
  const a = archives();
  const root = tmpRoot();
  try {
    const x64 = { url: 'http://127.0.0.1:9/arkos.zip', sha256: sha(a.ar) };
    const m: ToolsManifest = { arkos: { version: '9.9', assets: { 'windows-x64': x64 } } };
    // quiet and no parts: what the walkthrough runs. Arkos is offered, so the download is tried (and the dead server fails it).
    const r = await download({ manifest: m, root, quiet: true, platform: 'win32', arch: 'arm64' });
    assert.strictEqual(r.ok, false);
    assert.doesNotMatch(r.message, /no command-line tools/);
    assert.match(r.message, /could not download/);
  } finally {
    rmrf(root);
  }
});
