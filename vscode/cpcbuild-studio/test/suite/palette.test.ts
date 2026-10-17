import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import type { PaletteState } from '../../src/core/paletteDoc';
import type { StudioDocument } from '../../src/ext/customEditor';
import { encodePng, newImage, setPixel } from '../../src/core/image';
import { test, waitFor } from './harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const VIEW_TYPE = 'cpcbuild.paletteEditor';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

function put(rel: string, text: string): vscode.Uri {
  const f = path.join(ws, 'palettes', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return vscode.Uri.file(f);
}

/** Opens a file in the palette editor and waits until its webview said ready. */
async function openPalette(uri: vscode.Uri): Promise<{ a: StudioApi; doc: StudioDocument<PaletteState> }> {
  const a = await api();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  const doc = await waitFor('palette document', () => a.palette.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, 'the active tab is the palette editor');
  return { a, doc };
}

async function closeClean(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
}

test('palette: a .cpcpal opens in the custom editor, the webview reports ready, no webview error', async () => {
  const uri = put('hero.cpcpal', '# firmware colours for pens 0-3 (img2cpc, mode 1)\n0, 26, 6, 18\n');
  const { doc } = await openPalette(uri);
  assert.deepStrictEqual(doc.state.entries, [0, 26, 6, 18]);
  assert.deepStrictEqual(doc.webviewErrors, []);
  // let the first render run and be sure nothing was reported
  await waitFor('the first render', () => doc.renderedCount > 0);
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
});

test('palette: edit, undo, redo, save (.cpcpal)', async () => {
  const original = '# my palette\n0, 26, 6, 18\n';
  const uri = put('edit.cpcpal', original);
  const { a, doc } = await openPalette(uri);
  const v0 = doc.version;
  a.palette.commit(doc, { op: 'setEntry', index: 1, value: 13 });
  assert.deepStrictEqual(doc.state.entries, [0, 13, 6, 18]);
  assert.ok(doc.version > v0);
  assert.strictEqual(doc.undoDepth, 1);
  a.palette.commit(doc, { op: 'addEntry', value: 9 });
  assert.deepStrictEqual(doc.state.entries, [0, 13, 6, 18, 9]);
  assert.ok(a.palette.undoLast(doc));
  assert.deepStrictEqual(doc.state.entries, [0, 13, 6, 18]);
  assert.ok(a.palette.redoLast(doc));
  assert.deepStrictEqual(doc.state.entries, [0, 13, 6, 18, 9]);
  assert.ok(a.palette.undoLast(doc));
  // the real save path: the workbench command on the active custom editor
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('file written', () => fs.readFileSync(uri.fsPath, 'utf8') !== original);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), '# my palette\n0, 13, 6, 18\n');
  // undo back to the loaded entries still serialises as the loaded text only for the loaded entries; here the file changed
  await closeClean();
});

test('palette: saving an untouched palette leaves the file byte for byte', async () => {
  const text = '# keep   me\r\n0 ,26,   6\r\n18 # tail\r\n';
  const uri = put('exact.cpcpal', text);
  const { a, doc } = await openPalette(uri);
  await a.palette.saveCustomDocument(doc);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text);
  await closeClean();
});

test('palette: .cpcpal12 edit, undo, save', async () => {
  const uri = put('plus.cpcpal12', '# plus\nF00, 0F0, 00F\n');
  const { a, doc } = await openPalette(uri);
  assert.strictEqual(doc.state.kind, 'rgb12');
  assert.deepStrictEqual(doc.state.entries, [0xf00, 0x0f0, 0x00f]);
  a.palette.commit(doc, { op: 'setEntry', index: 1, value: 0x123 });
  a.palette.commit(doc, { op: 'setEntry', index: 3, value: 0xabc });
  assert.deepStrictEqual(doc.state.entries, [0xf00, 0x123, 0x00f, 0xabc]);
  a.palette.undoLast(doc);
  assert.deepStrictEqual(doc.state.entries, [0xf00, 0x123, 0x00f]);
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('file written', () => fs.readFileSync(uri.fsPath, 'utf8').includes('123'));
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), '# plus\nF00, 123, 00F\n');
  await closeClean();
});

