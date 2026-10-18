import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { newSprite, serialiseSprite } from '../../src/core/spriteDoc';
import type { TmxDocument } from '../../src/ext/tmxViewer';
import type { ConvertResult } from '../../src/shared/tmxProtocol';
import { test, waitFor } from './harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const REPO = path.resolve(__dirname, '../../../../..');
const VIEW_TYPE = 'cpcbuild.tmxViewer';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

function copyIn(rel: string, as = rel): string {
  const dst = path.join(ws, as);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), dst);
  return dst;
}
const rm = (...rels: string[]): void => rels.forEach((r) => fs.rmSync(path.join(ws, r), { recursive: true, force: true }));
const read = (rel: string): string => fs.readFileSync(path.join(ws, rel), 'utf8');
const setting = (k: string, v: unknown): Thenable<void> => vscode.workspace.getConfiguration('cpcbuild').update(k, v, vscode.ConfigurationTarget.Workspace);
const closeAll = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.closeAllEditors');

/** The Arkos tools, wherever they are (a worktree has no tools/arkos/work of its own). */
const TOOLS = [process.env.AT3_TOOLS, path.join(REPO, 'tools/arkos/work/bin'), path.resolve(REPO, '../../tools/arkos/work/bin')].find(
  (d) => d && fs.existsSync(path.join(d, 'SongToAkg')) && fs.existsSync(path.join(d, 'SongToSoundEffects')),
);

async function openViewer(uri: vscode.Uri): Promise<{ a: StudioApi; doc: TmxDocument }> {
  const a = await api();
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
  const doc = await waitFor('tmx document', () => a.tmx.documents.get(uri.toString()));
  await waitFor('webview ready', () => doc.readyCount > 0);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  assert.ok(input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE, 'the active tab is the viewer');
  return { a, doc };
}

test('tmx viewer: opens with Open With, loads the map and the tileset image, no webview error', async () => {
  copyIn('examples/assets/level.tmx', 'maps/level.tmx');
  copyIn('examples/assets/bgtiles.png', 'maps/bgtiles.png');
  const { doc } = await openViewer(vscode.Uri.file(path.join(ws, 'maps/level.tmx')));
  await waitFor('the atlas request', () => doc.requestLog.includes('atlases'));
  await waitFor('the first render', () => doc.renderedCount > 0);
  assert.deepStrictEqual(doc.webviewErrors, []);
  assert.strictEqual(doc.fatal, undefined);
  const v = doc.view!;
  assert.deepStrictEqual([v.map.width, v.map.height, v.map.tilewidth], [20, 25, 8]);
  assert.deepStrictEqual(v.layers.map((l) => l.name), ['background']);
  assert.strictEqual(v.tilesets[0].imageStatus, 'ok');
  assert.strictEqual(v.convert.name, 'level');
  assert.strictEqual(v.convert.output, 'maps/level.bas');
  await closeAll();
});

test('tmx viewer: tile colour sources (Tiled image, CPC preview, .cpctil) and a missing image', async () => {
  const a = await api();
  const uri = vscode.Uri.file(path.join(ws, 'maps/level.tmx'));
  const { doc } = await openViewer(uri);
  const img = await a.tmx.request(doc, 'atlases', { source: 'image', mode: 0 }) as { atlases: { count: number; width: number; height: number; firstgid: number }[]; notices: unknown[] };
  assert.deepStrictEqual(img.atlases.map((x) => [x.firstgid, x.count, x.width, x.height]), [[1, 3, 24, 8]]);
  const cpc = await a.tmx.request(doc, 'atlases', { source: 'cpc', mode: 0 }) as typeof img;
  assert.strictEqual(cpc.atlases.length, 1, JSON.stringify(cpc.notices));
  assert.strictEqual(cpc.atlases[0].count, 3);
  // no .cpctil yet: the request falls back to the Tiled image and says so
  const none = await a.tmx.request(doc, 'atlases', { source: 'cpctil', mode: 0 }) as typeof img;
  assert.strictEqual(none.atlases[0].count, 3);
  assert.ok(JSON.stringify(none.notices).includes('No matching .cpctil'));
  await closeAll();
  // a .cpctil with the tileset image's name is found and numbered from the first gid
  fs.writeFileSync(path.join(ws, 'maps/bgtiles.cpctil'), serialiseSprite(newSprite('til', { name: 'bgtiles', frames: 5 })));
  const again = await openViewer(uri);
  assert.deepStrictEqual(again.doc.view!.cpctil, { file: 'maps/bgtiles.cpctil', tiles: 5 });
  const til = await a.tmx.request(again.doc, 'atlases', { source: 'cpctil', mode: 0, firstgid: 4 }) as typeof img;
  assert.deepStrictEqual(til.atlases.map((x) => [x.firstgid, x.count]), [[4, 5]]);
  await closeAll();
  // the image goes missing: numbers, with an info notice (not an error)
  fs.renameSync(path.join(ws, 'maps/bgtiles.png'), path.join(ws, 'maps/bgtiles.png.away'));
  const miss = await openViewer(uri);
  assert.strictEqual(miss.doc.view!.tilesets[0].imageStatus, 'missing');
  assert.ok(miss.doc.view!.notices.some((n) => n.severity === 'info' && /Tileset image not found/.test(n.text)));
  assert.deepStrictEqual((await a.tmx.request(miss.doc, 'atlases', { source: 'image', mode: 0 }) as typeof img).atlases, []);
  await closeAll();
  fs.renameSync(path.join(ws, 'maps/bgtiles.png.away'), path.join(ws, 'maps/bgtiles.png'));
  rm('maps/bgtiles.cpctil');
});

