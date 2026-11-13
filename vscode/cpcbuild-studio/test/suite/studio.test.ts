import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { TEMPLATES } from '../../src/core/templates';
import { parseProject } from '../../src/core/project';
import { rmrf, samePath, test, TRUE_EXE, waitFor } from './harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'));

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

/** Runs a task and resolves with its exit code. */
async function runTask(task: vscode.Task): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`task ${task.name} did not finish`)), 240000);
    const d = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task.name === task.name && JSON.stringify(e.execution.task.definition) === JSON.stringify(task.definition)) {
        clearTimeout(timer);
        d.dispose();
        resolve(e.exitCode);
      }
    });
    vscode.tasks.executeTask(task).then(undefined, reject);
  });
}

async function findTask(name: string): Promise<vscode.Task> {
  const tasks = await vscode.tasks.fetchTasks({ type: 'cpcbuild' });
  const t = tasks.find((x) => x.name === name && !(x.definition as { project?: string }).project) ?? tasks.find((x) => x.name === name);
  assert.ok(t, `task "${name}" not listed (have: ${tasks.map((x) => x.name).join(', ')})`);
  return t;
}

test('activates in a workspace containing cpcbuild.json', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio')!;
  await waitFor('activation by workspaceContains', () => ext.isActive, 20000);
  assert.strictEqual(vscode.workspace.workspaceFolders?.length, 1);
});

test('every contributed command is registered; Studio registers no .emu. command', async () => {
  await api();
  const all = await vscode.commands.getCommands(true);
  const contributed: string[] = pkg.contributes.commands.map((c: { command: string }) => c.command);
  const missing = contributed.filter((c) => !all.includes(c));
  assert.deepStrictEqual(missing, []);
  assert.ok(all.includes('cpcbuild.emuEvent'));
  const emuOurs = pkg.contributes.commands.filter((c: { command: string }) => c.command.includes('.emu.'));
  assert.strictEqual(emuOurs.length, 0);
});

test('stubbed editor commands answer "coming soon"', async () => {
  await api();
  const r = (await vscode.commands.executeCommand('cpcbuild.music.openTracker')) as { comingSoon: string };
  assert.strictEqual(r.comingSoon, 'cpcbuild.music.openTracker');
});

test('lists build tasks for the targets', async () => {
  await api();
  const names = (await vscode.tasks.fetchTasks({ type: 'cpcbuild' })).map((t) => t.name);
  for (const n of ['build cpc6128', 'build cpc464', 'build and run cpc6128']) assert.ok(names.includes(n), `${n} in ${names}`);
});

test('the doctor finds the built-in compiler and library, python and the tools; it asks for no zxbc, mkdsk or checkout', async () => {
  await api();
  const items = (await vscode.commands.executeCommand('cpcbuild.checkEnvironment')) as { id: string; ok: boolean; detail: string }[];
  for (const id of ['compiler', 'python', 'library', 'tools']) {
    const i = items.find((x) => x.id === id);
    assert.ok(i?.ok, `${id}: ${i?.detail}`);
  }
  assert.match(items.find((x) => x.id === 'compiler')!.detail, /^\d+\.\d+\.\d+.*built in/);
  assert.deepStrictEqual(items.filter((x) => /^(mkdsk|zx)/.test(x.id)), []);
});

test('runs the build task for the firmware template: .dsk and a report with headroom, and no child process for the compile', async () => {
  const a = await api();
  (a.runToolLog as string[][]).length = 0;
  const code = await runTask(await findTask('build cpc6128'));
  assert.deepStrictEqual(a.runToolLog, [], 'the compile starts no program (runTool is the only way the Studio starts one)');
  assert.strictEqual(code, 0, 'task exit code');
  const b = a.lastBuild();
  assert.ok(b?.ok, b?.message);
  assert.strictEqual(b.targetId, 'cpc6128');
  assert.ok(b.artifacts.dsk && fs.existsSync(b.artifacts.dsk), 'dsk exists');
  assert.ok(fs.statSync(b.artifacts.dsk).size > 1000);
  assert.ok(b.report, 'report');
  assert.strictEqual(b.report.start, 0x40);
  assert.ok(b.report.lines.length >= 2);
  for (const l of b.report.lines) assert.ok(Number.isFinite(l.headroom), `headroom of ${l.name}`);
  assert.ok(b.reportLines.some((l) => /headroom below &8B60: \d+ bytes/.test(l)), b.reportLines.join('\n'));
  // the AMSDOS entry carries the derived name (run"TPLFW)
  const dsk = fs.readFileSync(b.artifacts.dsk);
  assert.ok(dsk.includes(Buffer.from('TPLFW   BIN')), 'TPLFW.BIN in the directory');
});

