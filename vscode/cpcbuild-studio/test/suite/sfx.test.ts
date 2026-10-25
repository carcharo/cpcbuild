import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { SfxDoc, parseSfx, serialiseSfx } from '../../src/core/sfxDoc';
import { newBank, presetEffect } from '../../src/core/sfxPresets';
import type { StudioDocument } from '../../src/ext/customEditor';
import { mkdirp, rmrf, test, waitFor } from './harness';

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

test('sfx: a bad op is refused with its message, a stale edit from a webview is rejected, Play in emulator waits for the build step', async () => {
  const uri = put('bad.cpcsfx', serialiseSfx(bank()));
  const { a, doc } = await openSfx(uri);
  assert.throws(() => a.sfx.commit(doc, { op: 'rename', effect: 1, name: 'BLIP' }), /already used by effect 1/);
  const p = a.sfx as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  await assert.rejects(p.request(doc, 'edit', { baseVersion: doc.version + 5, op: { op: 'addBlank' } }), /changed in another view/);
  const r = (await p.request(doc, 'edit', { baseVersion: doc.version, op: { op: 'addBlank' } })) as { version: number };
  assert.strictEqual(r.version, doc.version);
  assert.strictEqual(doc.state.effects.length, 3);
  await assert.rejects(p.request(doc, 'playInEmulator', { effect: 0 }), /after the build step/);
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
    assert.strictEqual(uri.fsPath, path.join(root, 'assets', name));
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
