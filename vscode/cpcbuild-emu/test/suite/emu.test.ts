import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { EmuEvent, EmuState, EmuVersion } from '../../src/emuApi';
import { test, waitFor } from './harness';

const media = process.env.CPCEMU_MEDIA!;
const dsk = path.join(media, 'plusdemo.dsk');
const exec = <T>(c: string, a?: unknown): Promise<T> => Promise.resolve(vscode.commands.executeCommand<T>(c, a));
const err = (r: unknown): string | undefined => (r as { error?: string })?.error;

const map = new Map(fs.readFileSync(path.join(media, 'plusdemo.map'), 'utf8').split('\n').filter(Boolean)
  .map((l) => { const [a, n] = l.split(': '); return [n.trim(), parseInt(a, 16)] as [string, number]; }));
const org = map.get('.core.__START_PROGRAM')!;
const moveSprites = map.get('._MoveSprites')!;
const bin = fs.readFileSync(path.join(media, 'plusdemo.bin'));

const events: EmuEvent[] = [];
let session = '';

const state = (): Promise<EmuState> => exec<EmuState>('cpcbuild.emu.state', { session });
const nextEvent = (from: number, event: string): Promise<EmuEvent> =>
  waitFor(`a "${event}" event`, () => events.slice(from).find((e) => e.event === event), 20000);

test('the emulator extension is active and reports its API version', async () => {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-emu')!;
  assert.ok(ext, 'extension found');
  await ext.activate();
  const sub = vscode.commands.registerCommand('cpcbuild.emuEvent', (e: EmuEvent) => { events.push(e); });
  void sub;
  const v = await exec<EmuVersion>('cpcbuild.emu.version');
  assert.strictEqual(v.api, 1);
  assert.match(v.cpcec, /^[0-9a-f]{40}$/);
  assert.deepStrictEqual(v.models, ['464', '664', '6128', 'plus']);
});

test('errors are values, never throws', async () => {
  assert.match(err(await exec('cpcbuild.emu.state', { session: 'nope' }))!, /no such session/);
  assert.match(err(await exec('cpcbuild.emu.open', { file: '/nonexistent.dsk', kind: 'dsk', model: 'plus' }))!, /cannot read/);
  assert.match(err(await exec('cpcbuild.emu.open', { file: dsk, kind: 'bin', model: 'plus' }))!, /kind/);
  assert.ok(err(await exec('cpcbuild.emu.pause')), 'no session is open yet');
});

test('open plusdemo.dsk: the frame counter advances', async () => {
  const r = await exec<{ session: string }>('cpcbuild.emu.open', { file: dsk, kind: 'dsk', model: 'plus', focus: true });
  assert.ok(r.session, JSON.stringify(r));
  session = r.session;
  const s0 = await state();
  assert.strictEqual(s0.model, 'plus');
  const f0 = s0.frame;
  const s1 = await waitFor('frames to advance', async () => { const s = await state(); return s.frame >= f0 + 60 && s; });
  assert.strictEqual(s1.running, true);
  assert.strictEqual(s1.paused, false);
});

test('readMemory matches the program binary once it has loaded', async () => {
  await waitFor('the program in memory', async () => {
    const r = await exec<{ bytes: string }>('cpcbuild.emu.readMemory', { session, addr: org, length: 64 });
    return !err(r) && Buffer.from(r.bytes, 'base64').equals(bin.subarray(0, 64));
  }, 30000);
  assert.match(err(await exec('cpcbuild.emu.readMemory', { session, addr: 0, length: 4, bank: 1 }))!, /bank/);
  assert.match(err(await exec('cpcbuild.emu.readMemory', { session, addr: 0xfff0, length: 100 }))!, /&FFFF/);
});

test('a breakpoint at MoveSprites pauses the emulator and fires cpcbuild.emuEvent', async () => {
  assert.match(err(await exec('cpcbuild.emu.setBreakpoint', { session, addr: moveSprites, kind: 'read' }))!, /not supported/);
  const mark = events.length;
  const bp = await exec<{ id: string }>('cpcbuild.emu.setBreakpoint', { session, addr: moveSprites, kind: 'exec' });
  assert.ok(bp.id, JSON.stringify(bp));
  const ev = await nextEvent(mark, 'paused');
  assert.strictEqual(ev.session, session);
  assert.strictEqual(ev.state!.reason, 'breakpoint');
  assert.strictEqual(ev.state!.pc, moveSprites);
  const s = await state();
  assert.strictEqual(s.paused, true);
  assert.strictEqual(s.running, false);
  assert.strictEqual(s.pc, moveSprites);
});

