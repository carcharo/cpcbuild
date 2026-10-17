import * as path from 'path';
import * as vscode from 'vscode';
import {
  EMU_API_VERSION, type EmuBreakpointArgs, type EmuEvent, type EmuFileKind, type EmuModel, type EmuOpenArgs,
  type EmuOpenResult, type EmuReadMemoryArgs, type EmuReadMemoryResult, type EmuScreenshotResult, type EmuState, type EmuVersion,
} from '../emuApi';
import { encodePng } from '../shared/png';
import { deliver, EVENT_TIMEOUT_MS } from './deliver';
import { Session, type SessionEvent } from './session';

/** The CPCEC commit the bundled build comes from (tools/cpcec/fetch_build.sh pins the same). */
export const CPCEC_COMMIT = 'c025aab961a796b918cc99bc3e16216ea65bb5d1';
const MODELS: EmuModel[] = ['464', '664', '6128', 'plus'];
const KINDS: EmuFileKind[] = ['dsk', 'cpr', 'sna'];
const STEP_WAIT_MS = 3000;

const sessions = new Map<string, Session>();
let counter = 0;
let lastSession: Session | undefined;
let eventChain: Promise<void> = Promise.resolve();

type Err = { error: string };
const fail = (e: unknown): Err => ({ error: e instanceof Error ? e.message : String(e) });

async function defaultRun(ev: EmuEvent): Promise<unknown> {
  if (!(await vscode.commands.getCommands()).includes('cpcbuild.emuEvent')) return undefined;
  return vscode.commands.executeCommand('cpcbuild.emuEvent', ev);
}

/** Runs `cpcbuild.emuEvent` (Studio registers it) if it exists; events are delivered one at a time, in order, each with a timeout. */
function fireEvent(s: Session, event: SessionEvent, state: EmuState | undefined): void {
  const ev: EmuEvent = { session: s.id, event, state };
  eventChain = eventChain.then(async () => { await deliver(ev, EVENT_TIMEOUT_MS, defaultRun); });
}

