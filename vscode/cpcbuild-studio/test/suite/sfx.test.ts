import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { SfxDoc, parseSfx, serialiseSfx } from '../../src/core/sfxDoc';
import { newBank, presetEffect } from '../../src/core/sfxPresets';
import { withSfxConstants } from '../../src/core/sfxBuild';
import type { StudioDocument } from '../../src/ext/customEditor';
import { mkdirp, rmrf, samePath, test, waitFor } from './harness';

const REPO = path.resolve(__dirname, '../../../../..');
/** The Arkos tools, wherever they are (a worktree has no tools/arkos/work of its own). */
const TOOLS = [process.env.AT3_TOOLS, path.join(REPO, 'tools/arkos/work/bin'), path.resolve(REPO, '../../tools/arkos/work/bin')].find(
  (d) => d && fs.existsSync(path.join(d, 'SongToAkg')) && fs.existsSync(path.join(d, 'SongToSoundEffects')),
);

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const VIEW_TYPE = 'cpcbuild.sfxEditor';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

function put(rel: string, text: string): vscode.Uri {
  const f = path.join(ws, 'sfx', rel);
  mkdirp(path.dirname(f));
  fs.writeFileSync(f, text);
  return vscode.Uri.file(f);
}

async function openSfx(uri: vscode.Uri): Promise<{ a: StudioApi; doc: StudioDocument<SfxDoc> }> {
  const a = await api();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  const doc = await waitFor('sfx document', () => a.sfx.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, 'the active tab is the sound effects editor');
  return { a, doc };
}

const closeClean = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

function bank(): SfxDoc {
  const b = newBank();
  b.effects.push(presetEffect('jump', 'jump'));
  return b;
}

test('sfx: a .cpcsfx opens in the custom editor, the webview renders it, no webview error', async () => {
  const uri = put('open.cpcsfx', serialiseSfx(bank()));
  const { doc } = await openSfx(uri);
  assert.deepStrictEqual(doc.state.effects.map((e) => e.name), ['blip', 'jump']);
  await waitFor('the first render', () => doc.renderedCount > 0);
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
});

test('sfx: edit, undo, redo, save and round trip', async () => {
  const text = serialiseSfx(bank());
  const uri = put('edit.cpcsfx', text);
  const { a, doc } = await openSfx(uri);
  const v0 = doc.version;
  a.sfx.commit(doc, { op: 'rename', effect: 1, name: 'hop' });
  assert.strictEqual(doc.state.effects[1].name, 'hop');
  assert.ok(doc.version > v0);
  assert.strictEqual(doc.undoDepth, 1);
  a.sfx.commit(doc, { op: 'addBlank' });
  assert.strictEqual(doc.state.effects.length, 3);
  assert.ok(a.sfx.undoLast(doc));
  assert.strictEqual(doc.state.effects.length, 2);
  assert.ok(a.sfx.redoLast(doc));
  assert.strictEqual(doc.state.effects.length, 3);
  assert.ok(a.sfx.undoLast(doc));
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('file written', () => fs.readFileSync(uri.fsPath, 'utf8') !== text);
  const saved = fs.readFileSync(uri.fsPath, 'utf8');
  const parsed = parseSfx(saved);
  assert.ok(parsed.doc, 'the saved file parses');
  assert.deepStrictEqual(parsed.doc.effects.map((e) => e.name), ['blip', 'hop']);
  assert.strictEqual(serialiseSfx(parsed.doc), saved, 'byte-identical round trip');
  // undo back to the original names and save again: the original text returns
  assert.ok(a.sfx.undoLast(doc));
  await a.sfx.saveCustomDocument(doc);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text);
  await closeClean();
});

test('sfx: drawing frames by hand removes the preset and undo brings it back', async () => {
  const uri = put('draw.cpcsfx', serialiseSfx(bank()));
  const { a, doc } = await openSfx(uri);
  const before = doc.state.effects[0];
  assert.ok(before.preset);
  const f = { ...before.frames[2], pitch: 80, volume: 7 };
  a.sfx.commit(doc, { op: 'setFrames', effect: 0, start: 2, frames: [f], label: 'Draw pitch' });
  assert.strictEqual(doc.state.effects[0].preset, undefined);
  assert.strictEqual(doc.state.effects[0].frames[2].pitch, 80);
  assert.strictEqual(doc.state.effects[0].frames.length, before.frames.length);
  a.sfx.undoLast(doc);
  assert.deepStrictEqual(doc.state.effects[0].preset, before.preset);
  assert.deepStrictEqual(doc.state.effects[0].frames, before.frames);
  await closeClean();
});

