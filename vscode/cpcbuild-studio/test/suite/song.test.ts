import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { SongDoc, newSong, parseSong, serialiseSong } from '../../src/core/songDoc';
import { demoSong } from '../../src/core/songDemo';
import type { StudioDocument } from '../../src/ext/customEditor';
import { mkdirp, rmrf, samePath, test, waitFor } from './harness';

const REPO = path.resolve(__dirname, '../../../../..');
const TOOLS = [process.env.AT3_TOOLS, path.join(REPO, 'tools/arkos/work/bin'), path.resolve(REPO, '../../tools/arkos/work/bin')].find(
  (d) => d && fs.existsSync(path.join(d, 'SongToAkg')) && fs.existsSync(path.join(d, 'SongToSoundEffects')),
);
const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const MAIN_BAS = `#include <cpc.bas>
#include <cpcbuild.bas>
#include <music/music.bas>
#include "../assets/tune.bas"
MusicInit(@tune, 1)
`;

function songProject(name: string): string {
  const root = path.join(ws, name);
  rmrf(root);
  mkdirp(path.join(root, 'assets'));
  mkdirp(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'cpcbuild.json'), JSON.stringify({ version: 1, name, targets: [{ id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', package: 'dsk' }], assets: ['assets/**/*.cpcsong'] }, null, 2));
  fs.writeFileSync(path.join(root, 'src/main.bas'), MAIN_BAS);
  const d = newSong();
  d.patterns[0].channels[0] = [{ row: 0, note: 60, inst: '1' }, { row: 8, note: 'off' }];
  d.patterns[0].channels[1] = [{ row: 0, note: 48, inst: '5' }];
  fs.writeFileSync(path.join(root, 'assets/tune.cpcsong'), serialiseSong(d));
  return root;
}

test('song: Regenerate Assets writes tune.vt2 and tune.bas, and a build with them compiles', async () => {
  if (!TOOLS) return console.log('       (skipped: no Arkos tools)');
  const a = await api();
  const root = songProject('songbuild');
  const res = (await vscode.commands.executeCommand('cpcbuild.regenerateAssets', { root })) as { recipe: string; ok: boolean; error?: string; written: string[] }[];
  const mine = res.filter((r) => r.recipe === 'assets/tune.cpcsong');
  assert.deepStrictEqual(mine.map((r) => r.error ?? 'ok'), ['ok']);
  assert.ok(fs.readFileSync(path.join(root, 'assets/tune.vt2'), 'utf8').includes('[Module]'));
  assert.ok(fs.readFileSync(path.join(root, 'assets/tune.bas'), 'utf8').includes('pass @tune to MusicInit'));
  // the pre-build pass: remove the output, build, and it is back (stale = missing)
  fs.rmSync(path.join(root, 'assets/tune.bas'));
  const b = await a.build(fs.realpathSync(root), 'cpc6128');
  assert.ok(b.ok, b.message);
  assert.ok(fs.existsSync(path.join(root, 'assets/tune.bas')), 'regenerated before the build');
  rmrf(root);
});

test('song: a build without the Arkos tools keeps the committed tune.bas and warns instead of failing', async () => {
  const a = await api();
  const root = songProject('songnotools');
  const real = fs.readFileSync(path.join(REPO, 'examples/assets/bounce_music.bas'), 'utf8');
  const label = /pass @(\w+) to MusicInit/.exec(real)?.[1];
  assert.ok(label, 'the committed bounce music include names its label');
  const f = path.join(root, 'assets/tune.bas');
  fs.writeFileSync(f, real);
  fs.writeFileSync(path.join(root, 'src/main.bas'), MAIN_BAS.replace('@tune', `@${label}`));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(f, old, old);
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  await cfg.update('arkos.toolsPath', '/nonexistent/arkos', vscode.ConfigurationTarget.Workspace);
  try {
    const b = await a.build(fs.realpathSync(root), 'cpc6128');
    assert.ok(b.ok, b.message);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), real, 'the committed include is untouched');
    assert.ok(!fs.existsSync(path.join(root, 'assets/tune.vt2')), 'nothing is written without the tools');
  } finally {
    await cfg.update('arkos.toolsPath', undefined, vscode.ConfigurationTarget.Workspace);
    rmrf(root);
  }
});

// ----------------------------------------------------------------------- the tracker editor

const VIEW_TYPE = 'cpcbuild.songEditor';

function putSong(rel: string, text: string): vscode.Uri {
  const f = path.join(ws, 'songs', rel);
  mkdirp(path.dirname(f));
  fs.writeFileSync(f, text);
  return vscode.Uri.file(f);
}

async function openSong(uri: vscode.Uri): Promise<{ a: StudioApi; doc: StudioDocument<SongDoc> }> {
  const a = await api();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  const doc = await waitFor('song document', () => a.song.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, 'the active tab is the music tracker');
  return { a, doc };
}

const closeClean = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

test('song editor: a .cpcsong opens in the tracker, the webview renders it, no webview error', async () => {
  const uri = putSong('open.cpcsong', serialiseSong(demoSong()));
  const { doc } = await openSong(uri);
  assert.strictEqual(doc.state.patterns.length, 1);
  await waitFor('the first render', () => doc.renderedCount > 0);
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
});

test('song editor: a note through the edit path, undo, redo, save and the byte-identical round trip', async () => {
  const text = serialiseSong(demoSong());
  const uri = putSong('edit.cpcsong', text);
  const { a, doc } = await openSong(uri);
  const p = a.song as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  const v0 = doc.version;
  // the same request the webview sends when a note key is typed
  const r = (await p.request(doc, 'edit', { baseVersion: doc.version, op: { op: 'setCell', pattern: 0, channel: 0, row: 1, event: { note: 64, inst: '1' } } })) as { version: number };
  assert.ok(r.version > v0);
  assert.deepStrictEqual(doc.state.patterns[0].channels[0].find((e) => e.row === 1), { row: 1, note: 64, inst: '1' });
  assert.strictEqual(doc.undoDepth, 1);
  assert.ok(a.song.undoLast(doc));
  assert.strictEqual(doc.state.patterns[0].channels[0].find((e) => e.row === 1), undefined);
  assert.ok(a.song.redoLast(doc));
  assert.ok(doc.state.patterns[0].channels[0].some((e) => e.row === 1));
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('file written', () => fs.readFileSync(uri.fsPath, 'utf8') !== text);
  const saved = fs.readFileSync(uri.fsPath, 'utf8');
  const parsed = parseSong(saved);
  assert.ok(parsed.doc, 'the saved file parses');
  assert.strictEqual(serialiseSong(parsed.doc), saved);
  assert.ok(parsed.doc.patterns[0].channels[0].some((e) => e.row === 1 && e.note === 64));
  assert.ok(a.song.undoLast(doc));
  await a.song.saveCustomDocument(doc);
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text, 'undo and save brings the original text back');
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
});

test('song editor: a bad op and a stale edit are refused with their message; the keys choice is remembered per width', async () => {
  const uri = putSong('bad.cpcsong', serialiseSong(demoSong()));
  const { a, doc } = await openSong(uri);
  const p = a.song as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  assert.throws(() => a.song.commit(doc, { op: 'setCell', pattern: 0, channel: 0, row: 99, event: { note: 60, inst: '1' } }), /rows are 0-31/);
  await assert.rejects(p.request(doc, 'edit', { baseVersion: doc.version + 5, op: { op: 'addPattern' } }), /changed in another view/);
  await p.request(doc, 'setKeys', { width: 'narrow', shown: true });
  await p.request(doc, 'setKeys', { width: 'wide', shown: false });
  const view = (a.song as unknown as { currentView(d: unknown): { keys: { wide?: boolean; narrow?: boolean } } }).currentView(doc);
  assert.deepStrictEqual(view.keys, { wide: false, narrow: true });
  await assert.rejects(p.request(doc, 'setKeys', { width: 'huge', shown: true }), /bad keys request/);
  await closeClean();
});

test('song editor: a file that is not a song shows the error and is not overwritten; an empty file opens as a new song', async () => {
  const text = JSON.stringify({ format: 'cpcsong', version: 1, speed: 6, patterns: [], order: [], instruments: [] });
  const uri = putSong('broken.cpcsong', text);
  const { a, doc } = await openSong(uri);
  assert.ok(doc.fatal, 'the document is fatal');
  await assert.rejects(a.song.saveCustomDocument(doc));
  assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), text);
  await closeClean();
  const empty = putSong('empty.cpcsong', '');
  const e = await openSong(empty);
  assert.strictEqual(e.doc.fatal, undefined);
  assert.strictEqual(e.doc.state.patterns.length, 1);
  await closeClean();
});