function pick(session: unknown): Session {
  if (typeof session === 'string' && session) {
    const s = sessions.get(session);
    if (!s) throw new Error(`no such session: ${session}`);
    return s;
  }
  if (lastSession && !lastSession.closed) return lastSession;
  throw new Error('no emulator session is open');
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${what} must be an integer from ${min} to ${max}`);
  return v;
}

/** Wraps a command so it always resolves: failures become { error }. */
function cmd<A, R>(fn: (a: A) => Promise<R> | R): (a: A) => Promise<R | Err> {
  return async (a: A) => {
    try { return await fn(a ?? ({} as A)); } catch (e) { return fail(e); }
  };
}

async function openSession(a: EmuOpenArgs): Promise<EmuOpenResult> {
  if (!a || typeof a.file !== 'string' || !a.file) throw new Error('open: "file" is required');
  if (!KINDS.includes(a.kind)) throw new Error(`open: "kind" must be one of ${KINDS.join(', ')}`);
  if (!MODELS.includes(a.model)) throw new Error(`open: "model" must be one of ${MODELS.join(', ')}`);
  let data: Uint8Array;
  try { data = await vscode.workspace.fs.readFile(vscode.Uri.file(a.file)); } catch { throw new Error(`open: cannot read ${a.file}`); }
  const focus = a.focus === true;
  let s = a.reuse === false ? undefined : lastSession && !lastSession.closed ? lastSession : undefined;
  if (s) s.panel.reveal(undefined, !focus);
  else {
    s = new Session(`emu-${++counter}`, ext(), fireEvent, (x) => { sessions.delete(x.id); if (lastSession === x) lastSession = [...sessions.values()].pop(); }, focus);
    sessions.set(s.id, s);
  }
  lastSession = s;
  const r = await s.request<{ state: EmuState }>({ type: 'open', model: a.model, fileKind: a.kind, name: path.basename(a.file), data: Buffer.from(data).toString('base64'), run: a.run }, 20000);
  s.model = a.model;
  s.lastState = r.state;
  s.setTitle(path.basename(a.file));
  return { session: s.id };
}

let extUri: vscode.Uri;
const ext = (): vscode.Uri => extUri;

/** pause/resume/step...: answered with the state; stepOver/stepOut may still be running after STEP_WAIT_MS. */
async function stateCmd(a: { session?: string }, type: 'pause' | 'resume' | 'step' | 'stepOver' | 'stepOut'): Promise<{ state: EmuState }> {
  const s = pick(a.session);
  const r = await s.request<{ state: EmuState }>({ type }, type === 'stepOver' || type === 'stepOut' ? STEP_WAIT_MS : 10000)
    .catch(async (e: Error) => {
      if (!/did not answer/.test(e.message)) throw e;
      return s.request<{ state: EmuState }>({ type: 'state' }); // still running to its trap; a later "paused" event reports the stop
    });
  s.lastState = r.state;
  return r;
}

async function runFile(uri: vscode.Uri | undefined, forceDialog = false): Promise<void> {
  let file = uri;
  if (!file && !forceDialog) file = vscode.window.activeTextEditor?.document.uri;
  if (!file || forceDialog) {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      title: 'Open in CPC Emulator',
      filters: { 'CPC media': ['dsk', 'cpr', 'sna'] },
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    file = picked?.[0];
  }
  if (!file) return;
  const kind = path.extname(file.fsPath).slice(1).toLowerCase() as EmuFileKind;
  if (!KINDS.includes(kind)) {
    void vscode.window.showWarningMessage('CPC Emulator opens .dsk, .cpr and .sna files.');
    return;
  }
  const configured = vscode.workspace.getConfiguration('cpcbuild.emu').get<EmuModel>('defaultModel', '6128');
  const model: EmuModel = kind === 'cpr' ? 'plus' : configured;
  const r = await openCmd({ file: file.fsPath, kind, model, focus: true });
  if ('error' in r) void vscode.window.showErrorMessage(`CPC Emulator: ${r.error}`);
}

const openCmd = cmd(openSession);

export function activate(context: vscode.ExtensionContext): void {
  extUri = context.extensionUri;
  const reg = (name: string, fn: (...a: any[]) => unknown): void => { context.subscriptions.push(vscode.commands.registerCommand(name, fn)); }; // eslint-disable-line @typescript-eslint/no-explicit-any

  reg('cpcbuild.emu.version', cmd<unknown, EmuVersion>(() => ({ api: EMU_API_VERSION, cpcec: CPCEC_COMMIT, models: [...MODELS] })));
  reg('cpcbuild.emu.open', openCmd);
  reg('cpcbuild.emu.reset', cmd(async (a: { session?: string }) => { const s = pick(a.session); const r = await s.request<{ state: EmuState }>({ type: 'reset' }); s.lastState = r.state; return {}; }));
  reg('cpcbuild.emu.pause', cmd((a: { session?: string }) => stateCmd(a, 'pause')));
  reg('cpcbuild.emu.resume', cmd((a: { session?: string }) => stateCmd(a, 'resume')));
  reg('cpcbuild.emu.step', cmd((a: { session?: string }) => stateCmd(a, 'step')));
  reg('cpcbuild.emu.stepOver', cmd((a: { session?: string }) => stateCmd(a, 'stepOver')));
  reg('cpcbuild.emu.stepOut', cmd((a: { session?: string }) => stateCmd(a, 'stepOut')));
  reg('cpcbuild.emu.state', cmd(async (a: { session?: string }): Promise<EmuState> => {
    const s = pick(a.session);
    const r = await s.request<{ state: EmuState }>({ type: 'state' });
    s.lastState = r.state;
    return r.state;
  }));
  reg('cpcbuild.emu.readMemory', cmd(async (a: EmuReadMemoryArgs): Promise<EmuReadMemoryResult> => {
    if (a.bank !== undefined) throw new Error('readMemory: "bank" is reserved; API 1 reads what the Z80 sees now');
    const addr = int(a.addr, 'addr', 0, 0xffff), length = int(a.length, 'length', 0, 0x10000);
    if (addr + length > 0x10000) throw new Error('readMemory: addr + length is past &FFFF');
    const r = await pick(a.session).request<{ bytes: string }>({ type: 'readMemory', addr, length });
    return { bytes: r.bytes };
  }));
  reg('cpcbuild.emu.writeMemory', cmd(async (a: { session?: string; addr: number; bytes: string }) => {
    const addr = int(a.addr, 'addr', 0, 0xffff);
    if (typeof a.bytes !== 'string') throw new Error('writeMemory: "bytes" must be a base64 string');
    const len = Buffer.from(a.bytes, 'base64').length;
    if (addr + len > 0x10000) throw new Error('writeMemory: addr + length is past &FFFF');
    await pick(a.session).request({ type: 'writeMemory', addr, bytes: a.bytes });
    return {};
  }));
  const bp = (on: boolean) => cmd(async (a: EmuBreakpointArgs) => {
    const addr = int(a.addr, 'addr', 0, 0xffff);
    if (a.kind !== 'exec') throw new Error(`breakpoint kind "${String(a.kind)}" is not supported in API 1 (only "exec")`);
    await pick(a.session).request({ type: 'setBreakpoint', addr, on });
    return on ? { id: `exec:${addr.toString(16).padStart(4, '0')}` } : {};
  });
  reg('cpcbuild.emu.setBreakpoint', bp(true));
  reg('cpcbuild.emu.clearBreakpoint', bp(false));
  reg('cpcbuild.emu.screenshot', cmd(async (a: { session?: string }): Promise<EmuScreenshotResult> => {
    const r = await pick(a.session).request<{ rgba: string; width: number; height: number }>({ type: 'screenshot' });
    return { png: encodePng(Buffer.from(r.rgba, 'base64'), r.width, r.height).toString('base64'), width: r.width, height: r.height };
  }));
  if (process.env.CPCEMU_TEST_HOOKS) reg('cpcbuild.emu._probeAudio', () => { pick(undefined).notice({ kind: 'probeAudio' }); }); // test hook: only when the test runner sets CPCEMU_TEST_HOOKS
  reg('cpcbuild.emu.close', cmd((a: { session?: string }) => { pick(a.session).panel.dispose(); return {}; }));

  // user-facing
  reg('cpcbuild.emu.openFile', () => runFile(undefined, true));
  reg('cpcbuild.emu.runFile', (uri?: vscode.Uri) => runFile(uri));

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('cpcbuild.emu.runHidden')) return;
    const rh = vscode.workspace.getConfiguration('cpcbuild.emu').get<boolean>('runHidden', false);
    for (const s of sessions.values()) s.notice({ kind: 'config', runHidden: rh });
  }));
}

export function deactivate(): void {
  for (const s of [...sessions.values()]) s.panel.dispose();
}
