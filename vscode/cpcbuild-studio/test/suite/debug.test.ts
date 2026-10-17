/** Symbols view, debug controls and the missing-emulator warning without cpcbuild-emu (this run loads Studio only). */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { readSettings } from '../../src/ext/config';
import type { EmuState } from '../../src/emuApi';
import { test, waitFor } from './harness';

// the path as VS Code has it (the temp dir may be a symlink; project roots are compared as strings)
const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  return ext.isActive ? ext.exports : ext.activate();
}

/** The template project's map, with its main.bas as the active editor (so it is the project the views follow). */
async function withMap(a: StudioApi): Promise<void> {
  const map = path.join(ws, 'build', 'cpc6128.map');
  if (!fs.existsSync(map)) {
    const b = await a.build(ws, 'cpc6128');
    assert.ok(b.ok, b.message);
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'src', 'main.bas')));
  await vscode.window.showTextDocument(doc);
  await a.debug.reloadSymbols();
  assert.ok(a.debug.symbols(), 'symbol table loaded');
}

const fakeState = (pc: number, over: Partial<EmuState> = {}): EmuState => ({
  running: false, paused: true, reason: 'breakpoint', pc, sp: 0xbf40, af: 0x0244, bc: 0x0a12, de: 0x1000, hl: 0x4f2a, ix: 0, iy: 0,
  af2: 0, bc2: 0, de2: 0, hl2: 0, i: 0, r: 0, im: 1, iff1: 1, frame: 10, model: '6128', ...over,
});

test('symbols: the template map is grouped into BASIC routines, library routines and data', async () => {
  const a = await api();
  await withMap(a);
  const r = (await vscode.commands.executeCommand('cpcbuild.symbols.refresh')) as { count: number };
  assert.ok(r.count > 100, `symbols: ${r.count}`);
  const groups = a.debug.symbolGroups();
  const names = (k: string): string[] => groups.find((g) => g.kind === k)?.names ?? [];
  assert.deepStrictEqual(groups.map((g) => g.kind), ['library', 'data']); // the template has no SUB of its own; runtime is hidden
  for (const n of ['x', 'y', 'dx', 'dy']) assert.ok(names('data').includes(n), `data: ${n}`);
  for (const n of ['PutSprite', 'FillRect', 'ScanKeys']) assert.ok(names('library').includes(n), `library: ${n}`);
});

test('symbols: filter, runtime toggle, copy address, go to definition', async () => {
  const a = await api();
  await withMap(a);
  assert.strictEqual(await vscode.commands.executeCommand('cpcbuild.symbols.filter', { filter: 'putsp' }), 'putsp');
  assert.deepStrictEqual(a.debug.symbolGroups().map((g) => g.names), [['PutSprite']]);
  await vscode.commands.executeCommand('cpcbuild.symbols.filter', { filter: '' });
  assert.ok(a.debug.symbolGroups().length >= 2);
  assert.strictEqual(await vscode.commands.executeCommand('cpcbuild.symbols.toggleRuntime'), true);
  assert.ok(a.debug.symbolGroups().some((g) => g.kind === 'runtime'));
  assert.strictEqual(await vscode.commands.executeCommand('cpcbuild.symbols.toggleRuntime'), false);

  const addr = a.debug.symbols()!.symbols.find((s) => s.label === '._PutSprite')!.addr;
  const copied = await vscode.commands.executeCommand('cpcbuild.symbols.copyAddress', { label: '._PutSprite' });
  assert.strictEqual(copied, '&' + addr.toString(16).toUpperCase().padStart(4, '0'));
  assert.strictEqual(await vscode.env.clipboard.readText(), copied);

  const def = (await vscode.commands.executeCommand('cpcbuild.symbols.goToDefinition', { label: '._x' })) as { file: string; line: number };
  assert.strictEqual(path.basename(def.file), 'main.bas');
  assert.match(fs.readFileSync(def.file, 'utf8').split('\n')[def.line - 1], /^DIM x, y, dx, dy/);
});

