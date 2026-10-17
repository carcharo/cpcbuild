/**
 * Extension-host side of the screenshot harness (see README.md here). Runs inside VS Code: opens each Studio screen,
 * switches the colour theme and asks the driver (run.ts, outside VS Code) for a window screenshot through a file
 * handshake in CPCBUILD_SHOTS_SYNC. Nothing here waits on UI: every wait has a timeout and a pending QuickPick is
 * never awaited.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { StudioApi } from '../../src/ext/activate';
import { newSprite, serialiseSprite, type Grid, type SpriteState } from '../../src/core/spriteDoc';

const ws = process.env.CPCBUILD_TEST_WORKSPACE as string;
const sync = process.env.CPCBUILD_SHOTS_SYNC as string;
const only = (process.env.CPCBUILD_SHOTS_ONLY ?? '').split(',').filter(Boolean);
const THEMES: Record<string, string> = { dark: 'Default Dark Modern', light: 'Default Light Modern', hc: 'Default High Contrast' };
const themeKeys = (process.env.CPCBUILD_SHOTS_THEMES ?? 'dark,light,hc').split(',');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const exec = <T>(c: string, ...a: unknown[]): Thenable<T> => vscode.commands.executeCommand<T>(c, ...a);
const log = (s: string): void => {
  console.log(`[ui-shots] ${s}`);
  if (process.env.UI_SHOTS_LOG) fs.appendFileSync(process.env.UI_SHOTS_LOG, s + '\n');
};

let seq = 0;
async function ask(req: Record<string, unknown>): Promise<void> {
  const n = String(++seq).padStart(4, '0');
  const f = path.join(sync, `req-${n}.json`);
  fs.writeFileSync(f + '.tmp', JSON.stringify(req));
  fs.renameSync(f + '.tmp', f);
  const t0 = Date.now();
  while (!fs.existsSync(path.join(sync, `done-${n}`))) {
    if (Date.now() - t0 > 30000) throw new Error(`driver did not answer ${n}`);
    await sleep(50);
  }
}

type Layout = 'editor' | 'panel' | 'workbench';
async function layout(l: Layout): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  await cfg.update('workbench.activityBar.location', l === 'workbench' ? 'default' : 'hidden', vscode.ConfigurationTarget.Global);
  await exec('workbench.action.closeAuxiliaryBar');
  if (l === 'workbench') await exec('workbench.action.closePanel');
  else if (l === 'editor') {
    await exec('workbench.action.closeSidebar');
    await exec('workbench.action.closePanel');
  } else await exec('workbench.action.closeSidebar');
  await sleep(300);
}

async function setTheme(key: string): Promise<void> {
  await vscode.workspace.getConfiguration().update('workbench.colorTheme', THEMES[key], vscode.ConfigurationTarget.Global);
  await sleep(1500);
}

interface Spec {
  name: string;
  layout: Layout;
  /** [width, height] pairs. */
  sizes: [number, number][];
  /** Runs after the window has its size and before the shot (hover, quick pick...). */
  pre?: () => Promise<void>;
  post?: () => Promise<void>;
  themes?: string[];
}
const SIZES_EDITOR: [number, number][] = [[1000, 700], [600, 700]];
const TALL: [number, number][] = [[1000, 1100]];

/** Captures `name-<theme>-<width>.png` for every theme and size. */
async function capture(s: Spec): Promise<void> {
  if (only.length && !only.includes(s.name)) return;
  log(`screen ${s.name}`);
  for (const t of s.themes ?? themeKeys) {
    await setTheme(t);
    for (const [w, h] of s.sizes) {
      await ask({ type: 'viewport', width: w, height: h });
      await sleep(900);
      await exec('notifications.hideToasts');
      await exec('notifications.clearAll');
      if (s.pre) await s.pre();
      await ask({ type: 'shot', file: `${s.name}-${t}-${w}.png` });
      if (s.post) await s.post();
    }
  }
}

async function api(): Promise<StudioApi> {
  const ext = vscode.extensions.getExtension<StudioApi>('cpcbuild.cpcbuild-studio')!;
  return ext.isActive ? ext.exports : ext.activate();
}