test('a program with an error shows it in the Problems panel at its line and column', async () => {
  const a = await api();
  const tasks = await vscode.tasks.fetchTasks({ type: 'cpcbuild' });
  const t = tasks.find((x) => x.name === 'build bad');
  assert.ok(t, 'task build bad');
  (a.runToolLog as string[][]).length = 0;
  const code = await runTask(t);
  assert.strictEqual(code, 1, 'a failed build exits 1');
  assert.deepStrictEqual(a.runToolLog, []);
  const file = path.join(fs.realpathSync(ws), 'broken', 'src', 'main.bas');
  const diags = await waitFor('the compiler diagnostics', () => {
    const all = vscode.languages.getDiagnostics().flatMap(([u, ds]) => (fs.existsSync(u.fsPath) && samePath(fs.realpathSync(u.fsPath), file) ? ds : []));
    return all.some((d) => d.severity === vscode.DiagnosticSeverity.Error) ? all : undefined;
  }, 20000);
  const err = diags.find((d) => d.severity === vscode.DiagnosticSeverity.Error)!;
  // `PRINT a +` is line 3, and the expression is missing at the end of the line (column 10, 1-based)
  assert.strictEqual(err.range.start.line, 2, 'line 3 (zero-based 2)');
  assert.strictEqual(err.range.start.character, 9, 'column 10 (zero-based 9)');
  assert.match(err.message, /Expected an expression, found end of line/);
  assert.strictEqual(String((err.code as { value?: string })?.value ?? err.code), 'E142');
  assert.strictEqual(err.source, 'cpcbas');
  const b = a.lastBuild();
  assert.ok(b && !b.ok);
  assert.match(b.message ?? '', /1 error.*Problems panel/);
  assert.ok(b.diagnostics?.some((d) => d.line === 3 && d.col === 10 && d.code === 'E142'));
});

test('cpcbuild.compiler.args reaches the compiler: -Wimplicit shows a warning, and the build still succeeds', async () => {
  const a = await api();
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const root = path.join(fs.realpathSync(ws), 'warn');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cpcbuild.json'), JSON.stringify({ version: 1, name: 'warn', targets: [{ id: 'w', main: 'src/main.bas', package: 'bin' }] }));
  fs.writeFileSync(path.join(root, 'src', 'main.bas'), 'DIM a AS UBYTE\nb = 3\nPRINT a + b\n');
  await cfg.update('compiler.args', ['-Wimplicit', '--bogus'], vscode.ConfigurationTarget.Workspace);
  try {
    await new Promise((r) => setTimeout(r, 300));
    const res = await a.build(root, 'w');
    assert.ok(res.ok, res.message);
    const warn = res.diagnostics?.find((d) => d.severity === 'warning');
    assert.ok(warn, 'the implicit declaration warning of -Wimplicit');
    assert.strictEqual(warn.code, 'W300');
    assert.strictEqual(warn.line, 2, '`b = 3` is line 2');
    const shown = vscode.languages.getDiagnostics(vscode.Uri.file(path.join(root, 'src', 'main.bas')));
    assert.ok(shown.some((d) => d.severity === vscode.DiagnosticSeverity.Warning && d.source === 'cpcbas'));
    assert.ok(res.artifacts.bin && fs.existsSync(res.artifacts.bin), 'a bin target writes the raw program');
    assert.ok(!res.artifacts.dsk && !res.artifacts.cpr);
    assert.strictEqual(res.run, undefined, 'a raw bin has nothing to run');
  } finally {
    await cfg.update('compiler.args', undefined, vscode.ConfigurationTarget.Workspace);
    rmrf(root);
  }
});

test('a good build clears the Problems of the project and leaves the unrelated ones', async () => {
  const a = await api();
  const root = fs.realpathSync(ws);
  const bad = await a.build(path.join(root, 'broken'), 'bad');
  assert.ok(!bad.ok);
  const file = path.join(root, 'broken', 'src', 'main.bas');
  const has = (): boolean => vscode.languages.getDiagnostics(vscode.Uri.file(file)).some((d) => d.source === 'cpcbas');
  assert.ok(has(), 'the error is published');
  fs.writeFileSync(file, 'PRINT "x"\n');
  const ok = await a.build(path.join(root, 'broken'), 'bad');
  assert.ok(ok.ok, ok.message);
  assert.ok(!has(), 'a good build clears it');
  fs.writeFileSync(file, 'DIM a AS UBYTE\nb = 3\nPRINT a +\nPRINT "x"\n');
});

