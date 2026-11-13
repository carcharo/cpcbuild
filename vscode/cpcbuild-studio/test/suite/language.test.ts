import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { mkdirp, test, waitFor } from './harness';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  if (!ext) throw new Error('extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const FIXTURES = path.resolve(__dirname, '..', '..', '..', 'src', 'core', 'fixtures', 'convert');

const compilerDiagnostics = (uri: vscode.Uri): vscode.Diagnostic[] => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'cpcbas');
const put = (root: string, rel: string, text: string): string => {
  const f = path.join(root, ...rel.split('/'));
  mkdirp(path.dirname(f));
  fs.writeFileSync(f, text);
  return f;
};
/** Copies a fixture project (its files carry a .txt suffix) into a new folder under the test workspace. */
function copyFixture(name: string, to: string): void {
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(FIXTURES, name, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else put(to, r.replace(/\.txt$/, '').split(path.sep).join('/'), fs.readFileSync(path.join(FIXTURES, name, r), 'utf8'));
    }
  };
  walk('');
}

test('language: a .bas file is CPC BASIC (the cpcbasic language is Studio\'s)', async () => {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(put(ws, 'lang/plain.bas', "PRINT \"hi\"\n")));
  assert.strictEqual(doc.languageId, 'cpcbasic');
  const langs = await vscode.languages.getLanguages();
  assert.ok(langs.includes('cpcbasic'));
});

test('compiler diagnostics: an error shows at its line and column, and goes when it is fixed', async () => {
  const a = await api();
  const dir = path.join(ws, 'lang-errors');
  put(dir, 'cpcbuild.json', JSON.stringify({ version: 1, name: 'e', targets: [{ id: 'a', arch: 'cpc', main: 'main.bas', package: 'dsk', disc: 'E' }] }));
  const file = put(dir, 'main.bas', 'DIM a AS UBYTE\na = 1\nb = (\nPRINT a\n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  const ds = await waitFor('the compiler diagnostic', () => {
    const d = compilerDiagnostics(doc.uri);
    return d.length ? d : undefined;
  });
  const d = ds[0];
  assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Error);
  assert.match(String(d.code), /^E\d+$/);
  assert.strictEqual(d.range.start.line, 2);
  assert.ok(d.range.start.character >= 3, `column ${d.range.start.character}`);
  assert.ok(a.diagRuns(doc.uri) > 0);
  // fix it in the editor (no save): the check runs on the buffer
  const ed = vscode.window.activeTextEditor!;
  await ed.edit((b) => b.replace(new vscode.Range(2, 0, 2, 5), 'b = 2'));
  await waitFor('the diagnostic to go', () => compilerDiagnostics(doc.uri).length === 0);
});