async function openWith(rel: string, viewType: string, ready: (a: StudioApi, uri: vscode.Uri) => Promise<void>): Promise<void> {
  const a = await api();
  const uri = vscode.Uri.file(path.join(ws, rel));
  await exec('workbench.action.closeAllEditors');
  await exec('vscode.openWith', uri, viewType);
  await ready(a, uri);
  await sleep(1200);
}
async function waitUntil(what: string, f: () => unknown, ms = 20000): Promise<void> {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
    await sleep(100);
  }
}
type Docs = { documents: Map<string, { readyCount: number }> };
const ready = (pick: (a: StudioApi) => Docs) => async (a: StudioApi, uri: vscode.Uri): Promise<void> => {
  await waitUntil(`${uri.fsPath} ready`, () => pick(a).documents.get(uri.toString())?.readyCount);
};

// ------------------------------------------------------------ fixtures built in code
function disc(g: Grid, cx: number, cy: number, r: number, v: number): void {
  for (let y = 0; y < g.length; y++) for (let x = 0; x < g[0].length; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) g[y][x] = v;
}
function paintSprite(s: SpriteState, f: (g: Grid, i: number) => void): SpriteState {
  s.items.forEach((g, i) => f(g, i));
  s.source = { text: '', key: '' };
  return s;
}
export function makeFixtures(): void {
  const put = (rel: string, text: string): void => {
    const f = path.join(ws, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  const s0 = paintSprite(newSprite('spr', { name: 'hero', mode: 0, w: 16, h: 16, masked: true, frames: 4 }), (g, i) => {
    disc(g, 7.5, 7.5, 6, 3 + i);
    disc(g, 7.5, 7.5, 3, 5 + i);
    disc(g, 5 + i, 5, 1.2, 1);
  });
  put('sprites/hero.cpcspr', serialiseSprite(s0));
  const sp = paintSprite(newSprite('spr', { name: 'ship', kind: 'plus', frames: 3 }), (g, i) => {
    disc(g, 7.5, 7.5, 7, 1 + i * 3);
    disc(g, 7.5, 7.5, 4, 2 + i * 3);
    disc(g, 7.5, 7.5, 1.5, 3 + i * 3);
  });
  put('sprites/ship.cpcspr', serialiseSprite(sp));
  const t = newSprite('til', { name: 'bgtiles', mode: 0, frames: 6 });
  t.dedupe = true;
  paintSprite(t, (g, i) => {
    const v = [1, 2, 1, 3, 2, 1][i];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g[y][x] = (x + y) % 2 ? v : (i % 3) + 4;
  });
  put('sprites/bgtiles.cpctil', serialiseSprite(t));
  put('palettes/hero.cpcpal', '# mode 0 pens 0-15 (firmware colours)\n0, 1, 2, 11, 20, 26, 3, 6, 15, 24, 9, 18, 4, 8, 13, 10\n');
  put('palettes/plus.cpcpal12', '# plus 12-bit colours\n000, FFF, F00, 0F0, 00F, FF0, 0FF, F0F, 888, F80, 08F, 80F, 8F0, F08, 0F8, 123\n');
  put('src/hover.bas', ['#include <cpcbuild/sprites.bas>', 'ScreenInit()', 'DIM x AS INTEGER', 'x = 10', 'PutSprite(x, 20, 2, 8, 0)', 'SetInk 1, 2', ''].join('\n'));
}

// ------------------------------------------------------------ the run
export async function run(): Promise<void> {
  await vscode.extensions.getExtension('cpcbuild.cpcbuild-emu')?.activate();
  const studio = await api();
  makeFixtures();
  await vscode.workspace.getConfiguration().update('workbench.startupEditor', 'none', vscode.ConfigurationTarget.Global);
  await vscode.workspace.getConfiguration().update('window.zoomLevel', 0, vscode.ConfigurationTarget.Global);
  await exec('workbench.action.closeAllEditors');

  const E = SIZES_EDITOR;
  const liveOnly = !!process.env.CPCBUILD_SHOTS_LIVE_ONLY;
  await layout('editor');
  if (!liveOnly) {
  await openWith('palettes/hero.cpcpal', 'cpcbuild.paletteEditor', ready((a) => a.palette));
  await capture({ name: 'palette-cpcpal', layout: 'editor', sizes: E });
  await openWith('palettes/plus.cpcpal12', 'cpcbuild.paletteEditor', ready((a) => a.palette));
  await capture({ name: 'palette-cpcpal12', layout: 'editor', sizes: E });
  await openWith('sprites/hero.cpcspr', 'cpcbuild.spriteEditor', ready((a) => a.sprite));
  await capture({ name: 'sprite-mode0', layout: 'editor', sizes: E });
  await openWith('sprites/ship.cpcspr', 'cpcbuild.spriteEditor', ready((a) => a.sprite));
  await capture({ name: 'sprite-plus', layout: 'editor', sizes: E });
  // Plus magnification preview: magnification x4 horizontally, x2 vertically (the preview is the top block of the side panel)
  await capture({
    name: 'sprite-plus-mag', layout: 'editor', sizes: [[1000, 700]],
    pre: async () => {
      await ask({ type: 'click', selector: '[data-seg="Magnification X"][data-val="4"]' });
      await ask({ type: 'click', selector: '[data-seg="Magnification Y"][data-val="2"]' });
      await sleep(600);
    },
  });
  await openWith('sprites/bgtiles.cpctil', 'cpcbuild.tileEditor', ready((a) => a.tile));
  await capture({ name: 'tile', layout: 'editor', sizes: E });
  await openWith('sprites/hero.cpcspr', 'cpcbuild.spriteEditor', ready((a) => a.sprite));
  await capture({ name: 'sprite-mode0-tall', layout: 'editor', sizes: TALL });
  await openWith('sprites/ship.cpcspr', 'cpcbuild.spriteEditor', ready((a) => a.sprite));
  await capture({ name: 'sprite-plus-tall', layout: 'editor', sizes: TALL });
  await openWith('assets/balls.cpcimp', 'cpcbuild.importer', ready((a) => a.importer));
  await sleep(2500);
  await capture({ name: 'importer', layout: 'editor', sizes: E });
  await capture({ name: 'importer-tall', layout: 'editor', sizes: TALL });
  // the Command tab at 600 px (the tab strip only exists in the narrow layout)
  await capture({ name: 'importer-command', layout: 'editor', sizes: [[600, 700]], pre: async () => { await ask({ type: 'click', selector: '#imp-tab-command' }); await sleep(700); } });
  await openWith('maps/level.tmx', 'cpcbuild.tmxViewer', ready((a) => a.tmx));
  await sleep(2500);
  await capture({ name: 'tmx', layout: 'editor', sizes: E });

  }
  // ---- build, run, break
  await exec('workbench.action.closeAllEditors');
  const b = await studio.build(ws, 'cpc6128');
  log(`build ok=${b.ok} ${b.message ?? ''}`);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'src', 'main.bas')));
  await vscode.window.showTextDocument(doc);
  await studio.debug.reloadSymbols();

  // build report in the Output panel
  await exec('cpcbuild.showBuildReport');
  await capture({ name: 'build-report', layout: 'panel', sizes: E });
  await exec('workbench.action.closePanel');

  // new project quick pick (never awaited)
  await capture({
    name: 'newproject-quickpick', layout: 'editor', sizes: E,
    pre: async () => { await exec('workbench.action.closeQuickOpen'); await sleep(400); void exec('cpcbuild.newProject'); await sleep(1800); },
    post: async () => { await exec('workbench.action.closeQuickOpen'); await sleep(300); },
  });

  // hover on a library routine
  const hov = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'src', 'hover.bas')));
  await vscode.window.showTextDocument(hov);
  await capture({
    name: 'hover', layout: 'editor', sizes: E,
    pre: async () => {
      const ed = vscode.window.activeTextEditor!;
      ed.selection = new vscode.Selection(4, 3, 4, 3);
      await exec('editor.action.showHover');
      await sleep(1800);
    },
  });

  // live debug: symbols / registers / memory / emulator
  await exec('workbench.action.closeAllEditors');
  await vscode.window.showTextDocument(doc);
  await exec('cpcbuild.debug.toggleBreakpoint', { symbol: 'PutSprite' });
  await exec('cpcbuild.run');
  try {
    await waitUntil('paused at the breakpoint', () => studio.debug.paused(), 90000);
  } catch (e) {
    log(`tabs: ${vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => `${g.viewColumn}:${t.label}`)).join(' | ')}`);
    log(`not paused: status="${studio.debug.statusLine()}" events=${JSON.stringify(studio.emuEvents().map((x) => x.event))} lastBuild=${JSON.stringify(studio.lastBuild()?.ok)}`);
    throw e;
  }
  await layout('workbench');
  const sideShot = (name: string): Spec => ({
    name, layout: 'workbench', sizes: [[1400, 800], [800, 800]],
    pre: async () => { await exec('workbench.view.extension.cpcbuild'); await sleep(900); },
  });
  await capture(sideShot('symbols-registers'));
  await layout('editor');
  // the emulator tab stays open (closing it ends the session); each screen is shown with its group maximised
  const focusTab = async (re: RegExp): Promise<void> => {
    const names = ['First', 'Second', 'Third', 'Fourth', 'Fifth'];
    for (const g of vscode.window.tabGroups.all) {
      const i = g.tabs.findIndex((t) => re.test(t.label));
      if (i < 0) continue;
      await exec(`workbench.action.focus${names[g.viewColumn - 1]}EditorGroup`);
      await exec(`workbench.action.openEditorAtIndex${i + 1}`);
      return;
    }
    throw new Error(`no tab ${re}`);
  };
  const tabs = (): string => vscode.window.tabGroups.all.flatMap((g) => g.tabs.map((t) => `${g.viewColumn}:${t.label}`)).join(' | ');
  await studio.debug.memoryShow({ symbol: 'PutSprite' });
  await waitUntil('memory view ready', () => studio.debug.memoryStats().ready >= 1);
  await sleep(1500);
  log(`tabs: ${tabs()}`);
  await capture({
    name: 'memory', layout: 'editor', sizes: E,
    pre: async () => { await focusTab(/memory/i); await exec('workbench.action.toggleMaximizeEditorGroup'); await sleep(600); },
    post: async () => { await exec('workbench.action.toggleMaximizeEditorGroup'); },
  });
  // the emulator panel: free running (remove the breakpoint, resume)
  await exec('cpcbuild.debug.toggleBreakpoint', { symbol: 'PutSprite' });
  await exec('cpcbuild.debug.resume');
  await sleep(2500);
  await capture({
    name: 'emulator', layout: 'editor', sizes: E,
    pre: async () => { await focusTab(/emulator/i); await exec('workbench.action.toggleMaximizeEditorGroup'); await sleep(900); },
    post: async () => { await exec('workbench.action.toggleMaximizeEditorGroup'); },
  });
  await capture({
    name: 'emulator-narrow', layout: 'editor', sizes: [[420, 700], [600, 1000]],
    pre: async () => { await focusTab(/emulator/i); await exec('workbench.action.toggleMaximizeEditorGroup'); await sleep(900); },
    post: async () => { await exec('workbench.action.toggleMaximizeEditorGroup'); },
  });
  await exec('workbench.action.closeAllEditors');
  // problems from a broken file
  // the broken project is created only now: an earlier one would take over the status bar's project name
  fs.mkdirSync(path.join(ws, 'broken', 'src'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'broken', 'cpcbuild.json'), JSON.stringify({ version: 1, name: 'broken', targets: [{ id: 'bad', main: 'src/main.bas', package: 'dsk' }] }));
  fs.writeFileSync(path.join(ws, 'broken', 'src', 'main.bas'), 'DIM a AS UBYTE\nb = 3\nPRINT a +\nPRINT "x"\n');
  const bad = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(ws, 'broken', 'src', 'main.bas')));
  await vscode.window.showTextDocument(bad);
  // the Build command runs the task (terminal + problem matcher), which is what fills the Problems panel
  let ended = false;
  const sub = vscode.tasks.onDidEndTask(() => { ended = true; });
  await exec('cpcbuild.build');
  await waitUntil('the build task to end', () => ended, 60000).catch((e) => log(String(e)));
  sub.dispose();
  await sleep(1500);
  log(`problems: ${vscode.languages.getDiagnostics().flatMap(([, d]) => d).length}`);
  await capture({ name: 'problems', layout: 'panel', sizes: E, pre: async () => { await exec('workbench.panel.markers.view.focus'); await sleep(800); } });
  await exec('workbench.action.closePanel');

  await exec('workbench.action.closeAllEditors');
  log('done');
}
