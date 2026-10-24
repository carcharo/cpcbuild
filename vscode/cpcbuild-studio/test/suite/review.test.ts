/** Code-review fixes: Workspace Trust, path containment, Revert then stale Undo, event cap, map watcher, toggle(null). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { argvToRecipe, serialiseRecipe } from '../../src/core/cpcimp';
import { test, TRUE_EXE, waitFor } from './harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const REPO = path.resolve(__dirname, '../../../../..');

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const closeClean = (): Thenable<unknown> => vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');

// ------------------------------------------------------------------ Revert, then a stale Undo / Redo

test('revert: an Undo or Redo closure from before the Revert does nothing', async () => {
  const a = await api();
  const f = path.join(ws, 'palettes', 'revert.cpcpal');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '0, 26, 6, 18\n');
  const uri = vscode.Uri.file(f);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'cpcbuild.paletteEditor');
  const doc = await waitFor('palette document', () => a.palette.documents.get(uri.toString()));
  await waitFor('first render', () => doc.renderedCount > 0);

  let ev: vscode.CustomDocumentEditEvent<typeof doc> | undefined;
  const sub = a.palette.onDidChangeCustomDocument((e) => (ev = e));
  a.palette.commit(doc, { op: 'setEntry', index: 1, value: 13 });
  sub.dispose();
  assert.ok(ev, 'the edit event carries the closures VS Code keeps');
  assert.deepStrictEqual(doc.state.entries, [0, 13, 6, 18]);

  await a.palette.revertCustomDocument(doc);
  assert.deepStrictEqual(doc.state.entries, [0, 26, 6, 18]);
  const v = doc.version;
  await ev!.undo();
  await ev!.redo();
  assert.deepStrictEqual(doc.state.entries, [0, 26, 6, 18], 'the stale closures did not touch the reverted document');
  assert.strictEqual(doc.version, v);

  // the same through the workbench: edit, Revert File, Undo
  a.palette.commit(doc, { op: 'setEntry', index: 2, value: 9 });
  await vscode.commands.executeCommand('workbench.action.files.revert');
  await waitFor('reverted state', () => doc.state.entries[2] === 6);
  await vscode.commands.executeCommand('undo');
  await vscode.commands.executeCommand('redo');
  assert.deepStrictEqual(doc.state.entries, [0, 26, 6, 18]);
  await closeClean();
});

// ------------------------------------------------------------------ Workspace Trust

test('trust: in Restricted Mode Build, Regenerate, Convert, Open in Tiled and the importer refuse with one clear text', async () => {
  const a = await api();
  a.trust.reset();
  a.trust.set(false);
  try {
    const b = await a.build(fs.realpathSync(ws), 'cpc6128');
    assert.strictEqual(b.ok, false);
    assert.match(b.message ?? '', /Build is disabled in Restricted Mode/);
    assert.deepStrictEqual(b.artifacts, {}, 'no compiler ran');

    assert.strictEqual(await vscode.commands.executeCommand('cpcbuild.regenerateAssets'), undefined);

    const tmx = path.join(ws, 'maps', 'trust.tmx');
    fs.mkdirSync(path.dirname(tmx), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'examples/assets/level.tmx'), tmx);
    const conv = (await vscode.commands.executeCommand('cpcbuild.tmx.generate', { uri: tmx, quiet: true })) as { ok: boolean; error?: string };
    assert.strictEqual(conv.ok, false);
    assert.match(conv.error ?? '', /Restricted Mode/);
    assert.ok(!fs.existsSync(path.join(ws, 'maps', 'trust.bas')), 'nothing was written');
    const tiled = (await vscode.commands.executeCommand('cpcbuild.openInTiled', { uri: tmx, quiet: true, tiledPath: TRUE_EXE })) as { ok: boolean; error?: string };
    assert.strictEqual(tiled.ok, false);
    assert.match(tiled.error ?? '', /Open in Tiled is disabled in Restricted Mode/);

    const music = (await vscode.commands.executeCommand('cpcbuild.music.convert', { uri: path.join(ws, 'x.aks'), quiet: true })) as { ok: boolean; error?: string };
    assert.strictEqual(music.ok, false);
    assert.match(music.error ?? '', /Restricted Mode/);

    const out = await a.runIn(ws, { file: path.join(ws, 'build', 'none.dsk'), kind: 'dsk', name: 'NONE', model: '6128' }, { line() {} }, { ...(await import('../../src/ext/config')).readSettings(ws), emulator: 'custom', customCommand: '/usr/bin/touch ${dsk}.ran' });
    assert.strictEqual(out.ok, false);
    assert.match(out.message ?? '', /Restricted Mode/);
    assert.ok(!fs.existsSync(path.join(ws, 'build', 'none.dsk.ran')));

    assert.ok(a.trust.blocked() >= 5, `refusals counted: ${a.trust.blocked()}`);
  } finally {
    a.trust.set(undefined);
  }
  // back to trusted: the same build works
  const ok = await a.build(fs.realpathSync(ws), 'cpc6128');
  assert.ok(ok.ok, ok.message);
});

test('trust: the importer does not generate in Restricted Mode, and an editor still opens', async () => {
  const a = await api();
  fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tests/conformance/assets/spr1.png'), path.join(ws, 'assets', 'spr1.png'));
  const rec = argvToRecipe(['--mode', '1', '--name', 'trusty', 'assets/spr1.png', '-o', 'assets/trusty.bas']).recipe;
  const f = path.join(ws, 'assets', 'trusty.cpcimp');
  fs.writeFileSync(f, serialiseRecipe(rec));
  fs.rmSync(path.join(ws, 'assets', 'trusty.bas'), { force: true });
  const uri = vscode.Uri.file(f);
  a.trust.set(false);
  try {
    await vscode.commands.executeCommand('vscode.openWith', uri, 'cpcbuild.importer');
    const doc = await waitFor('importer document', () => a.importer.documents.get(uri.toString()));
    await waitFor('first render', () => doc.renderedCount > 0);
    assert.deepStrictEqual(doc.webviewErrors, []);
    const out = await a.importer.run(doc);
    assert.strictEqual(out.ok, false);
    assert.match(out.error ?? '', /Restricted Mode/);
    a.importer.commit(doc, { op: 'set', patch: { masked: false } });
    await a.importer.saveCustomDocument(doc); // generate-on-save is skipped
    assert.ok(!fs.existsSync(path.join(ws, 'assets', 'trusty.bas')));
    await closeClean();
  } finally {
    a.trust.set(undefined);
  }
});

// ------------------------------------------------------------------ path containment

test('containment: a recipe naming ../ or an absolute output is a recipe problem and writes nothing', async () => {
  const a = await api();
  fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tests/conformance/assets/spr1.png'), path.join(ws, 'assets', 'spr1.png'));
  const f = path.join(ws, 'assets', 'escape.cpcimp');
  fs.writeFileSync(f, serialiseRecipe(argvToRecipe(['--mode', '1', '--name', 'esc', 'assets/spr1.png', '-o', 'assets/esc.bas']).recipe));
  const uri = vscode.Uri.file(f);
  await vscode.commands.executeCommand('vscode.openWith', uri, 'cpcbuild.importer');
  const doc = await waitFor('importer document', () => a.importer.documents.get(uri.toString()));
  await waitFor('first render', () => doc.renderedCount > 0);
  const victim = path.join(path.dirname(ws), `escaped-${path.basename(ws)}.bas`);
  for (const output of [`../escaped-${path.basename(ws)}.bas`, victim]) {
    a.importer.commit(doc, { op: 'set', patch: { output } });
    const out = await a.importer.run(doc);
    assert.strictEqual(out.ok, false, output);
    assert.match(out.error ?? '', /outside the project folder|absolute path/);
    assert.ok(!fs.existsSync(victim), 'nothing escaped');
  }
  a.importer.commit(doc, { op: 'set', patch: { output: 'assets/esc.bas', source: '../../etc/hosts' } });
  const out = await a.importer.run(doc);
  assert.strictEqual(out.ok, false);
  assert.match(out.error ?? '', /outside the project folder/);
  await closeClean();
});

test('importer: the remembered generation outcome goes when its document closes', async () => {
  const a = await api();
  fs.mkdirSync(path.join(ws, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'tests/conformance/assets/spr1.png'), path.join(ws, 'assets', 'spr1.png'));
  const f = path.join(ws, 'assets', 'prune.cpcimp');
  fs.writeFileSync(f, serialiseRecipe(argvToRecipe(['--mode', '1', '--name', 'prune', 'assets/spr1.png', '-o', 'assets/prune.bas']).recipe));
  const uri = vscode.Uri.file(f);
  const before = a.importer.generatedCount;
  await vscode.commands.executeCommand('vscode.openWith', uri, 'cpcbuild.importer');
  const doc = await waitFor('importer document', () => a.importer.documents.get(uri.toString()));
  await waitFor('first render', () => doc.renderedCount > 0);
  const out = await a.importer.run(doc);
  assert.ok(out.ok, out.error);
  assert.strictEqual(a.importer.generatedCount, before + 1);
  await closeClean();
  await waitFor('the entry to be pruned', () => a.importer.generatedCount === before);
});

test('not in a project: Import Image does not write a recipe beside a stray image', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-noproj-'));
  try {
    const img = path.join(dir, 'stray.png');
    fs.copyFileSync(path.join(REPO, 'tests/conformance/assets/spr1.png'), img);
    const r = await vscode.commands.executeCommand('cpcbuild.importImage', { uri: vscode.Uri.file(img), open: false });
    assert.strictEqual(r, undefined);
    assert.deepStrictEqual(fs.readdirSync(dir), ['stray.png']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ the rest

test('emu events: only the last 100 are kept', async () => {
  const a = await api();
  for (let i = 0; i < 130; i++) await vscode.commands.executeCommand('cpcbuild.emuEvent', { session: `cap-${i}`, event: 'resumed' });
  const evs = a.emuEvents();
  assert.ok(evs.length <= 100, `kept ${evs.length}`);
  assert.strictEqual((evs[evs.length - 1] as { session: string }).session, 'cap-129');
});

test('symbols: only the active target\'s map file is watched', async () => {
  const a = await api();
  const map = path.join(ws, 'build', 'cpc6128.map');
  if (!fs.existsSync(map)) assert.ok((await a.build(fs.realpathSync(ws), 'cpc6128')).ok);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'src', 'main.bas')));
  await vscode.window.showTextDocument(doc);
  await a.debug.reloadSymbols();
  const w = a.debug.watchedMap();
  assert.ok(w && fs.realpathSync(path.dirname(w)) === fs.realpathSync(path.join(ws, 'build')) && path.basename(w) === 'cpc6128.map', String(w));
});

test('debug: toggling a breakpoint with a null argument does not throw', async () => {
  // null falls through to the input box; dismiss it so the test never waits on the UI
  let settled = false;
  const p = Promise.resolve(vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', null)).finally(() => (settled = true));
  const t0 = Date.now();
  while (!settled && Date.now() - t0 < 8000) {
    await vscode.commands.executeCommand('workbench.action.closeQuickOpen');
    await new Promise((r) => setTimeout(r, 150));
  }
  assert.ok(settled, 'the command finished');
  const r = (await p) as { applied: boolean };
  assert.strictEqual(r.applied, false);
});

test('run: a disc with several programs asks which one (quick pick stubbed), and cancelling runs nothing', async () => {
  const a = await api();
  const { mkDsk } = await import('../../src/core/dskFixture');
  const { readSettings } = await import('../../src/ext/config');
  const dsk = path.join(ws, 'many-' + Date.now() + '.dsk');
  fs.writeFileSync(dsk, mkDsk({ base: 0xc1, dirTrack: 0, files: ['GAME.BIN', 'MENU.BAS'] }));
  const s = readSettings(ws);
  const asked: string[][] = [];
  try {
    a.disc.pick = async (cs) => (asked.push(cs), 'MENU.BAS');
    const got = await a.disc.discToRun(dsk, s);
    assert.deepStrictEqual(asked, [['GAME.BIN', 'MENU.BAS']]);
    assert.strictEqual(got?.name, 'MENU.BAS');
    a.disc.pick = async () => undefined;
    assert.strictEqual(await a.disc.discToRun(dsk, s), undefined);
  } finally {
    a.disc.pick = undefined;
    fs.rmSync(dsk, { force: true });
  }
});
