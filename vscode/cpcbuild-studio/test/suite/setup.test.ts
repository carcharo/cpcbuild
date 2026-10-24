/** The setup experience: the walkthrough, the "no compiler" notice, the build-failure button and the emulator install. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import type { BuildResult } from '../../src/ext/build';
import { test } from './harness';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const ui = (calls: { message: string; buttons: string[] }[], answer?: string) => ({
  show: async (_k: 'info' | 'warn' | 'error', message: string, ...buttons: string[]) => (calls.push({ message, buttons }), answer),
});

test('walkthrough: cpcbuild.getStarted has four steps with completion events and text-only markdown', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
  assert.ok(ext);
  const w = (ext.packageJSON.contributes.walkthroughs as any[]).find((x) => x.id === 'cpcbuild.getStarted');
  assert.ok(w, 'walkthrough contributed');
  assert.strictEqual(w.title, 'Get started with CPCBuild');
  assert.strictEqual(w.steps.length, 4);
  const commands = await vscode.commands.getCommands(true);
  for (const st of w.steps) {
    assert.ok(st.completionEvents?.length, `${st.id} has a completion event`);
    assert.ok(fs.existsSync(path.join(ext.extensionPath, st.media.markdown)), `${st.id}: ${st.media.markdown}`);
    const cmd = /\(command:([\w.]+)\)/.exec(st.description)?.[1];
    assert.ok(cmd && commands.includes(cmd), `${st.id} runs a registered command (${cmd})`);
  }
  assert.deepStrictEqual(w.steps.map((s: any) => /\(command:([\w.]+)\)/.exec(s.description)![1]), ['cpcbuild.downloadTools', 'cpcbuild.installEmulator', 'cpcbuild.newProject', 'cpcbuild.buildAndRun']);
  assert.ok(w.steps[2].completionEvents.includes('onCommand:cpcbuild.newProject'));
});

test('no compiler: one notice per session with the three buttons; none when a compiler resolves', async () => {
  const a = await api();
  const calls: { message: string; buttons: string[] }[] = [];
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const keep = { cmd: cfg.inspect('zxbc.command')?.workspaceValue, cwd: cfg.inspect('zxbc.cwd')?.workspaceValue };
  const path0 = process.env.PATH;
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-nopath-'));
  a.setup.reset();
  a.setup.setUi(ui(calls, 'Not Now'));
  try {
    // the workspace's dev settings resolve a compiler: nothing is shown
    assert.strictEqual(await a.setup.offerToolsAtActivation(), false);
    assert.strictEqual(calls.length, 0);
    await cfg.update('zxbc.command', undefined, vscode.ConfigurationTarget.Workspace);
    await cfg.update('zxbc.cwd', undefined, vscode.ConfigurationTarget.Workspace);
    process.env.PATH = emptyDir;
    assert.strictEqual(await a.setup.offerToolsAtActivation(), true);
    assert.strictEqual(await a.setup.offerToolsAtActivation(), false, 'only once per session');
    await new Promise((r) => setTimeout(r, 50));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].message, 'CPCBuild: the Boriel BASIC compiler is not installed yet.');
    assert.deepStrictEqual(calls[0].buttons, ['Download Tools', 'Get Started', 'Not Now']);
  } finally {
    process.env.PATH = path0;
    fs.rmSync(emptyDir, { recursive: true, force: true });
    await cfg.update('zxbc.command', keep.cmd, vscode.ConfigurationTarget.Workspace);
    await cfg.update('zxbc.cwd', keep.cwd, vscode.ConfigurationTarget.Workspace);
    a.setup.setUi(undefined);
    a.setup.reset();
  }
});

test('build failure: a missing compiler gets a Download Tools button; other failures and successes get no notice', async () => {
  const a = await api();
  const calls: { message: string; buttons: string[] }[] = [];
  a.setup.reset();
  a.setup.setUi(ui(calls));
  try {
    const base = { root: '/x', targetId: 't', artifacts: {}, reportLines: [], ms: 1 };
    await a.setup.notifyBuildFailure({ ...base, ok: false, message: 'zxbc: not found. Run "CPCBuild: Download Tools".', compilerMissing: true } as BuildResult);
    await a.setup.notifyBuildFailure({ ...base, ok: false, message: 'zxbc exited with 1' } as BuildResult);
    await a.setup.notifyBuildFailure({ ...base, ok: true } as BuildResult);
    assert.deepStrictEqual(calls, [{ message: 'CPCBuild: zxbc: not found. Run "CPCBuild: Download Tools".', buttons: ['Download Tools'] }]);
    await a.setup.notifyArkosMissing('The Arkos command-line tools were not found.');
    assert.deepStrictEqual(calls[1].buttons, ['Download Arkos Tools']);
  } finally {
    a.setup.setUi(undefined);
    a.setup.reset();
  }
});

async function withVsixServer<T>(blobs: Record<string, Buffer>, fn: (base: string) => Promise<T>): Promise<T> {
  const server = http.createServer((req, res) => {
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

test('emulator install: downloads the vsix of Studio\'s version, installs it by file Uri, and falls back to the releases page', async () => {
  const a = await api();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-emuinst-'));
  const vsix = Buffer.from('PK-fake-vsix');
  try {
    await withVsixServer({ '/download/v9.9.9/cpcbuild-emu-9.9.9.vsix': vsix }, async (base) => {
      const installed: vscode.Uri[] = [];
      const opened: string[] = [];
      const common = { quiet: true, dir, releasesBase: base, install: async (u: vscode.Uri) => void installed.push(u), open: async (u: string) => void opened.push(u) };
      const ok = await a.emuInstall.install({ ...common, version: '9.9.9' });
      assert.strictEqual(ok.ok, true, ok.message);
      assert.strictEqual(ok.how, 'download');
      assert.strictEqual(ok.message, 'CPCBuild: CPCBuild Emulator installed. Run the program again.');
      assert.strictEqual(installed.length, 1);
      assert.strictEqual(installed[0].fsPath, path.join(dir, 'cpcbuild-emu-9.9.9.vsix'));
      assert.deepStrictEqual(fs.readFileSync(installed[0].fsPath), vsix);
      assert.deepStrictEqual(opened, []);

      const bad = await a.emuInstall.install({ ...common, version: '8.8.8' });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.how, 'fallback');
      assert.match(bad.message, /could not download CPCBuild Emulator 8\.8\.8: HTTP 404/);
      assert.strictEqual(installed.length, 1, 'nothing installed');
      assert.deepStrictEqual(opened, ['https://github.com/carcharo/cpcbuild/releases']);
      assert.ok(!fs.existsSync(path.join(dir, 'cpcbuild-emu-8.8.8.vsix')), 'the failed download leaves no file');
    });
    // the default version is Studio's own (package.json)
    const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
    assert.strictEqual(ext?.packageJSON.version, '0.1.0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