test('tmx viewer: picking a tile copies its number and its DoTile8 call', async () => {
  const a = await api();
  const { doc } = await openViewer(vscode.Uri.file(path.join(ws, 'maps/level.tmx')));
  // what the webview sends when "Copy DoTile8 call" is pressed for cell (2, 1) = gid 3 = tile 2
  await a.tmx.request(doc, 'copy', { text: 'DoTile8(2, 1, 2)' });
  assert.strictEqual(await vscode.env.clipboard.readText(), 'DoTile8(2, 1, 2)');
  await a.tmx.request(doc, 'copy', { text: '2' });
  assert.strictEqual(await vscode.env.clipboard.readText(), '2');
  const l = doc.view!.layers[0];
  assert.strictEqual(l.gids![1 * l.width + 2], 3);
  assert.ok(doc.requestLog.filter((r) => r === 'copy').length >= 2);
  await closeAll();
});

test('tmx viewer: Convert (request and command) writes what tmx2bas.py writes, on both engines', async () => {
  const a = await api();
  const { doc } = await openViewer(vscode.Uri.file(path.join(ws, 'maps/level.tmx')));
  const ref = (extra: string[]): string => {
    const out = path.join(ws, 'maps/ref.bas');
    const r = spawnSync('python3', [path.join(REPO, 'tools/tmx2bas.py'), 'maps/level.tmx', ...extra, '-o', 'maps/ref.bas'], { cwd: ws, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    return fs.readFileSync(out, 'utf8');
  };
  const r1 = (await a.tmx.request(doc, 'convert', { name: 'lvl' })) as ConvertResult;
  assert.ok(r1.ok, r1.error);
  assert.strictEqual(r1.output, 'maps/level.bas');
  assert.strictEqual(read('maps/level.bas'), ref(['--name', 'lvl']).replace('maps/ref.bas', 'maps/level.bas'));
  // the command with explicit arguments and the python engine
  await setting('assets.engine', 'python');
  const r2 = (await vscode.commands.executeCommand('cpcbuild.tmx.generate', { uri: path.join(ws, 'maps/level.tmx'), name: 'lvl', empty: 4, firstgid: 1, output: 'maps/py.bas', quiet: true })) as ConvertResult;
  await setting('assets.engine', undefined);
  assert.ok(r2.ok, r2.error);
  const r3 = (await vscode.commands.executeCommand('cpcbuild.tmx.generate', { uri: path.join(ws, 'maps/level.tmx'), name: 'lvl', empty: 4, firstgid: 1, output: 'maps/ts.bas', quiet: true })) as ConvertResult;
  assert.ok(r3.ok, r3.error);
  assert.strictEqual(read('maps/py.bas').split('\n').slice(1).join('\n'), read('maps/ts.bas').split('\n').slice(1).join('\n'));
  assert.strictEqual(read('maps/ts.bas').split('\n')[0].replace('maps/ts.bas', 'maps/py.bas'), read('maps/py.bas').split('\n')[0]);
  assert.strictEqual(read('maps/ts.bas').split('\n')[0].replace('maps/ts.bas', 'maps/ref.bas'), ref(['--name', 'lvl', '--empty', '4', '--firstgid', '1']).split('\n')[0]);
  // Generate Asset File routes a .tmx here
  const g = (await vscode.commands.executeCommand('cpcbuild.generateAssetFile', vscode.Uri.file(path.join(ws, 'maps/level.tmx')))) as ConvertResult;
  assert.ok(g.ok && g.output === 'maps/level.bas', JSON.stringify(g));
  // the tool's error text for a layer that is not there
  const bad = (await vscode.commands.executeCommand('cpcbuild.tmx.generate', { uri: path.join(ws, 'maps/level.tmx'), layer: 'nope', quiet: true })) as ConvertResult;
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error, "tmx2bas: maps/level.tmx: no tile layer 'nope' (have: background)");
  await closeAll();
  rm('maps/level.bas', 'maps/ref.bas', 'maps/py.bas', 'maps/ts.bas');
});

test('tmx viewer: a map the tool cannot read shows the tool\'s text; a change on disk reloads the view', async () => {
  const a = await api();
  fs.writeFileSync(path.join(ws, 'maps/chunked.tmx'), '<map width="2" height="2" tilewidth="8" tileheight="8" infinite="1"><tileset firstgid="1" tilewidth="8" tileheight="8"/><layer name="L" width="2" height="2"><data encoding="csv"><chunk x="0" y="0" width="2" height="2">1,1,1,1</chunk></data></layer></map>');
  const chunked = await openViewer(vscode.Uri.file(path.join(ws, 'maps/chunked.tmx')));
  assert.strictEqual(chunked.doc.fatal, 'tmx2bas: chunked.tmx: infinite (chunked) maps are not supported');
  await waitFor('the fatal state to render', () => chunked.doc.renderedCount > 0);
  assert.deepStrictEqual(chunked.doc.webviewErrors, []);
  await closeAll();
  fs.writeFileSync(path.join(ws, 'maps/zstd.tmx'), '<map width="1" height="1" tilewidth="8" tileheight="8"><layer name="L" width="1" height="1"><data encoding="base64" compression="zstd">AAAA</data></layer></map>');
  const zstd = await openViewer(vscode.Uri.file(path.join(ws, 'maps/zstd.tmx')));
  assert.match(zstd.doc.fatal ?? '', /unsupported compression 'zstd'/);
  await closeAll();

  const f = path.join(ws, 'maps/level.tmx');
  const { doc } = await openViewer(vscode.Uri.file(f));
  const v0 = doc.version;
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('name="background"', 'name="ground"'));
  await waitFor('reload after the file changed', () => doc.version > v0 && doc.view?.layers[0].name === 'ground', 20000);
  assert.deepStrictEqual(doc.webviewErrors, []);
  await closeAll();
  rm('maps');
  a.tmx.documents.clear();
});

