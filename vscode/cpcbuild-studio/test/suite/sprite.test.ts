import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import type { StudioDocument } from '../../src/ext/customEditor';
import type { SpriteEditorProvider } from '../../src/ext/spriteEditor';
import { encodePng, newImage, setPixel } from '../../src/core/image';
import { newSprite, serialiseSprite, type SpriteState } from '../../src/core/spriteDoc';
import { exportAsset } from '../../src/core/spriteExport';
import { test, waitFor } from './harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

function put(rel: string, text: string | Uint8Array): vscode.Uri {
  const f = path.join(ws, 'sprites', rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return vscode.Uri.file(f);
}
const read = (rel: string): string => fs.readFileSync(path.join(ws, 'sprites', rel), 'utf8');

async function open(uri: vscode.Uri, viewType: string, pick: (a: StudioApi) => SpriteEditorProvider): Promise<{ a: StudioApi; p: SpriteEditorProvider; doc: StudioDocument<SpriteState> }> {
  const a = await api();
  const p = pick(a);
  await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
  const doc = await waitFor('document', () => p.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom && input.viewType === viewType, 'the active tab is the editor');
  return { a, p, doc };
}
const openSpr = (uri: vscode.Uri) => open(uri, 'cpcbuild.spriteEditor', (a) => a.sprite);
const openTil = (uri: vscode.Uri) => open(uri, 'cpcbuild.tileEditor', (a) => a.tile);
const closeClean = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
const viewOf = (p: SpriteEditorProvider, doc: StudioDocument<SpriteState>) => (p as unknown as { currentView(d: unknown): { pens?: number[]; colours?: string[]; items: string[][]; outputState: string; paletteProblem?: string; exportProblem?: string; analysis: { duplicates: number[][] } } }).currentView(doc);

function sprite(name: string, o: Parameters<typeof newSprite>[1] = {}): SpriteState {
  return newSprite('spr', { name, mode: 1, w: 8, h: 4, masked: false, ...o });
}

test('sprite: a .cpcspr opens in the editor, webview ready, no webview error', async () => {
  const uri = put('hero.cpcspr', serialiseSprite(sprite('hero')));
  const { doc } = await openSpr(uri);
  assert.strictEqual(doc.state.name, 'hero');
  await new Promise((r) => setTimeout(r, 600));
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
});

test('sprite: edit, undo, redo, save writes the document and (generate on save) the .bas', async () => {
  const s = sprite('edit');
  const uri = put('edit.cpcspr', serialiseSprite(s));
  fs.rmSync(path.join(ws, 'sprites', 'edit.bas'), { force: true });
  const { p, doc } = await openSpr(uri);
  p.commit(doc, { op: 'paint', item: 0, pixels: [[0, 0, 1], [1, 0, 2]] });
  p.commit(doc, { op: 'addItem' });
  assert.strictEqual(doc.state.items.length, 2);
  assert.ok(p.undoLast(doc));
  assert.strictEqual(doc.state.items.length, 1);
  assert.ok(p.redoLast(doc));
  assert.ok(p.undoLast(doc));
  assert.strictEqual(doc.undoDepth, 1);
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('bas written', () => fs.existsSync(path.join(ws, 'sprites', 'edit.bas')));
  assert.ok(read('edit.cpcspr').includes('"12000000"'));
  const expected = exportAsset(doc.state, { source: 'edit.cpcspr' }).text;
  assert.strictEqual(read('edit.bas'), expected);
  assert.ok(read('edit.bas').includes('DIM edit('));
  await waitFor('generated report', () => viewOf(p, doc).outputState === 'current');
  await closeClean();
});

test('sprite: Generate Asset File command, with the output in a subfolder', async () => {
  const s = sprite('gen', { masked: true });
  s.output = 'out/gen.bas';
  s.items[0][1][1] = 3;
  const uri = put('gen.cpcspr', serialiseSprite(s));
  fs.rmSync(path.join(ws, 'sprites', 'out'), { recursive: true, force: true });
  const { doc } = await openSpr(uri);
  const r = (await vscode.commands.executeCommand('cpcbuild.generateAssetFile', uri)) as { ok: boolean; message: string };
  assert.ok(r.ok, r.message);
  assert.ok(read('out/gen.bas').includes('gen_SIZE'));
  assert.strictEqual(doc.webviewErrors.length, 0);
  // a file that is not open is generated from disk
  await closeClean();
  fs.rmSync(path.join(ws, 'sprites', 'out'), { recursive: true, force: true });
  const r2 = (await vscode.commands.executeCommand('cpcbuild.generateAssetFile', uri)) as { ok: boolean };
  assert.ok(r2.ok);
  assert.ok(fs.existsSync(path.join(ws, 'sprites', 'out', 'gen.bas')));
});

test('sprite: a refused export (frame too wide for the array) names the limit; the document still saves', async () => {
  const s = newSprite('spr', { name: 'huge', mode: 0, w: 256, h: 255, masked: true, frames: 2 });
  const uri = put('huge.cpcspr', serialiseSprite(s));
  const { a, p, doc } = await openSpr(uri);
  const r = (await vscode.commands.executeCommand('cpcbuild.generateAssetFile', uri)) as { ok: boolean; message: string };
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /huge would have 130560 bytes \(the limit is 65535\)/);
  assert.match(viewOf(p, doc).exportProblem ?? '', /limit is 65535/);
  await a.sprite.saveCustomDocument(doc); // no throw
  await closeClean();
});