test('song editor: New Song creates assets/song.cpcsong (then song2, song3) with the demo in the project and opens it', async () => {
  const a = await api();
  const root = path.join(ws, 'songproj');
  rmrf(root);
  mkdirp(root);
  fs.writeFileSync(path.join(root, 'cpcbuild.json'), JSON.stringify({ version: 1, name: 'songproj', targets: [{ id: 'cpc6128', arch: 'cpc', main: 'src/main.bas' }], assets: [] }, null, 2));
  for (const name of ['song.cpcsong', 'song2.cpcsong', 'song3.cpcsong']) {
    const uri = (await vscode.commands.executeCommand('cpcbuild.newSong', { root })) as vscode.Uri | undefined;
    assert.ok(uri, 'the command returns the new file');
    assert.ok(samePath(uri.fsPath, path.join(root, 'assets', name)), uri.fsPath);
    const doc = await waitFor('new document', () => a.song.documents.get(uri.toString()));
    await waitFor('ready', () => doc.readyCount > 0);
    assert.deepStrictEqual(doc.state, demoSong());
    assert.deepStrictEqual(doc.webviewErrors, []);
    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), serialiseSong(demoSong()));
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE);
    await closeClean();
  }
  const project = JSON.parse(fs.readFileSync(path.join(root, 'cpcbuild.json'), 'utf8'));
  assert.deepStrictEqual(project.assets, ['assets/**/*.cpcsong'], 'the project builds songs now');
  rmrf(root);
});