test('Open in Tiled: starts the configured app on the map; says what is wrong when it cannot', async () => {
  copyIn('examples/assets/level.tmx', 'maps/level.tmx');
  const uri = vscode.Uri.file(path.join(ws, 'maps/level.tmx'));
  const ok = (await vscode.commands.executeCommand('cpcbuild.openInTiled', { uri, tiledPath: '/usr/bin/true', quiet: true })) as { ok: boolean; command?: string[] };
  assert.ok(ok.ok);
  assert.deepStrictEqual(ok.command, ['/usr/bin/true', uri.fsPath]);
  const bad = (await vscode.commands.executeCommand('cpcbuild.openInTiled', { uri, tiledPath: '/nonexistent/tiled', quiet: true })) as { ok: boolean; error?: string };
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error ?? '', /could not start Tiled/);
  rm('maps');
});

// ----------------------------------------------------------------------- music

test('music: Convert Music writes the include the repo script writes (Starfall title song)', async () => {
  if (!TOOLS) return console.log('       (skipped: no Arkos tools)');
  copyIn('games/shooter/assets/title.vt2', 'music/title.vt2');
  const r = (await vscode.commands.executeCommand('cpcbuild.music.convert', { uri: path.join(ws, 'music/title.vt2'), name: 'sf_title', toolsPath: TOOLS, quiet: true })) as { ok: boolean; output: string; error?: string; argv: string[] };
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.output, 'music/title.bas');
  assert.deepStrictEqual(r.argv, ['music/title.vt2', 'music/title.bas', '--name', 'sf_title']);
  assert.strictEqual(read('music/title.bas'), fs.readFileSync(path.join(REPO, 'games/shooter/assets/title.bas'), 'utf8'));
  rm('music');
});