test('palette: a bad entry opens, shows the tool message, refuses to save and keeps the file', async () => {
  const text = '0, 31, 5\n';
  const uri = put('bad.cpcpal', text);
  const { a, doc } = await openPalette(uri);
  assert.strictEqual(doc.state.errors[0].message, 'palette colour 31 is not a firmware colour (0-26)');
  await assert.rejects(a.palette.saveCustomDocument(doc), /palette colour 31 is not a firmware colour \(0-26\)/);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text);
  a.palette.commit(doc, { op: 'setEntry', index: 1, value: 3 });
  await a.palette.saveCustomDocument(doc);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), '0, 3, 5\n');
  await closeClean();
});

test('palette: a stale edit from a webview is rejected', async () => {
  const uri = put('stale.cpcpal', '0, 1\n');
  const { a, doc } = await openPalette(uri);
  const p = a.palette as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  await assert.rejects(p.request(doc, 'edit', { baseVersion: doc.version + 5, op: { op: 'addEntry' } }), /changed in another view/);
  const r = (await p.request(doc, 'edit', { baseVersion: doc.version, op: { op: 'addEntry', value: 4 } })) as { version: number };
  assert.strictEqual(r.version, doc.version);
  assert.deepStrictEqual(doc.state.entries, [0, 1, 4]);
  await vscode.commands.executeCommand('workbench.action.files.save');
  await closeClean();
});

test('palette: backup writes the document text', async () => {
  const uri = put('backup.cpcpal', '0, 1\n');
  const { a, doc } = await openPalette(uri);
  a.palette.commit(doc, { op: 'addEntry', value: 2 });
  const dest = vscode.Uri.file(path.join(ws, 'palettes', 'backup.bak'));
  const b = await a.palette.backupCustomDocument(doc, { destination: dest });
  assert.strictEqual(fs.readFileSync(dest.fsPath, 'utf8'), '0, 1, 2\n');
  b.delete();
  a.palette.undoLast(doc);
  await closeClean();
});

test('palette: Load from PNG takes the colours in order of first appearance', async () => {
  const img = newImage(4, 2); // two rows: upng's encoder/decoder pair fails on a one-row image
  setPixel(img, 0, 0, 255, 255, 255);
  setPixel(img, 1, 0, 0, 0, 0);
  setPixel(img, 2, 0, 250, 250, 250); // nearest is bright white again
  setPixel(img, 3, 0, 255, 0, 0);
  const png = path.join(ws, 'palettes', 'src.png');
  fs.writeFileSync(png, encodePng(img));
  const uri = put('png.cpcpal', '5\n');
  const { a, doc } = await openPalette(uri);
  a.palette.pngOverride = vscode.Uri.file(png);
  const p = a.palette as unknown as { request(d: unknown, name: string, args: unknown): Promise<{ loaded: boolean; total: number; used: number }> };
  const r = await p.request(doc, 'loadPng', { baseVersion: doc.version, limit: 2 });
  a.palette.pngOverride = undefined;
  assert.deepStrictEqual([r.loaded, r.total, r.used], [true, 3, 2]);
  assert.deepStrictEqual(doc.state.entries, [26, 0]);
  a.palette.undoLast(doc);
  assert.deepStrictEqual(doc.state.entries, [5]);
  await closeClean();
});

test('palette: New Palette creates and opens a file; Reopen as Text opens the text editor', async () => {
  const a = await api();
  const uri = vscode.Uri.file(path.join(ws, 'palettes', 'fresh.cpcpal'));
  fs.rmSync(uri.fsPath, { force: true });
  const made = await vscode.commands.executeCommand('cpcbuild.newPalette', { uri });
  assert.ok(made, 'newPalette is no longer a stub');
  assert.ok(!('comingSoon' in (made as object)));
  assert.ok(fs.readFileSync(uri.fsPath, 'utf8').includes('0, 26, 6, 18'));
  const doc = await waitFor('new palette document', () => a.palette.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  await vscode.commands.executeCommand('cpcbuild.openAsText', uri);
  const input = await waitFor('text editor tab', () => {
    const i = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    return i instanceof vscode.TabInputText && i.uri.toString() === uri.toString() ? i : undefined;
  });
  assert.ok(input);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('palette: the editor is contributed as the default for both extensions', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
  const ce = pkg.contributes.customEditors.find((c: { viewType: string }) => c.viewType === VIEW_TYPE);
  assert.strictEqual(ce.priority, 'default');
  assert.deepStrictEqual(ce.selector.map((s: { filenamePattern: string }) => s.filenamePattern).sort(), ['*.cpcpal', '*.cpcpal12']);
});