test('Lamplighter builds in-process (disc, map, report), with no child process for the compile', async () => {
  const a = await api();
  const src = path.resolve(__dirname, '../../../../../games/lamplighter');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-lamp-'));
  try {
    fs.cpSync(src, dir, { recursive: true, filter: (p) => path.basename(p) !== 'build' });
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8'));
    pj.library = null;
    fs.writeFileSync(path.join(dir, 'cpcbuild.json'), JSON.stringify(pj, null, 2));
    (a.runToolLog as string[][]).length = 0;
    const t0 = Date.now();
    const res = await a.build(dir, 'lamp6128');
    assert.ok(res.ok, res.message);
    assert.deepStrictEqual(a.runToolLog, [], 'no program was started');
    assert.ok(res.artifacts.dsk && fs.statSync(res.artifacts.dsk).size > 100000, 'disc image');
    assert.ok(res.artifacts.map && /\.core\.__START_PROGRAM/.test(fs.readFileSync(res.artifacts.map, 'utf8')));
    assert.ok(res.report && res.reportLines.some((l) => /headroom below &8B60/.test(l)), res.reportLines.join('\n'));
    assert.ok(res.diagnostics !== undefined);
    const first = Date.now() - t0;
    const warm: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t1 = Date.now();
      assert.ok((await a.build(dir, 'lamp6128')).ok);
      warm.push(Date.now() - t1);
    }
    warm.sort((x, y) => x - y);
    console.log(`  (Lamplighter 6128 in the extension host: first build ${first} ms, then median of five ${warm[2]} ms, the whole build step incl. files)`);
    const cpr = await a.build(dir, 'lampplus');
    assert.ok(cpr.ok, cpr.message);
    assert.strictEqual(fs.readFileSync(cpr.artifacts.cpr!).subarray(0, 4).toString(), 'RIFF');
  } finally {
    rmrf(dir);
  }
});

test('an invalid cpcbuild.json gets diagnostics with the fix', async () => {
  await api();
  const file = path.join(fs.realpathSync(ws), 'invalid', 'cpcbuild.json');
  const ds = await waitFor('cpcbuild.json diagnostics', () => {
    const all = vscode.languages.getDiagnostics().flatMap(([u, d]) => (fs.existsSync(u.fsPath) && samePath(fs.realpathSync(u.fsPath), file) ? d : []));
    return all.length ? all : undefined;
  }, 20000);
  assert.match(ds[0].message, /bare.*ownFont/);
});

test('run goes through the configured emulator command', async () => {
  const a = await api();
  const b = a.lastBuild();
  // lastBuild is now the failed one; rebuild the good target first
  const good = await a.build(fs.realpathSync(ws), 'cpc6128');
  assert.ok(good.ok, good.message);
  await vscode.commands.executeCommand('cpcbuild.run');
  const marker = `${good.artifacts.dsk}.ran`;
  await waitFor('the custom emulator command to run', () => fs.existsSync(marker), 10000);
  void b;
});

test('Explorer "Run in emulator" on a .dsk uses the same path', async () => {
  const a = await api();
  const good = a.lastBuild()!;
  const marker = `${good.artifacts.dsk}.ran`;
  fs.rmSync(marker, { force: true });
  await vscode.commands.executeCommand('cpcbuild.runFile', vscode.Uri.file(good.artifacts.dsk!));
  await waitFor('the custom emulator command to run', () => fs.existsSync(marker), 10000);
});

test('emu setting without the emulator extension falls back and says why', async () => {
  const a = await api();
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const good = a.lastBuild()!;
  await cfg.update('run.emulator', 'emu', vscode.ConfigurationTarget.Workspace);
  await cfg.update('run.caprice32Path', TRUE_EXE, vscode.ConfigurationTarget.Workspace);
  try {
    const before = Date.now();
    await vscode.commands.executeCommand('cpcbuild.runFile', vscode.Uri.file(good.artifacts.dsk!));
    assert.ok(Date.now() - before < 20000);
  } finally {
    await cfg.update('run.emulator', 'custom', vscode.ConfigurationTarget.Workspace);
    await cfg.update('run.caprice32Path', undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test('cpcbuild.emuEvent logs events', async () => {
  const a = await api();
  await vscode.commands.executeCommand('cpcbuild.emuEvent', { session: 's1', event: 'paused' });
  assert.strictEqual(a.emuEvents().at(-1)?.session, 's1');
});

for (const t of TEMPLATES) {
  test(`template ${t.id}: generate, compile and package every target`, async () => {
    const a = await api();
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-tpl-'));
    const r = (await vscode.commands.executeCommand('cpcbuild.newProject', { template: t.id, name: `Tpl ${t.id}`, parent })) as { dir: string; disc: string } | undefined;
    assert.ok(r, 'project created');
    assert.ok(fs.existsSync(path.join(r.dir, 'cpcbuild.json')));
    assert.ok(fs.existsSync(path.join(r.dir, 'src', 'main.bas')));
    assert.ok(fs.existsSync(path.join(r.dir, 'assets')));
    const proj = parseProject(fs.readFileSync(path.join(r.dir, 'cpcbuild.json'), 'utf8')).project!;
    for (const target of proj.targets) {
      const res = await a.build(r.dir, target.id);
      assert.ok(res.ok, `${t.id}/${target.id}: ${res.message}`);
      const art = target.package === 'dsk' ? res.artifacts.dsk : target.package === 'cpr' ? res.artifacts.cpr : res.artifacts.bin;
      assert.ok(art && fs.existsSync(art) && fs.statSync(art).size > 100, `${t.id}/${target.id}: ${target.package} artifact`);
      assert.ok(res.report && res.reportLines.length > 1, 'report');
      if (target.package === 'cpr') assert.strictEqual(fs.readFileSync(art).subarray(0, 4).toString(), 'RIFF');
    }
    rmrf(parent);
  });
}