test('compiler diagnostics: the include graph and the defines are the target\'s; an error in an included file shows on that file', async () => {
  const dir = path.join(ws, 'lang-graph');
  put(dir, 'cpcbuild.json', JSON.stringify({ version: 1, name: 'g', targets: [{ id: 'a', arch: 'cpc', main: 'src/main.bas', defines: ['WITH_EXTRA'], package: 'dsk', disc: 'G' }] }));
  const main = put(dir, 'src/main.bas', '#ifdef WITH_EXTRA\n#include "extra.bas"\n#endif\nPRINT Twice(2)\n');
  const extra = put(dir, 'src/extra.bas', 'FUNCTION Twice(n AS UBYTE) AS UBYTE\n  RETURN n *\nEND FUNCTION\n');
  const mainDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(main));
  await vscode.window.showTextDocument(mainDoc);
  // only main.bas is open; the error is in extra.bas, found through the include the target's define switches on
  const ds = await waitFor('a diagnostic on extra.bas', () => {
    const d = compilerDiagnostics(vscode.Uri.file(extra));
    return d.length ? d : undefined;
  });
  assert.strictEqual(ds[0].range.start.line, 1);
  // fix extra.bas on disk: the file watcher is not needed, saving the buffer is: open it, fix, save
  const extraDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(extra));
  const ed = await vscode.window.showTextDocument(extraDoc);
  await ed.edit((b) => b.replace(new vscode.Range(1, 0, 1, 12), '  RETURN n * 2'));
  await extraDoc.save();
  const left = (): string => [vscode.Uri.file(extra), mainDoc.uri].flatMap((u) => compilerDiagnostics(u).map((d) => `${path.basename(u.fsPath)}:${d.range.start.line + 1} ${d.code} ${d.message}`)).join('; ');
  await waitFor(`no diagnostic left (now: ${left()})`, () => left() === '');
  // take the define away: Twice is not declared any more, and the error is on main.bas
  // (edited and saved in the editor, which is how a person does it: a save of cpcbuild.json re-checks the project)
  const pj = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(dir, 'cpcbuild.json')));
  const we = new vscode.WorkspaceEdit();
  we.replace(pj.uri, new vscode.Range(0, 0, pj.lineCount, 0), JSON.stringify({ version: 1, name: 'g', targets: [{ id: 'a', arch: 'cpc', main: 'src/main.bas', package: 'dsk', disc: 'G' }] }));
  await vscode.workspace.applyEdit(we);
  await pj.save();
  const nd = await waitFor('the undeclared name', () => {
    const d = compilerDiagnostics(mainDoc.uri);
    return d.length ? d : undefined;
  });
  assert.strictEqual(nd[0].range.start.line, 3);
  assert.match(nd[0].message, /Twice/);
  // extra.bas is open and no target's program includes it now: it is checked alone, for syntax, so no "never called" noise
  assert.deepStrictEqual(compilerDiagnostics(vscode.Uri.file(extra)), []);
});

