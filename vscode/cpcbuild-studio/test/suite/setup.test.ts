/** The setup experience: the walkthrough, the one-time message about the old compiler setting, the Arkos button and the emulator install. */
import * as assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { rmrf, samePath, test } from './harness';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const ui = (calls: { message: string; buttons: string[] }[], answer?: string) => ({
  show: async (_k: 'info' | 'warn' | 'error', message: string, ...buttons: string[]) => (calls.push({ message, buttons }), answer),
});

test('walkthrough: cpcbuild.getStarted has three steps (the compiler needs no installing) with completion events and text-only markdown', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
  assert.ok(ext);
  const w = (ext.packageJSON.contributes.walkthroughs as any[]).find((x) => x.id === 'cpcbuild.getStarted');
  assert.ok(w, 'walkthrough contributed');
  assert.strictEqual(w.title, 'Get started with CPC Game Studio');
  assert.strictEqual(w.steps.length, 3);
  const commands = await vscode.commands.getCommands(true);
  for (const st of w.steps) {
    assert.ok(st.completionEvents?.length, `${st.id} has a completion event`);
    assert.ok(fs.existsSync(path.join(ext.extensionPath, st.media.markdown)), `${st.id}: ${st.media.markdown}`);
    const cmd = /\(command:([\w.]+)\)/.exec(st.description)?.[1];
    assert.ok(cmd && commands.includes(cmd), `${st.id} runs a registered command (${cmd})`);
  }
  assert.deepStrictEqual(w.steps.map((s: any) => /\(command:([\w.]+)\)/.exec(s.description)![1]), ['cpcbuild.installEmulator', 'cpcbuild.newProject', 'cpcbuild.buildAndRun']);
  assert.ok(w.steps[1].completionEvents.includes('onCommand:cpcbuild.newProject'));
});

test('the old zxbc.args setting: one message per workspace with the translation, copied only on the click', async () => {
  const a = await api();
  const settingsFile = path.join(fs.realpathSync(process.env.CPCBUILD_TEST_WORKSPACE as string), '.vscode', 'settings.json');
  const before = fs.readFileSync(settingsFile, 'utf8');
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const memento = new Map<string, unknown>();
  const store = { get: <T>(k: string) => memento.get(k) as T | undefined, update: async (k: string, v: unknown) => void memento.set(k, v) };
  const calls: string[][] = [];
  a.settingsMigration.reset();
  try {
    // nothing set: nothing shown
    assert.strictEqual(await a.settingsMigration.offer(store), false);
    fs.writeFileSync(settingsFile, JSON.stringify({ ...JSON.parse(before), 'cpcbuild.zxbc.args': ['-O', '4', '--heap-size', '2048', '--enable-break', '--strict', '-D', 'DEMO=1'] }, null, 2));
    await new Promise((r) => setTimeout(r, 1500)); // the settings watcher
    a.settingsMigration.setUi({ show: async (_m: string, ...b: string[]) => (calls.push(b), undefined) });
    assert.strictEqual(await a.settingsMigration.offer(store), true);
    assert.strictEqual(await a.settingsMigration.offer(store), false, 'only once per workspace');
    const shown = a.settingsMigration.shown();
    assert.strictEqual(shown.length, 1);
    assert.deepStrictEqual(shown[0].buttons, ['Copy to cpcbuild.compiler.args']);
    assert.match(shown[0].message, /\["-O","3","--heap","2048","-D","DEMO=1"\]/);
    assert.match(shown[0].message, /write ON BREAK STOP in the program/);
    assert.match(shown[0].message, /Not translated \(no equivalent\): --strict/);
    assert.deepStrictEqual(cfg.inspect('compiler.args')?.workspaceValue, undefined, 'nothing is written without the click');
  } finally {
    a.settingsMigration.setUi(undefined);
    a.settingsMigration.reset();
    fs.writeFileSync(settingsFile, before);
    await new Promise((r) => setTimeout(r, 500));
  }
});

test('Arkos missing: the message carries the Download Arkos Tools button', async () => {
  const a = await api();
  const calls: { message: string; buttons: string[] }[] = [];
  a.setup.reset();
  a.setup.setUi(ui(calls));
  try {
    await a.setup.notifyArkosMissing('The Arkos command-line tools were not found.');
    assert.deepStrictEqual(calls, [{ message: 'CPC Game Studio: The Arkos command-line tools were not found.', buttons: ['Download Arkos Tools'] }]);
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
      assert.strictEqual(ok.message, 'CPC Game Studio: CPC Game Studio Emulator installed. Run the program again.');
      assert.strictEqual(installed.length, 1);
      assert.ok(samePath(installed[0].fsPath, path.join(dir, 'cpcbuild-emu-9.9.9.vsix')), installed[0].fsPath);
      assert.deepStrictEqual(fs.readFileSync(installed[0].fsPath), vsix);
      assert.deepStrictEqual(opened, []);

      const bad = await a.emuInstall.install({ ...common, version: '8.8.8' });
      assert.strictEqual(bad.ok, false);
      assert.strictEqual(bad.how, 'fallback');
      assert.match(bad.message, /could not download CPC Game Studio Emulator 8\.8\.8: HTTP 404/);
      assert.strictEqual(installed.length, 1, 'nothing installed');
      assert.deepStrictEqual(opened, ['https://github.com/carcharo/cpcbuild/releases']);
      assert.ok(!fs.existsSync(path.join(dir, 'cpcbuild-emu-8.8.8.vsix')), 'the failed download leaves no file');
    });
    // the default version is Studio's own (package.json)
    const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
    assert.strictEqual(ext?.packageJSON.version, '0.2.0');
  } finally {
    rmrf(dir);
  }
});
