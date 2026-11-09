import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { newSong, serialiseSong } from '../../src/core/songDoc';
import { mkdirp, rmrf, test } from './harness';

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