test('compiler diagnostics: the -D and -I of cpcbuild.compiler.args count, as they do in the build', async () => {
  const dir = path.join(ws, 'lang-args');
  put(dir, 'cpcbuild.json', JSON.stringify({ version: 1, name: 'args', targets: [{ id: 'a', arch: 'cpc', main: 'main.bas', package: 'dsk', disc: 'ARGS' }] }));
  const main = put(dir, 'main.bas', '#ifdef FROM_ARGS\n#include <twice.bas>\n#endif\nPRINT Twice(2)\n');
  put(dir, 'shared/twice.bas', 'FUNCTION Twice(n AS UBYTE) AS UBYTE\n  RETURN n * 2\nEND FUNCTION\n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(main));
  await vscode.window.showTextDocument(doc);
  // without the flags, Twice is not declared
  await waitFor('the undeclared name', () => compilerDiagnostics(doc.uri).some((d) => /Twice/.test(d.message)));
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  await cfg.update('compiler.args', ['-D', 'FROM_ARGS', '-I', 'shared'], vscode.ConfigurationTarget.Workspace);
  try {
    const left = (): string => compilerDiagnostics(doc.uri).map((d) => `${d.range.start.line + 1} ${d.code} ${d.message}`).join('; ');
    await waitFor(`no diagnostic with the build's flags (now: ${left()})`, () => left() === '');
  } finally {
    await cfg.update('compiler.args', undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test('Convert Project: a 0.1.2 template project becomes one that builds; nothing is written before the yes', async () => {
  const a = await api();
  const dir = path.join(ws, 'convert-fw');
  copyFixture('template-012-firmware', dir);
  const main = path.join(dir, 'src', 'main.bas');
  const before = fs.readFileSync(main, 'utf8');
  const seen: string[] = [];
  const saved = { ...a.convertUi };
  a.convertUi.askBoriel = async (guess) => {
    seen.push(`askBoriel(${guess})`);
    return 'boriel';
  };
  a.convertUi.showReport = async (text) => void seen.push(`report: ${/Files that will change \(\d+\)|No file changes\./.exec(text)?.[0]}`);
  a.convertUi.confirmWrite = async (n) => {
    seen.push(`confirmWrite(${n})`);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'assets', 'ball.bas'), 'utf8').includes('$FF'), true, 'nothing written before the yes');
    return true;
  };
  try {
    const r = await a.convertProject(undefined, { root: dir });
    assert.deepStrictEqual(seen, ['askBoriel(true)', 'report: Files that will change (1)', 'confirmWrite(1)']);
    assert.ok(r && r.written.includes('assets/ball.bas') && r.mustFix === 0, JSON.stringify(r));
    assert.strictEqual(fs.readFileSync(main, 'utf8'), before, 'the program needed no rewrite');
    assert.ok(!fs.readFileSync(path.join(dir, 'assets', 'ball.bas'), 'utf8').includes('$FF'));
    // the editor's check of the converted project: no error
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(main));
    await vscode.window.showTextDocument(doc);
    await waitFor('the compiler check of the project', () => a.diagRuns(doc.uri) > 0);
    assert.deepStrictEqual(compilerDiagnostics(doc.uri).map((d) => d.message), []);
    // a second Convert: the sources read as CPC BASIC, so the question's first choice is No, and nothing changes
    seen.length = 0;
    a.convertUi.askBoriel = async (guess) => {
      seen.push(`askBoriel(${guess})`);
      return 'auto';
    };
    const again = await a.convertProject(undefined, { root: dir });
    assert.deepStrictEqual(seen, ['askBoriel(false)', 'report: No file changes.']);
    assert.deepStrictEqual(again?.written, []);
    assert.strictEqual(again?.dialect, 'cpcbas');
  } finally {
    Object.assign(a.convertUi, saved);
  }
});

test('Convert Project: the Spectrum targets go on a yes and cpcbuild.json is otherwise as it was; a no keeps them', async () => {
  const a = await api();
  const make = (name: string): string => {
    const dir = path.join(ws, name);
    copyFixture('template-012-firmware', dir);
    const p = JSON.parse(fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8'));
    p.targets.push({ id: 'zx48', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX48'], org: 32768, package: 'tap' });
    fs.writeFileSync(path.join(dir, 'cpcbuild.json'), JSON.stringify(p, null, 2) + '\n');
    return dir;
  };
  const yes = make('convert-zx-yes');
  const was = JSON.parse(fs.readFileSync(path.join(yes, 'cpcbuild.json'), 'utf8'));
  const r = await a.convertProject(undefined, { root: yes, from: 'boriel', write: true, removeSpectrum: true });
  assert.deepStrictEqual(r?.removedTargets, ['zx48']);
  const now = JSON.parse(fs.readFileSync(path.join(yes, 'cpcbuild.json'), 'utf8'));
  assert.deepStrictEqual(now.targets, was.targets.slice(0, 2));
  assert.deepStrictEqual({ ...now, targets: 0 }, { ...was, targets: 0 });
  const no = make('convert-zx-no');
  const kept = fs.readFileSync(path.join(no, 'cpcbuild.json'), 'utf8');
  const r2 = await a.convertProject(undefined, { root: no, from: 'boriel', write: true, removeSpectrum: false });
  assert.deepStrictEqual(r2?.removedTargets, []);
  assert.strictEqual(fs.readFileSync(path.join(no, 'cpcbuild.json'), 'utf8'), kept);
  // declining the write leaves every file alone
  const nope = make('convert-no-write');
  const ball = fs.readFileSync(path.join(nope, 'assets', 'ball.bas'), 'utf8');
  const r3 = await a.convertProject(undefined, { root: nope, from: 'boriel', write: false });
  assert.strictEqual(r3, undefined);
  assert.strictEqual(fs.readFileSync(path.join(nope, 'assets', 'ball.bas'), 'utf8'), ball);
});

test('Convert Project: the command is registered', async () => {
  assert.ok((await vscode.commands.getCommands(true)).includes('cpcbuild.convertProject'));
});
