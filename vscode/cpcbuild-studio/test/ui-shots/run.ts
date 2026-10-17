/**
 * Screenshot harness driver. Starts VS Code (test-electron) with Studio and cpcbuild-emu loaded and a remote
 * debugging port, then answers the extension host (host.ts) over a file handshake: set the window size, take a
 * page screenshot through the DevTools protocol (puppeteer-core). No macOS screen-recording permission and no
 * visible-window dependency; the window may be hidden behind others.
 *   UI_SHOTS_PUPPETEER=<dir with node_modules/puppeteer-core>  UI_SHOTS_OUT=<dir>  node out/test/ui-shots/run.js
 * Optional: CPCBUILD_SHOTS_ONLY=palette-cpcpal,tmx   CPCBUILD_SHOTS_THEMES=dark,light
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { generateTemplate } from '../../src/core/templates';
import { serialiseRecipe, type Recipe } from '../../src/core/cpcimp';

const PORT = 9347;
const REPO = path.resolve(__dirname, '../../../../../..');

function makeWorkspace(extRoot: string): string {
  const repo = path.resolve(extRoot, '..', '..');
  const zxbasic = process.env.ZXBASIC ?? '/Users/barry/RetroDev/Amstrad/zxbasic';
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcshot-ws-'));
  const put = (rel: string, text: string): void => {
    const f = path.join(ws, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  const copy = (rel: string, as = rel): void => {
    const dst = path.join(ws, as);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dst);
  };
  for (const [rel, text] of Object.entries(generateTemplate('firmware', { name: 'tplfw' }).files)) put(rel, text);
  const dev = JSON.parse(
    fs.readFileSync(path.join(extRoot, 'test', 'fixtures', 'dev-settings.json'), 'utf8').replace(/\$\{repo\}/g, repo).replace(/\$\{zxbasic\}/g, zxbasic),
  ) as Record<string, unknown>;
  delete dev['cpcbuild.run.emulator'];
  delete dev['cpcbuild.run.customCommand'];
  dev['cpcbuild.build.org'] = '0x4000';
  put('.vscode/settings.json', JSON.stringify(dev, null, 2));
  copy('examples/assets/balls.png', 'assets/balls.png');
  copy('examples/assets/bounce.pal', 'assets/bounce.pal');
  const r: Recipe = {
    format: 'cpcimp', version: 1, source: 'assets/balls.png', output: 'assets/balls.bas', target: 'cpc', mode: 0, name: 'balls',
    kind: 'sprite', frame: '8x16', masked: true, palette: { file: 'assets/bounce.pal' }, emitPalette: false,
  };
  put('assets/balls.cpcimp', serialiseRecipe(r));
  copy('examples/assets/level.tmx', 'maps/level.tmx');
  copy('examples/assets/bgtiles.png', 'maps/bgtiles.png');
  return ws;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function driver(syncDir: string, outDir: string, stop: () => boolean): Promise<void> {
  const pptr = require(require.resolve('puppeteer-core', { paths: [process.env.UI_SHOTS_PUPPETEER as string] }));
  let browser: any;
  for (let i = 0; i < 120 && !browser; i++) {
    try {
      browser = await pptr.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  if (!browser) throw new Error('could not attach to VS Code on the debug port');
  const findPage = async (): Promise<any> => {
    for (let i = 0; i < 60; i++) {
      const pages: any[] = await browser.pages();
      const p = pages.find((x) => /workbench\.html/.test(x.url()));
      if (p) return p;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('no workbench page');
  };
  const page = await findPage();
  const cdp = await page.createCDPSession();
  const done = new Set<string>();
  while (!stop()) {
    const reqs = fs.readdirSync(syncDir).filter((f) => /^req-\d+\.json$/.test(f)).sort();
    for (const f of reqs) {
      const n = f.slice(4, 8);
      if (done.has(n)) continue;
      const req = JSON.parse(fs.readFileSync(path.join(syncDir, f), 'utf8'));
      try {
        if (req.type === 'viewport') {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: req.width, height: req.height, deviceScaleFactor: 1, mobile: false });
        } else if (req.type === 'shot') {
          const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
          fs.writeFileSync(path.join(outDir, req.file), Buffer.from(data, 'base64'));
          console.log(`  shot ${req.file}`);
        }
      } catch (e) {
        console.log(`  ERROR ${f}: ${(e as Error).message}`);
      }
      done.add(n);
      fs.writeFileSync(path.join(syncDir, `done-${n}`), '');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  browser.disconnect();
}

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const studio = path.resolve(__dirname, '../../..');
  const emu = path.resolve(studio, '..', 'cpcbuild-emu');
  const outDir = process.env.UI_SHOTS_OUT as string;
  if (!outDir || !process.env.UI_SHOTS_PUPPETEER) throw new Error('set UI_SHOTS_OUT and UI_SHOTS_PUPPETEER');
  fs.mkdirSync(outDir, { recursive: true });
  const ws = makeWorkspace(studio);
  const syncDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcsync-'));
  process.env.CPCBUILD_TEST_WORKSPACE = ws;
  process.env.CPCBUILD_SHOTS_SYNC = syncDir;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcud-'));
  let finished = false;
  const drv = driver(syncDir, outDir, () => finished);
  try {
    await runTests({
      extensionDevelopmentPath: [studio, emu],
      extensionTestsPath: path.resolve(__dirname, './host'),
      launchArgs: [ws, '--disable-extensions', `--user-data-dir=${userData}`, `--remote-debugging-port=${PORT}`, '--disable-workspace-trust', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling', '--skip-welcome', '--skip-release-notes'],
    });
  } finally {
    finished = true;
    await drv.catch((e) => console.log('driver:', e.message));
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    fs.rmSync(syncDir, { recursive: true, force: true });
  }
}
void REPO;
main().catch((err) => { console.error(err); process.exit(1); });