test('sprite: shared palette file is read, watched and updates live; bad file is reported', async () => {
  put('shared.cpcpal', '0, 26, 6, 18\n');
  const s = sprite('pal', { palette: { file: 'shared.cpcpal' } });
  const uri = put('pal.cpcspr', serialiseSprite(s));
  const { p, doc } = await openSpr(uri);
  await waitFor('palette loaded', () => viewOf(p, doc).pens?.join() === '0,26,6,18');
  put('shared.cpcpal', '0, 24, 6, 18\n');
  await waitFor('live update', () => viewOf(p, doc).pens?.join() === '0,24,6,18', 20000);
  put('shared.cpcpal', '0, 99\n');
  await waitFor('problem shown', () => /not a firmware colour/.test(viewOf(p, doc).paletteProblem ?? ''), 20000);
  put('shared.cpcpal', '0, 26\n');
  await waitFor('fixed', () => viewOf(p, doc).pens?.join() === '0,26', 20000);
  await closeClean();
});

test('sprite: choosing a shared palette turns Emit palette off when another document already uses it; inline again copies the pens', async () => {
  put('team.cpcpal', '0, 26, 6, 18\n');
  put('first.cpcspr', serialiseSprite(sprite('first', { palette: { file: 'team.cpcpal' } })));
  const uri = put('second.cpcspr', serialiseSprite(sprite('second')));
  const { p, doc } = await openSpr(uri);
  const req = p as unknown as { request(d: unknown, n: string, a: unknown): Promise<{ used?: boolean; message?: string }> };
  const r = await req.request(doc, 'setPaletteFile', { baseVersion: doc.version, file: 'team.cpcpal' });
  assert.ok(r.used);
  assert.match(r.message ?? '', /1 other document uses team\.cpcpal/);
  assert.deepStrictEqual([doc.state.palette, doc.state.emitPalette], [{ file: 'team.cpcpal' }, false]);
  await waitFor('loaded', () => viewOf(p, doc).pens);
  await req.request(doc, 'inlinePalette', { baseVersion: doc.version });
  assert.deepStrictEqual(doc.state.palette, { pens: [0, 26, 6, 18] });
  await assert.rejects(req.request(doc, 'setPaletteFile', { baseVersion: doc.version, file: 'nope.cpcpal' }), /could not be read/);
  assert.ok(p.undoLast(doc));
  await closeClean();
});