test('sfx: a bad op is refused with its message, a stale edit from a webview is rejected, Play in emulator refuses a bad effect', async () => {
  const uri = put('bad.cpcsfx', serialiseSfx(bank()));
  const { a, doc } = await openSfx(uri);
  assert.throws(() => a.sfx.commit(doc, { op: 'rename', effect: 1, name: 'BLIP' }), /already used by effect 1/);
  const p = a.sfx as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  await assert.rejects(p.request(doc, 'edit', { baseVersion: doc.version + 5, op: { op: 'addBlank' } }), /changed in another view/);
  const r = (await p.request(doc, 'edit', { baseVersion: doc.version, op: { op: 'addBlank' } })) as { version: number };
  assert.strictEqual(r.version, doc.version);
  assert.strictEqual(doc.state.effects.length, 3);
  await assert.rejects(p.request(doc, 'playInEmulator', { effect: 7 }), /choose an effect of the bank/);
  a.sfx.undoLast(doc);
  await closeClean();
});

test('sfx: a file that is not a bank shows the error and is not overwritten; an empty file opens as a new bank', async () => {
  const text = JSON.stringify({ format: 'cpcsfx', version: 1, effects: [{ name: '1bad', frames: [] }] });
  const uri = put('broken.cpcsfx', text);
  const { a, doc } = await openSfx(uri);
  assert.match(doc.fatal ?? '', /effects\[0\]\.name/);
  await assert.rejects(a.sfx.saveCustomDocument(doc), /effects\[0\]\.name/);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text);
  await closeClean();
  const empty = put('empty.cpcsfx', '');
  const e = await openSfx(empty);
  assert.strictEqual(e.doc.fatal, undefined);
  assert.deepStrictEqual(e.doc.state.effects.map((x) => x.name), ['blip']);
  await closeClean();
});

test('sfx: New Sound Effects Bank creates assets/sfx.cpcsfx (then sfx2, sfx3) in the project and opens it', async () => {
  const a = await api();
  const root = path.join(ws, 'sfxproj');
  rmrf(root);
  mkdirp(root);
  for (const name of ['sfx.cpcsfx', 'sfx2.cpcsfx', 'sfx3.cpcsfx']) {
    const uri = (await vscode.commands.executeCommand('cpcbuild.newSfxBank', { root })) as vscode.Uri | undefined;
    assert.ok(uri, 'the command returns the new file');
    assert.ok(samePath(uri.fsPath, path.join(root, 'assets', name)), uri.fsPath);
    const doc = await waitFor('new document', () => a.sfx.documents.get(uri.toString()));
    await waitFor('ready', () => doc.readyCount > 0);
    assert.deepStrictEqual(doc.state.effects.map((e) => e.name), ['blip']);
    assert.deepStrictEqual(doc.webviewErrors, []);
    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), serialiseSfx(newBank()));
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE);
    await closeClean();
  }
});

test('sfx: the editor is contributed as the default for *.cpcsfx, with its command', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
  const ce = pkg.contributes.customEditors.find((c: { viewType: string }) => c.viewType === VIEW_TYPE);
  assert.strictEqual(ce.priority, 'default');
  assert.strictEqual(ce.displayName, 'CPC Sound Effects Editor');
  assert.deepStrictEqual(ce.selector.map((s: { filenamePattern: string }) => s.filenamePattern), ['*.cpcsfx']);
  const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === 'cpcbuild.newSfxBank');
  assert.deepStrictEqual([cmd.category, cmd.title], ['CPC Game Studio', 'New Sound Effects Bank']);
});

// ----------------------------------------------------------------------- build integration

function coinBank(): SfxDoc {
  const b = newBank();
  b.effects.push(presetEffect('coin', 'coin'));
  return b;
}

const MAIN_BAS = `#include <cpc.bas>
#include <cpcbuild.bas>
#include <music/music.bas>
#include "../assets/sfx.bas"
SfxInit(@sfx)
SfxPlay(SFX_COIN, 2, 0)
`;