test('music: Convert Music says how to get the tools when they are missing', async () => {
  if (process.env.AT3_TOOLS) return console.log('       (skipped: $AT3_TOOLS is set)');
  // a missing setting falls back to <library>/tools/arkos/work/bin, which a checkout has after sh tools/arkos/fetch.sh
  if (fs.existsSync(path.join(REPO, 'tools/arkos/work/bin/SongToAkg'))) return console.log('       (skipped: the library checkout has the Arkos tools)');
  copyIn('games/shooter/assets/title.vt2', 'music/title.vt2');
  const r = (await vscode.commands.executeCommand('cpcbuild.music.convert', { uri: path.join(ws, 'music/title.vt2'), toolsPath: '/nonexistent/arkos', quiet: true })) as { ok: boolean; error?: string };
  assert.strictEqual(r.ok, false);
  assert.match(r.error ?? '', /sh tools\/arkos\/fetch\.sh/);
  rm('music');
});

test('music: Play Music builds the preview program around the real player, packages a .dsk and runs it; Stop ends it', async () => {
  copyIn('games/shooter/assets/title.bas', 'music/title.bas');
  const r = (await vscode.commands.executeCommand('cpcbuild.music.play', { uri: path.join(ws, 'music/title.bas'), quiet: true })) as { ok: boolean; error?: string; dsk?: string; program?: string; used?: string; plan?: { name: string } };
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.used, 'custom');
  assert.strictEqual(r.plan?.name, 'sf_title');
  assert.strictEqual(r.program, 'build/.preview/preview.bas');
  const prog = read('build/.preview/preview.bas');
  assert.match(prog, /#include <music\/music\.bas>/);
  assert.match(prog, /MusicInit\(@sf_title, 0\)/);
  assert.ok(r.dsk && fs.existsSync(r.dsk) && fs.statSync(r.dsk).size > 1000, 'the .dsk exists');
  assert.ok(fs.readFileSync(r.dsk).includes(Buffer.from('PREVIEW BIN')), 'PREVIEW.BIN on the disc');
  await waitFor('the custom "emulator" ran', () => fs.existsSync(`${r.dsk}.ran`), 15000);
  const stop = (await vscode.commands.executeCommand('cpcbuild.music.stop')) as { stopped: boolean; how?: string };
  assert.strictEqual(stop.stopped, true);
  const again = (await vscode.commands.executeCommand('cpcbuild.music.stop')) as { stopped: boolean; how?: string };
  assert.deepStrictEqual(again, { stopped: false, how: 'nothing-to-stop' });
  // a .bas that is not a converted song is refused with the reason
  fs.writeFileSync(path.join(ws, 'music/plain.bas'), 'PRINT 1\n');
  const bad = (await vscode.commands.executeCommand('cpcbuild.music.play', { uri: path.join(ws, 'music/plain.bas'), quiet: true })) as { ok: boolean; error?: string };
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error ?? '', /not a converted song/);
  rm('music', 'build/.preview');
});

test('music: Play Music converts an .vt2 first (subsong choice reaches the program)', async () => {
  if (!TOOLS) return console.log('       (skipped: no Arkos tools)');
  copyIn('games/shooter/assets/title.vt2', 'music/title.vt2');
  const r = (await vscode.commands.executeCommand('cpcbuild.music.play', { uri: path.join(ws, 'music/title.vt2'), name: 'sf_title', subsong: 0, toolsPath: TOOLS, quiet: true })) as { ok: boolean; error?: string; dsk?: string };
  assert.ok(r.ok, r.error);
  assert.strictEqual(read('build/.preview/sf_title.bas'), fs.readFileSync(path.join(REPO, 'games/shooter/assets/title.bas'), 'utf8'));
  assert.ok(r.dsk && fs.existsSync(r.dsk));
  await vscode.commands.executeCommand('cpcbuild.music.stop');
  rm('music', 'build/.preview');
});