test('tile: a .cpctil opens in the tile editor, edits, duplicate detection, 257th tile refused', async () => {
  const t = newSprite('til', { name: 'bg', mode: 1, frames: 3 });
  const uri = put('bg.cpctil', serialiseSprite(t));
  const { p, doc } = await openTil(uri);
  p.commit(doc, { op: 'paint', item: 1, pixels: [[0, 0, 2]] });
  assert.deepStrictEqual(viewOf(p, doc).analysis.duplicates, [[2, 0]]);
  p.commit(doc, { op: 'setDedupe', value: true });
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('tile output', () => fs.existsSync(path.join(ws, 'sprites', 'bg.bas')));
  assert.ok(read('bg.bas').includes('bg_MAPW'));
  doc.state = { ...doc.state, items: Array.from({ length: 256 }, () => doc.state.items[0]) };
  assert.throws(() => p.commit(doc, { op: 'addItem' }), /257 tiles; tile numbers go up to 255/);
  await waitFor('no webview error', () => doc.webviewErrors.length === 0);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('plus: opens, exports bin with a .pal beside it', async () => {
  const s = newSprite('spr', { name: 'ball', kind: 'plus' });
  s.plusFormat = 'bin';
  s.output = 'ball.bin';
  s.items[0][2][2] = 3;
  const uri = put('ball.cpcspr', serialiseSprite(s));
  const { doc } = await openSpr(uri);
  const r = (await vscode.commands.executeCommand('cpcbuild.generateAssetFile', uri)) as { ok: boolean; written: string[] };
  assert.ok(r.ok);
  const bin = fs.readFileSync(path.join(ws, 'sprites', 'ball.bin'));
  assert.strictEqual(bin.length, 256);
  assert.strictEqual(bin[2 * 16 + 2], 3);
  assert.strictEqual(fs.readFileSync(path.join(ws, 'sprites', 'ball.pal')).length, 30);
  assert.strictEqual(doc.webviewErrors.length, 0);
  await closeClean();
});

test('sprite: take a PNG into a frame (quantised with the palette) and export the sheet as PNG', async () => {
  const img = newImage(8, 4);
  for (let x = 0; x < 8; x++) { setPixel(img, x, 0, 255, 255, 255); setPixel(img, x, 1, 255, 0, 0); setPixel(img, x, 2, 0, 0, 0); setPixel(img, x, 3, 0, 0, 0); }
  const png = put('in.png', encodePng(img));
  const uri = put('png.cpcspr', serialiseSprite(sprite('png', { palette: { pens: [0, 26, 6, 18] } })));
  const { p, doc } = await openSpr(uri);
  p.pngOverride = png;
  const req = p as unknown as { request(d: unknown, n: string, a: unknown): Promise<{ taken?: boolean; saved?: boolean; message?: string }> };
  const r = await req.request(doc, 'importPng', { baseVersion: doc.version, item: 0 });
  p.pngOverride = undefined;
  assert.ok(r.taken);
  assert.deepStrictEqual(doc.state.items[0][0], [1, 1, 1, 1, 1, 1, 1, 1]); // bright white = pen 1
  assert.deepStrictEqual(doc.state.items[0][1], [2, 2, 2, 2, 2, 2, 2, 2]); // red = nearest of the pens: bright red, pen 2
  assert.ok(p.undoLast(doc));
  p.savePngOverride = vscode.Uri.file(path.join(ws, 'sprites', 'sheet.png'));
  const e = await req.request(doc, 'exportPng', {});
  assert.ok(e.saved);
  assert.ok(fs.statSync(path.join(ws, 'sprites', 'sheet.png')).size > 20);
  await closeClean();
});

test('sprite: stale edit rejected, undo grey-out counters, backup holds the text', async () => {
  const uri = put('misc.cpcspr', serialiseSprite(sprite('misc')));
  const { p, doc } = await openSpr(uri);
  const req = p as unknown as { request(d: unknown, n: string, a: unknown): Promise<unknown> };
  await assert.rejects(req.request(doc, 'edit', { baseVersion: doc.version + 3, op: { op: 'addItem' } }), /changed in another view/);
  await assert.rejects(req.request(doc, 'edit', { baseVersion: doc.version, op: { op: 'paint', item: 0, pixels: [[0, 0, 9]] } }), /pen 9 is not available/);
  const dest = vscode.Uri.file(path.join(ws, 'sprites', 'misc.bak'));
  p.commit(doc, { op: 'addItem' });
  const b = await p.backupCustomDocument(doc, { destination: dest });
  assert.ok(fs.readFileSync(dest.fsPath, 'utf8').split('"frames"')[1].split('],').length >= 2);
  void b.delete();
  p.undoLast(doc);
  await closeClean();
});

test('sprite: a broken file shows the fatal state and is not rewritten', async () => {
  const text = '{"format":"cpcspr","mode":1,"frame":{"w":4,"h":2},"frames":[["0123"]]}';
  const uri = put('broken.cpcspr', text);
  const a = await api();
  await vscode.commands.executeCommand('vscode.openWith', uri, 'cpcbuild.spriteEditor');
  const doc = await waitFor('document', () => a.sprite.documents.get(uri.toString()));
  await waitFor('ready', () => doc.readyCount > 0);
  assert.match(doc.fatal ?? '', /frame 0 has 1 rows, expected 2/);
  await assert.rejects(a.sprite.saveCustomDocument(doc), /frame 0 has 1 rows/);
  assert.strictEqual(read('broken.cpcspr'), text);
  await closeClean();
});

test('sprite: New Sprite, New Tileset, New Plus Sprite create files and open them; stubs are gone', async () => {
  const a = await api();
  for (const [cmd, file, key, viewType, check] of [
    ['cpcbuild.newSprite', 'n1.cpcspr', 'sprite', 'cpcbuild.spriteEditor', (s: SpriteState) => s.kind === 'cpc' && s.mode === 0],
    ['cpcbuild.newTileset', 'n2.cpctil', 'tile', 'cpcbuild.tileEditor', (s: SpriteState) => s.type === 'til' && s.mode === 2],
    ['cpcbuild.newPlusSprite', 'n3.cpcspr', 'sprite', 'cpcbuild.spriteEditor', (s: SpriteState) => s.kind === 'plus'],
  ] as const) {
    const uri = vscode.Uri.file(path.join(ws, 'sprites', file));
    fs.rmSync(uri.fsPath, { force: true });
    const r = await vscode.commands.executeCommand(cmd, { uri, mode: cmd === 'cpcbuild.newSprite' ? 0 : 2 });
    assert.ok(r && !('comingSoon' in (r as object)), `${cmd} is no longer a stub`);
    const prov = key === 'sprite' ? a.sprite : a.tile;
    const doc = await waitFor('new document', () => prov.documents.get(uri.toString()));
    await waitFor('ready', () => doc.readyCount > 0);
    assert.ok(check(doc.state), `${cmd} state`);
    assert.strictEqual(doc.webviewErrors.length, 0);
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom && input.viewType === viewType);
    await closeClean();
  }
});

test('sprite: Insert Asset Use writes the include and call lines into the code editor', async () => {
  const s = sprite('hero2', { masked: true });
  s.output = 'hero2.bas';
  const uri = put('hero2.cpcspr', serialiseSprite(s));
  const code = put('main.bas', "' code\n");
  const doc = await vscode.workspace.openTextDocument(code);
  await openSpr(uri);
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Two, preserveFocus: true });
  const text = (await vscode.commands.executeCommand('cpcbuild.insertAssetUse', uri)) as string;
  assert.ok(text.includes('#include "hero2.bas"'));
  assert.ok(text.includes('PutSpriteMasked(x, y, hero2_W, hero2_H, @hero2(frame * hero2_SIZE))'));
  const shown = vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === code.toString());
  assert.ok(shown?.document.getText().includes('#include "hero2.bas"'));
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('sprite: the editors are contributed as the default for .cpcspr and .cpctil, with title actions', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
  const by = (vt: string) => pkg.contributes.customEditors.find((c: { viewType: string }) => c.viewType === vt);
  assert.strictEqual(by('cpcbuild.spriteEditor').priority, 'default');
  assert.deepStrictEqual(by('cpcbuild.spriteEditor').selector, [{ filenamePattern: '*.cpcspr' }]);
  assert.deepStrictEqual(by('cpcbuild.tileEditor').selector, [{ filenamePattern: '*.cpctil' }]);
  const cmds = pkg.contributes.menus['editor/title'].map((m: { command: string }) => m.command);
  assert.ok(cmds.includes('cpcbuild.generateAssetFile') && cmds.includes('cpcbuild.insertAssetUse'));
});