function sfxProject(name: string): string {
  const root = path.join(ws, name);
  rmrf(root);
  mkdirp(path.join(root, 'assets'));
  mkdirp(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'cpcbuild.json'), JSON.stringify({ version: 1, name, targets: [{ id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', package: 'dsk' }], assets: ['assets/**/*.cpcsfx'] }, null, 2));
  fs.writeFileSync(path.join(root, 'src/main.bas'), MAIN_BAS);
  fs.writeFileSync(path.join(root, 'assets/sfx.cpcsfx'), serialiseSfx(coinBank()));
  return root;
}

test('sfx: Regenerate Assets writes sfx.vt2 and sfx.bas with the constants, and a build with them compiles', async () => {
  if (!TOOLS) return console.log('       (skipped: no Arkos tools)');
  const a = await api();
  const root = sfxProject('sfxbuild');
  const res = (await vscode.commands.executeCommand('cpcbuild.regenerateAssets', { root })) as { recipe: string; ok: boolean; error?: string; written: string[] }[];
  const mine = res.filter((r) => r.recipe === 'assets/sfx.cpcsfx');
  assert.deepStrictEqual(mine.map((r) => r.error ?? 'ok'), ['ok']);
  const bas = fs.readFileSync(path.join(root, 'assets/sfx.bas'), 'utf8');
  assert.ok(bas.includes('CONST SFX_BLIP AS UBYTE = 1\nCONST SFX_COIN AS UBYTE = 2'), 'the constants');
  assert.ok(fs.existsSync(path.join(root, 'assets/sfx.vt2')));
  assert.ok(!fs.existsSync(path.join(root, 'assets/sfx_zx.bas')), 'a CPC-only project has no Spectrum include');
  // the pre-build pass: remove the output, build, and it is back (stale = missing)
  fs.rmSync(path.join(root, 'assets/sfx.bas'));
  const b = await a.build(fs.realpathSync(root), 'cpc6128');
  assert.ok(b.ok, b.message);
  assert.ok(fs.existsSync(path.join(root, 'assets/sfx.bas')), 'regenerated before the build');
  rmrf(root);
});

test('sfx: a build without the Arkos tools keeps the committed sfx.bas and warns instead of failing', async () => {
  const a = await api();
  const root = sfxProject('sfxnotools');
  // a stand-in for a committed include: bounce's real one, renamed, with the constants
  const real = fs.readFileSync(path.join(REPO, 'examples/assets/bounce_sfx.bas'), 'utf8').split('bounce_sfx').join('sfx').split('BOUNCE_SFX').join('SFX');
  const kept = withSfxConstants(real, coinBank(), 'sfx');
  const f = path.join(root, 'assets/sfx.bas');
  fs.writeFileSync(f, kept);
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(f, old, old);
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  await cfg.update('arkos.toolsPath', '/nonexistent/arkos', vscode.ConfigurationTarget.Workspace);
  try {
    const b = await a.build(fs.realpathSync(root), 'cpc6128');
    assert.ok(b.ok, b.message);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), kept, 'the committed include is untouched');
    assert.ok(!fs.existsSync(path.join(root, 'assets/sfx.vt2')), 'nothing is written without the tools');
  } finally {
    await cfg.update('arkos.toolsPath', undefined, vscode.ConfigurationTarget.Workspace);
    rmrf(root);
  }
});

test('sfx: Insert Asset Use writes the include and SfxInit once, and a SfxPlay at the cursor each time', async () => {
  const root = sfxProject('sfxuse');
  const code = vscode.Uri.file(path.join(root, 'src/main.bas'));
  fs.writeFileSync(code.fsPath, "' code\n");
  const uri = vscode.Uri.file(path.join(root, 'assets/sfx.cpcsfx'));
  await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(code));
  const text = (await vscode.commands.executeCommand('cpcbuild.insertAssetUse', uri)) as string;
  assert.ok(text.includes('#include "../assets/sfx.bas"'), text);
  assert.ok(text.includes('SfxInit(@sfx)'));
  assert.ok(text.includes('SfxPlay(SFX_BLIP, 2, 0)'));
  assert.ok(text.includes('only advance while a song plays'));
  const ed = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === code.toString());
  assert.ok(ed?.document.getText().includes('SfxInit(@sfx)'));
  const end = ed!.document.lineAt(ed!.document.lineCount - 1).range.end;
  ed!.selection = new vscode.Selection(end, end);
  const again = (await vscode.commands.executeCommand('cpcbuild.insertAssetUse', uri)) as string;
  assert.strictEqual(again, 'SfxPlay(SFX_BLIP, 2, 0)');
  const all = ed!.document.getText();
  assert.strictEqual(all.split('#include "../assets/sfx.bas"').length, 2, all);
  assert.strictEqual(all.split('SfxInit(@sfx)').length, 2, all);
  assert.strictEqual(all.split('SfxPlay(SFX_BLIP, 2, 0)').length, 3, all);
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await closeClean();
  rmrf(root);
});

test('sfx: Play in emulator converts the bank with a silent song and runs the preview', async () => {
  if (!TOOLS) return console.log('       (skipped: no Arkos tools)');
  const a = await api();
  const root = sfxProject('sfxplay');
  const uri = vscode.Uri.file(path.join(root, 'assets/sfx.cpcsfx'));
  const { doc } = await openSfx(uri);
  const p = a.sfx as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  assert.deepStrictEqual(await p.request(doc, 'playInEmulator', { effect: 1 }), { ok: true });
  const prog = fs.readFileSync(path.join(root, 'build/.preview/preview.bas'), 'utf8');
  assert.match(prog, /SfxPlay\(2, 0, 0\)/);
  assert.match(prog, /MusicInit\(@cpcb_quiet, 0\)/);
  assert.match(prog, /SfxInit\(@sfx\)/);
  assert.ok(fs.existsSync(path.join(root, 'build/.preview/sfx.vt2')));
  const dsk = path.join(root, 'build/.preview/preview.dsk');
  await waitFor('the custom "emulator" ran', () => fs.existsSync(`${dsk}.ran`), 15000);
  await vscode.commands.executeCommand('cpcbuild.music.stop');
  await closeClean();
  rmrf(root);
});