test('song editor: contributed as the default for *.cpcsong, with its command', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));
  const ce = pkg.contributes.customEditors.find((c: { viewType: string }) => c.viewType === VIEW_TYPE);
  assert.strictEqual(ce.priority, 'default');
  assert.strictEqual(ce.displayName, 'CPC Music Tracker');
  assert.deepStrictEqual(ce.selector.map((s: { filenamePattern: string }) => s.filenamePattern), ['*.cpcsong']);
  const cmd = pkg.contributes.commands.find((c: { command: string }) => c.command === 'cpcbuild.newSong');
  assert.deepStrictEqual([cmd.category, cmd.title], ['CPC Game Studio', 'New Song']);
});

test('song instruments: a custom one made from a built-in, edited by one frame, used, saved and built; deleting it while used is refused', async () => {
  const root = songProject('songinst');
  const uri = vscode.Uri.file(path.join(root, 'assets/tune.cpcsong'));
  const { a, doc } = await openSong(uri);
  const p = a.song as unknown as { request(d: unknown, name: string, args: unknown): Promise<unknown> };
  // the same requests the instrument editor sends
  const edit = (op: unknown): Promise<unknown> => p.request(doc, 'edit', { baseVersion: doc.version, op });
  await edit({ op: 'addInstrument', fromId: '1' });
  assert.deepStrictEqual(doc.state.instruments.map((i) => [i.id, i.name]), [['B', 'Piano copy']]);
  const frames = doc.state.instruments[0].frames.map((f) => ({ ...f }));
  frames[0] = { ...frames[0], pitch: 12, volume: 7 };
  await edit({ op: 'updateInstrument', id: 'B', patch: { frames } });
  assert.deepStrictEqual([doc.state.instruments[0].frames[0].pitch, doc.state.instruments[0].frames[0].volume], [12, 7]);
  assert.strictEqual(doc.undoDepth, 2, 'copying and drawing are one undo step each');
  await edit({ op: 'setCell', pattern: 0, channel: 2, row: 4, event: { note: 67, inst: 'B' } });
  await assert.rejects(edit({ op: 'deleteInstrument', id: 'B' }), /instrument B \(Piano copy\) is used at pattern A, channel C, row 4/);
  assert.strictEqual(doc.state.instruments.length, 1, 'the used instrument is still there');
  await assert.rejects(edit({ op: 'updateInstrument', id: '1', patch: { name: 'Mine' } }), /built-in/);
  const before = fs.readFileSync(uri.fsPath, 'utf8');
  await vscode.commands.executeCommand('workbench.action.files.save');
  await waitFor('file written', () => fs.readFileSync(uri.fsPath, 'utf8') !== before);
  const saved = parseSong(fs.readFileSync(uri.fsPath, 'utf8'));
  assert.ok(saved.doc, 'the saved file parses');
  assert.strictEqual(saved.doc.instruments[0].frames[0].pitch, 12);
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeClean();
  if (TOOLS) {
    const res = (await vscode.commands.executeCommand('cpcbuild.regenerateAssets', { root })) as { recipe: string; ok: boolean; error?: string }[];
    assert.deepStrictEqual(res.filter((r) => r.recipe === 'assets/tune.cpcsong').map((r) => r.error ?? 'ok'), ['ok']);
    const vt2 = fs.readFileSync(path.join(root, 'assets/tune.vt2'), 'utf8');
    assert.match(vt2, /\[Ornament\d+\]\r?\n12,0,0/, 'the edited pitch is in the ornament');
    assert.ok(fs.readFileSync(path.join(root, 'assets/tune.bas'), 'utf8').includes('pass @tune to MusicInit'));
  } else console.log('       (build half skipped: no Arkos tools)');
  rmrf(root);
});
