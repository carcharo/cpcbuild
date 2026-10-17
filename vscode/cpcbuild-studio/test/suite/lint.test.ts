import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { test, waitFor } from './harness';

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  if (!ext) throw new Error('extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;

const SOURCE = [
  '#if defined(FOO)', // CB011
  '#endif',
  'Mode 1', // CB001: drawing before ScreenInit()
  'FillRect(0, 0, 4, 4, 1)',
  'PutSprite(0, 0, 0, 8, 0)', // CB009: w = 0
  'SetInk 1, 2',
  '',
].join('\n');

const textOf = (h: vscode.Hover): string =>
  h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : '')).join('\n');

async function openSource(file: string): Promise<vscode.TextDocument> {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, SOURCE);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  await vscode.window.showTextDocument(doc);
  return doc;
}

const ownDiagnostics = (uri: vscode.Uri): vscode.Diagnostic[] => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'cpcbuild');

test('lint: a .bas in a cpcbuild project gets CB diagnostics (warnings/info only)', async () => {
  const doc = await openSource(path.join(ws, 'src', 'lintme.bas'));
  const ds = await waitFor('lint diagnostics', () => {
    const d = ownDiagnostics(doc.uri);
    return d.length >= 3 ? d : undefined;
  });
  const codes = ds.map((d) => String(d.code)).sort();
  assert.deepStrictEqual(codes, ['CB001', 'CB009', 'CB011']);
  for (const d of ds) assert.ok(d.severity === vscode.DiagnosticSeverity.Warning || d.severity === vscode.DiagnosticSeverity.Information, `${d.code} severity`);
  const cb11 = ds.find((d) => d.code === 'CB011')!;
  assert.ok(/zxbpp has no defined\(\) operator/.test(cb11.message));
  assert.strictEqual(cb11.range.start.line, 0);
});

test('lint: editing updates the diagnostics (debounced), and lint.rules can switch a rule off', async () => {
  const doc = await openSource(path.join(ws, 'src', 'lintme.bas'));
  const ed = vscode.window.activeTextEditor!;
  await ed.edit((b) => b.replace(new vscode.Range(0, 0, 0, 16), '#ifdef FOO'));
  await waitFor('CB011 gone after the edit', () => ownDiagnostics(doc.uri).every((d) => d.code !== 'CB011'));
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  await cfg.update('lint.rules', { CB009: 'off', CB001: 'error' }, vscode.ConfigurationTarget.Workspace);
  try {
    await waitFor('CB009 off, CB001 an error', () => {
      const d = ownDiagnostics(doc.uri);
      return d.every((x) => x.code !== 'CB009') && d.some((x) => x.code === 'CB001' && x.severity === vscode.DiagnosticSeverity.Error);
    });
  } finally {
    await cfg.update('lint.rules', undefined, vscode.ConfigurationTarget.Workspace);
  }
});

test('lint: the toggle command and cpcbuild.lint.enable switch it off and on', async () => {
  const doc = await openSource(path.join(ws, 'src', 'lintme.bas'));
  await waitFor('diagnostics before', () => ownDiagnostics(doc.uri).length > 0);
  const off = (await vscode.commands.executeCommand('cpcbuild.lint.toggle')) as { enabled: boolean };
  assert.strictEqual(off.enabled, false);
  await waitFor('diagnostics cleared', () => ownDiagnostics(doc.uri).length === 0);
  const on = (await vscode.commands.executeCommand('cpcbuild.lint.toggle')) as { enabled: boolean };
  assert.strictEqual(on.enabled, true);
  await waitFor('diagnostics back', () => ownDiagnostics(doc.uri).length > 0);
});

test('hover: a library routine shows its signature, header text and a docs link; a compiler stdlib routine too', async () => {
  const doc = await openSource(path.join(ws, 'src', 'lintme.bas'));
  const hovers = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(4, 3))) as vscode.Hover[];
  const text = hovers.map(textOf).join('\n').replace(/&nbsp;/g, ' ').replace(/\\/g, '');
  assert.ok(text.includes('SUB PutSprite(x AS INTEGER, y AS INTEGER, w AS UBYTE, h AS UBYTE, spr AS UINTEGER)'), text);
  assert.ok(text.includes('copy w*h bytes (row by row, top row first) to the screen'), text);
  assert.ok(text.includes('cpcbuild/sprites.bas'), text);
  assert.ok(text.includes('command:cpcbuild.docs.open'), 'link to library.md');
  const ink = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(5, 2))) as vscode.Hover[];
  assert.ok(ink.map(textOf).join('\n').includes('SUB SetInk(pen AS UBYTE, colour AS UBYTE)'), 'stdlib hover');
});

test('hover: nothing on a comment, a string, or a name the program defines itself', async () => {
  const file = path.join(ws, 'src', 'shadow.bas');
  fs.writeFileSync(file, ["' PutSprite in a comment", 'a$ = "PutSprite"', 'SUB PutSprite(a AS UBYTE)', 'END SUB', 'PutSprite(1)', ''].join('\n'));
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  for (const [line, col] of [[0, 4], [1, 8], [4, 2]]) {
    const hs = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, col))) as vscode.Hover[];
    assert.ok(!hs.map(textOf).join('\n').includes('copy w'), `line ${line}`);
  }
  assert.deepStrictEqual(ownDiagnostics(doc.uri), []);
});

test('completion and signature help come from the same index', async () => {
  const file = path.join(ws, 'src', 'typing.bas');
  fs.writeFileSync(file, 'PutS\nPutSprite(1, 2, \n');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const items = (await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(0, 4))) as vscode.CompletionList;
  const labels = items.items.map((i) => (typeof i.label === 'string' ? i.label : i.label.label));
  assert.ok(labels.includes('PutSprite') && labels.includes('PutSpriteMasked'), labels.slice(0, 10).join(','));
  const help = (await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, new vscode.Position(1, 20), ',')) as vscode.SignatureHelp;
  assert.ok(help.signatures[0].label.startsWith('SUB PutSprite('));
  assert.strictEqual(help.activeParameter, 2);
});

test('docs.open finds the library.md section by heading', async () => {
  await openSource(path.join(ws, 'src', 'lintme.bas'));
  const r = (await vscode.commands.executeCommand('cpcbuild.docs.open', 'PutSprite')) as { file: string; line: number; heading: string };
  assert.ok(/Sprites \(`cpcbuild\/sprites\.bas`\)/.test(r.heading), r.heading);
  assert.ok(r.file.endsWith(path.join('docs', 'library.md')));
});

test('outside a cpcbuild project: no diagnostics and no hover or completion from Studio', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-outside-'));
  try {
    const doc = await openSource(path.join(dir, 'nextbuild.bas'));
    const a = await api();
    await waitFor('the lint pass to run (and find nothing to report)', () => a.lintRuns(doc.uri) > 0);
    assert.deepStrictEqual(ownDiagnostics(doc.uri), []);
    const hs = (await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, new vscode.Position(4, 3))) as vscode.Hover[];
    assert.ok(!hs.map(textOf).join('\n').includes('PutSprite'), 'no Studio hover');
    const items = (await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', doc.uri, new vscode.Position(4, 3))) as vscode.CompletionList;
    assert.ok(!items.items.some((i) => (typeof i.label === 'string' ? i.label : i.label.label) === 'PutSprite'));
    const help = (await vscode.commands.executeCommand('vscode.executeSignatureHelpProvider', doc.uri, new vscode.Position(4, 11), '(')) as vscode.SignatureHelp | undefined;
    assert.ok(!help || help.signatures.length === 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