test('step, memory write and step over while paused', async () => {
  const mark = events.length;
  const r = await exec<{ state: EmuState }>('cpcbuild.emu.step', { session });
  assert.strictEqual(r.state.paused, true);
  assert.strictEqual(r.state.reason, 'step');
  assert.notStrictEqual(r.state.pc, moveSprites);
  assert.strictEqual((await nextEvent(mark, 'paused')).state!.reason, 'step');
  assert.deepStrictEqual(await exec('cpcbuild.emu.writeMemory', { session, addr: 0x3000, bytes: Buffer.from([0xa5, 0x5a]).toString('base64') }), {});
  const back = await exec<{ bytes: string }>('cpcbuild.emu.readMemory', { session, addr: 0x3000, length: 2 });
  assert.deepStrictEqual([...Buffer.from(back.bytes, 'base64')], [0xa5, 0x5a]);
  const over = await exec<{ state: EmuState }>('cpcbuild.emu.stepOver', { session });
  assert.ok(!err(over), JSON.stringify(over));
  assert.strictEqual(over.state.paused, true);
  const s = await state();
  assert.strictEqual(s.paused, true);
});

test('clear the breakpoint and resume: running again, with events', async () => {
  assert.deepStrictEqual(await exec('cpcbuild.emu.clearBreakpoint', { session, addr: moveSprites, kind: 'exec' }), {});
  const mark = events.length;
  const r = await exec<{ state: EmuState }>('cpcbuild.emu.resume', { session });
  assert.strictEqual(r.state.running, true);
  await nextEvent(mark, 'resumed');
  const f0 = (await state()).frame;
  await waitFor('frames to advance after resume', async () => (await state()).frame >= f0 + 30);
  // pause and resume by command
  const p = await exec<{ state: EmuState }>('cpcbuild.emu.pause', { session });
  assert.strictEqual(p.state.paused, true);
  assert.strictEqual(p.state.reason, 'user');
  await nextEvent(mark, 'paused');
  await exec('cpcbuild.emu.resume', { session });
  assert.deepStrictEqual(await exec('cpcbuild.emu.reset', { session }), {});
  await waitFor('frames after reset', async () => (await state()).running);
});

test('the audio worklet loads under the page CSP', async () => {
  const log = process.env.CPCEMU_LOG!;
  await exec('cpcbuild.emu._probeAudio');
  const line = await waitFor('the sound probe', () => fs.readFileSync(log, 'utf8').split('\n').find((l) => l.includes('sound probe')), 10000);
  assert.match(line, /worklet=loaded failed=false/, line);
});

test('a hidden tab pauses silently and carries on when shown again', async () => {
  const doc = await vscode.workspace.openTextDocument({ content: 'cover' });
  await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, preview: false });
  await new Promise((r) => setTimeout(r, 800));
  const a = (await state()).frame;
  await new Promise((r) => setTimeout(r, 1500));
  const b = (await state()).frame;
  assert.ok(b - a < 5, `frames advanced by ${b - a} while hidden`);
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await waitFor('frames after showing the tab again', async () => (await state()).frame >= b + 40);
});

test('screenshot is a 768x536 PNG', async () => {
  const r = await exec<{ png: string; width: number; height: number }>('cpcbuild.emu.screenshot', { session });
  assert.ok(!err(r), JSON.stringify(r));
  assert.strictEqual(r.width, 768);
  assert.strictEqual(r.height, 536);
  const png = Buffer.from(r.png, 'base64');
  assert.strictEqual(png.toString('latin1', 1, 4), 'PNG');
  assert.strictEqual(png.readUInt32BE(16), 768);
  assert.strictEqual(png.readUInt32BE(20), 536);
  const out = process.env.CPCEMU_SHOT;
  if (out) fs.writeFileSync(out, png);
});

test('open again with reuse keeps one session; close fires a closed event', async () => {
  const again = await exec<{ session: string }>('cpcbuild.emu.open', { file: dsk, kind: 'dsk', model: 'plus' });
  assert.strictEqual(again.session, session);
  const mark = events.length;
  assert.deepStrictEqual(await exec('cpcbuild.emu.close', { session }), {});
  const ev = await nextEvent(mark, 'closed');
  assert.strictEqual(ev.session, session);
  assert.match(err(await exec('cpcbuild.emu.state', { session }))!, /no such session/);
});
