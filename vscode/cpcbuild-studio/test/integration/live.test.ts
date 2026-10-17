/**
 * Studio + cpcbuild-emu together: build a template, run it in the emulator through Studio's Run command, break at a
 * routine of the map, read registers and memory through the views' models, step, resume and close.
 * Everything crosses the boundary as VS Code commands only.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import type { EmuEvent, EmuState } from '../../src/emuApi';
import { test, waitFor } from '../suite/harness';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const exec = <T>(c: string, a?: unknown): Promise<T> => Promise.resolve(vscode.commands.executeCommand<T>(c, a));
const hex4 = (n: number): string => '&' + n.toString(16).toUpperCase().padStart(4, '0');

let studio: StudioApi;
let session = '';
const events = (): EmuEvent[] => studio.emuEvents();
const nextEvent = (from: number, event: string): Promise<EmuEvent> =>
  waitFor(`a "${event}" event`, () => events().slice(from).find((e) => e.event === event), 90000);
const sym = (label: string): number => {
  const s = studio.debug.symbols()?.symbols.find((x) => x.label === label);
  assert.ok(s, `${label} in the map`);
  return s.addr;
};

test('both extensions are active; Studio builds the template (origin &4000) and loads its symbols', async () => {
  const emu = vscode.extensions.getExtension('cpcbuild.cpcbuild-emu');
  assert.ok(emu, 'cpcbuild-emu loaded next to Studio');
  await emu.activate();
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio')!;
  studio = ext.isActive ? ext.exports : await ext.activate();
  const b = await studio.build(ws, 'cpc6128');
  assert.ok(b.ok, b.message);
  assert.strictEqual(b.report?.start, 0x4000);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'src', 'main.bas')));
  await vscode.window.showTextDocument(doc);
  await studio.debug.reloadSymbols();
  assert.ok(sym('._PutSprite') >= 0x4000);
  const names = studio.debug.symbolGroups().flatMap((g) => g.names);
  assert.ok(names.includes('PutSprite') && names.includes('x'));
});

test('a breakpoint set before the run is applied when Studio opens the emulator, and stops the program at the routine', async () => {
  const put = sym('._PutSprite');
  const r = (await exec('cpcbuild.debug.toggleBreakpoint', { symbol: 'PutSprite' })) as { added: boolean; applied: boolean; addr: number };
  assert.deepStrictEqual([r.added, r.applied, r.addr], [true, false, put], 'saved for later: there is no session yet');
  const mark = events().length;
  await exec('cpcbuild.run'); // Studio's run command: the last build in the emulator selected by the settings (emu)
  const paused = await nextEvent(mark, 'paused');
  session = paused.session;
  assert.ok(session);
  assert.strictEqual(paused.state?.reason, 'breakpoint');
  assert.strictEqual(paused.state?.pc, put);
  const st = await exec<EmuState>('cpcbuild.emu.state', { session });
  assert.strictEqual(st.paused, true);
  assert.strictEqual(st.pc, put);
});

test('the status bar and the registers view show where it stopped', async () => {
  const put = sym('._PutSprite');
  await waitFor('the status bar text', () => studio.debug.statusLine() === '$(debug-pause) CPC paused at PutSprite');
  const rows = studio.debug.registers();
  assert.deepStrictEqual(rows.find((r) => r.name === 'PC'), { name: 'PC', value: hex4(put), note: 'PutSprite' });
  for (const n of ['SP', 'AF', 'BC', 'DE', 'HL', 'IX', 'IY', "AF'", 'I', 'R', 'IM', 'IFF1']) assert.ok(rows.some((r) => r.name === n), `register ${n}`);
  const shown = (await exec('cpcbuild.debug.showRegisters')) as { paused: boolean; rows: unknown[] };
  assert.strictEqual(shown.paused, true);
  assert.strictEqual(shown.rows.length, rows.length);
  assert.ok(studio.debug.live());
});

test('the memory view reads the program code and the variables at their symbols', async () => {
  const put = sym('._PutSprite');
  const org = sym('.core.__START_PROGRAM');
  const bin = fs.readFileSync(path.join(ws, 'build', 'cpc6128.bin'));
  const code = await studio.debug.memoryShow({ symbol: 'PutSprite' });
  assert.ok(code, 'a snapshot');
  assert.strictEqual(code.base, put - (put % 16));
  const bytes = Buffer.from(code.bytes, 'base64');
  assert.strictEqual(bytes.length, 512);
  const at = put - code.base;
  assert.ok(bytes.subarray(at, at + 8).equals(bin.subarray(put - org, put - org + 8)), 'the routine\'s first bytes are the binary\'s');
  assert.strictEqual(code.following, 'PutSprite');
  assert.strictEqual(code.rowNames[Math.floor(at / 16)]?.split(', ').includes('PutSprite'), true, 'the symbol annotates its row');

  const x = sym('._x');
  const y = sym('._y');
  const data = await studio.debug.memoryShow({ addr: x, symbol: 'x' });
  assert.ok(data);
  const d = Buffer.from(data.bytes, 'base64');
  const xv = d[x - data.base];
  const yv = d[y - data.base];
  assert.ok(xv >= 1 && xv <= 77, `x = ${xv}`);
  assert.ok(yv >= 20 && yv <= 190, `y = ${yv}`);
  // the symbols view's value for the same labels is the same byte
  const vals = await studio.debug.symbolValues();
  assert.strictEqual(vals.get('._x')?.value, xv);
  assert.strictEqual(vals.get('._y')?.value, yv);
  assert.strictEqual(data.pc, put);
  // the webview itself came up (its bundle ran and said ready) and reported no error
  await waitFor('the memory webview to start', () => studio.debug.memoryStats().ready >= 1);
  assert.deepStrictEqual(studio.debug.memoryStats().errors, []);
});

test('step, step over and step out move the pc and keep the views in step', async () => {
  const put = sym('._PutSprite');
  const mark = events().length;
  const s = (await exec('cpcbuild.debug.step')) as { state: EmuState };
  assert.strictEqual(s.state.paused, true);
  assert.strictEqual(s.state.reason, 'step');
  assert.notStrictEqual(s.state.pc, put);
  await nextEvent(mark, 'paused');
  await waitFor('the status bar to follow the step', () => studio.debug.statusLine().startsWith('$(debug-pause) CPC paused at ') && studio.debug.statusLine().includes('PutSprite+'));
  assert.strictEqual(studio.debug.registers().find((r) => r.name === 'PC')!.value, hex4(s.state.pc));
  const over = (await exec('cpcbuild.debug.stepOver')) as { state?: EmuState; error?: string };
  assert.ok(!over.error, over.error);
  const out = (await exec('cpcbuild.debug.stepOut')) as { state?: EmuState; error?: string };
  assert.ok(!out.error, out.error);
  const now = await exec<EmuState>('cpcbuild.emu.state', { session });
  assert.ok(now.paused || now.running, 'still a live session');
});

test('resume runs on; the next hit marks the bytes that changed since the last refresh', async () => {
  const x = sym('._x');
  // make sure we are paused somewhere, then park the memory window on the variables
  await exec('cpcbuild.debug.pause');
  await waitFor('paused', () => studio.debug.paused());
  const base = (await studio.debug.memoryShow({ addr: x, symbol: 'x' }))!;
  const mark = events().length;
  const r = (await exec('cpcbuild.debug.resume')) as { state: EmuState };
  assert.strictEqual(r.state.running, true);
  await nextEvent(mark, 'resumed');
  await nextEvent(mark, 'paused'); // the breakpoint at PutSprite again, a frame later
  const snap = await waitFor('a refresh that saw x change', () => {
    const s = studio.debug.memorySnapshot();
    return s && s.changed.includes(x - s.base) ? s : undefined;
  }, 15000);
  assert.strictEqual(snap.base, base.base, 'same window');
  const y = sym('._y');
  assert.ok(snap.changed.includes(y - snap.base), 'y moves every frame too');
  assert.ok(snap.changed.length < 40, `only a few bytes changed (${snap.changed.length})`);
});

test('removing the breakpoint and resuming runs freely; pause stops it with reason "user"', async () => {
  const put = sym('._PutSprite');
  const off = (await exec('cpcbuild.debug.toggleBreakpoint', { addr: put })) as { added: boolean; applied: boolean };
  assert.deepStrictEqual([off.added, off.applied], [false, true], 'cleared in the live emulator');
  assert.deepStrictEqual(studio.debug.breakpoints(), []);
  if (studio.debug.paused()) {
    const mark = events().length;
    await exec('cpcbuild.debug.resume');
    await nextEvent(mark, 'resumed');
  }
  await waitFor('the status bar: running', () => studio.debug.statusLine() === '$(play) CPC running');
  assert.deepStrictEqual(studio.debug.registers(), [], 'registers are shown only while paused');
  const f0 = (await exec<EmuState>('cpcbuild.emu.state', { session })).frame;
  await waitFor('frames to advance', async () => (await exec<EmuState>('cpcbuild.emu.state', { session })).frame >= f0 + 25);
  const mark = events().length;
  const p = (await exec('cpcbuild.debug.pause')) as { state: EmuState };
  assert.strictEqual(p.state.reason, 'user');
  await nextEvent(mark, 'paused');
  assert.match(studio.debug.statusLine(), /^\$\(debug-pause\) CPC paused at /);
});

test('closing the emulator clears the views; a saved breakpoint is re-applied when it opens again', async () => {
  const put = sym('._PutSprite');
  await exec('cpcbuild.debug.toggleBreakpoint', { symbol: 'PutSprite' }); // persisted, applied to the live session
  assert.strictEqual(studio.debug.breakpoints().length, 1);
  const mark = events().length;
  assert.deepStrictEqual(await exec('cpcbuild.emu.close', { session }), {});
  await nextEvent(mark, 'closed');
  await waitFor('the status bar to clear', () => studio.debug.statusLine() === '');
  assert.strictEqual(studio.debug.live(), false);
  assert.deepStrictEqual(studio.debug.registers(), []);
  // run again: a new session, the same breakpoint, stopped at the same routine
  const again = events().length;
  await exec('cpcbuild.run');
  const paused = await nextEvent(again, 'paused');
  assert.notStrictEqual(paused.session, session, 'a new session');
  assert.strictEqual(paused.state?.pc, put);
  assert.strictEqual(paused.state?.reason, 'breakpoint');
  // leave nothing behind
  await exec('cpcbuild.debug.toggleBreakpoint', { addr: put });
  await exec('cpcbuild.emu.close', { session: paused.session });
});