test('breakpoints: toggled by symbol or address, kept per project, no emulator needed', async () => {
  const a = await api();
  await withMap(a);
  const addr = a.debug.symbols()!.symbols.find((s) => s.label === '._PutSprite')!.addr;
  const on = (await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', { symbol: 'PutSprite' })) as { added: boolean; addr: number; applied: boolean };
  assert.deepStrictEqual([on.added, on.addr, on.applied], [true, addr, false]);
  assert.deepStrictEqual(a.debug.breakpoints(), [{ addr, symbol: 'PutSprite' }]);
  const off = (await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', { addr })) as { added: boolean };
  assert.strictEqual(off.added, false);
  assert.deepStrictEqual(a.debug.breakpoints(), []);
  const hex = (await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', '&' + (addr + 3).toString(16))) as { added: boolean };
  assert.strictEqual(hex.added, true);
  assert.deepStrictEqual(a.debug.breakpoints(), [{ addr: addr + 3 }]); // a typed address stays an address
  await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', { addr: addr + 3 });
  const off3 = (await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', 'PutSprite+3')) as { added: boolean };
  assert.strictEqual(off3.added, true);
  assert.deepStrictEqual(a.debug.breakpoints(), [{ addr: addr + 3, symbol: 'PutSprite', offset: 3 }]); // a symbol+offset follows the symbol
  await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', { addr: addr + 3 });
  const bad = (await vscode.commands.executeCommand('cpcbuild.debug.toggleBreakpoint', 'NoSuchRoutine')) as { error?: string };
  assert.match(bad.error ?? '', /no symbol "NoSuchRoutine"/);
});

test('the pause event drives the status bar and the registers; closing clears them', async () => {
  const a = await api();
  await withMap(a);
  const addr = a.debug.symbols()!.symbols.find((s) => s.label === '._PutSprite')!.addr;
  assert.strictEqual(a.debug.statusLine(), '');
  await vscode.commands.executeCommand('cpcbuild.emuEvent', { session: 'fake-1', event: 'paused', state: fakeState(addr + 3) });
  assert.strictEqual(a.debug.statusLine(), '$(debug-pause) CPC paused at PutSprite+3');
  const rows = a.debug.registers();
  assert.deepStrictEqual(rows.find((r) => r.name === 'PC'), { name: 'PC', value: '&' + (addr + 3).toString(16).toUpperCase().padStart(4, '0'), note: 'PutSprite+3' });
  assert.strictEqual(rows.find((r) => r.name === 'HL')!.value, '&4F2A');
  await vscode.commands.executeCommand('cpcbuild.emuEvent', { session: 'fake-1', event: 'resumed', state: fakeState(0, { paused: false, running: true }) });
  assert.strictEqual(a.debug.statusLine(), '$(play) CPC running');
  assert.deepStrictEqual(a.debug.registers(), []); // registers only while paused
  await vscode.commands.executeCommand('cpcbuild.emuEvent', { session: 'fake-1', event: 'closed' });
  assert.strictEqual(a.debug.statusLine(), '');
  assert.strictEqual(a.debug.live(), false);
});

test('memory view without the emulator: opens, explains, does not throw', async () => {
  const a = await api();
  await withMap(a);
  const snap = await vscode.commands.executeCommand('cpcbuild.memory.show', { symbol: 'PutSprite' });
  assert.strictEqual(snap, undefined);
  assert.strictEqual(a.debug.memorySnapshot(), undefined);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
});

test('debug commands without a session answer with an error value, not a throw', async () => {
  await api();
  for (const c of ['pause', 'resume', 'step', 'stepOver', 'stepOut']) {
    const r = (await vscode.commands.executeCommand(`cpcbuild.debug.${c}`)) as { error?: string };
    assert.ok(r.error, `${c}: ${JSON.stringify(r)}`);
  }
});

// ------------------------------------------------------------- the missing-emulator warning

test('emulator extension missing: one warning per session, with install and external buttons', async () => {
  const a = await api();
  const calls: { message: string; buttons: string[] }[] = [];
  a.emuMissing.reset();
  a.emuMissing.setUi({ warn: async (message, ...buttons) => (calls.push({ message, buttons }), undefined) });
  try {
    const run = { file: path.join(ws, 'build', 'cpc6128.dsk'), kind: 'dsk' as const, name: 'TPLFW', model: '6128' as const };
    const lines: string[] = [];
    const sink = { line: (t: string) => void lines.push(t) };
    // "/usr/bin/true" stands in for an installed external emulator: it exits at once and shows nothing
    const base = { ...readSettings(ws), emulator: 'emu' as const, caprice32Path: '/usr/bin/true', libraryPath: '' };
    const first = await a.runIn(ws, run, sink, base, null);
    assert.strictEqual(first.used, 'caprice32', first.message);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].buttons, ['Install CPCBuild Emulator', 'Use external emulator']);
    assert.match(calls[0].message, /cpcbuild-emu\) is not installed/);
    await a.runIn(ws, run, sink, base, null);
    await a.runIn(ws, run, sink, base, null);
    assert.strictEqual(calls.length, 1, 'the second and third Run do not warn again');
    assert.strictEqual(a.emuMissing.shown(), 1);
    assert.ok(lines.filter((l) => /not installed/.test(l)).length >= 2, 'the output channel still says why, every time');

    // a setting that already names an external emulator: no warning at all
    a.emuMissing.reset();
    const ext = await a.runIn(ws, run, sink, { ...base, emulator: 'caprice32' }, null);
    assert.strictEqual(ext.used, 'caprice32', ext.message);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(a.emuMissing.shown(), 0);
  } finally {
    a.emuMissing.setUi(undefined);
    a.emuMissing.reset();
  }
});

test('"Use external emulator" sets the setting for good; "Install" does not throw', async () => {
  const a = await api();
  const cfg = vscode.workspace.getConfiguration('cpcbuild');
  const before = cfg.inspect<string>('run.emulator')?.workspaceValue;
  const run = { file: path.join(ws, 'build', 'cpc6128.dsk'), kind: 'dsk' as const, name: 'TPLFW', model: '6128' as const };
  const sink = { line: () => undefined };
  const base = { ...readSettings(ws), emulator: 'emu' as const, caprice32Path: '/usr/bin/true', libraryPath: '' };
  try {
    a.emuMissing.reset();
    a.emuMissing.setUi({ warn: async () => 'Use external emulator' });
    await a.runIn(ws, run, sink, base, null);
    await waitFor('the setting to change', () => vscode.workspace.getConfiguration('cpcbuild').get('run.emulator') === 'caprice32', 5000);
    // and the next Run, with the setting now external, never asks again
    let asked = 0;
    a.emuMissing.reset();
    a.emuMissing.setUi({ warn: async () => (asked++, undefined) });
    await a.runIn(ws, run, sink, { ...base, emulator: readSettings(ws).emulator }, null);
    assert.strictEqual(asked, 0);

    a.emuMissing.reset();
    a.emuMissing.setUi({ warn: async () => 'Install CPCBuild Emulator' });
    await a.runIn(ws, run, sink, { ...base, emulator: 'emu' }, null); // opens the Extensions view search; nothing to assert but no failure
  } finally {
    a.emuMissing.setUi(undefined);
    a.emuMissing.reset();
    await cfg.update('run.emulator', before, vscode.ConfigurationTarget.Workspace);
  }
});
