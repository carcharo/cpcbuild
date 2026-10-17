/**
 * The integration run: Studio and cpcbuild-emu loaded together in one extension host (the unit and
 * extension-host suites of each stay separate and load only their own extension). Builds a template
 * project, runs it in the emulator through Studio's Run command and drives the debug controls.
 *   npm run test:integration   (needs cpcbuild-emu built: `npm run build` in vscode/cpcbuild-emu)
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { generateTemplate } from '../src/core/templates';
import { findZxbasic } from '../src/core/testutil';

function makeWorkspace(extRoot: string): string {
  const repo = path.resolve(extRoot, '..', '..');
  const zxbasic = findZxbasic(extRoot);
  if (!zxbasic) throw new Error('the zxbasic checkout was not found: set ZXBASIC, or put it next to the cpcbuild checkout (../zxbasic)');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-int-'));
  for (const [rel, text] of Object.entries(generateTemplate('firmware', { name: 'tplfw' }).files)) {
    const f = path.join(ws, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  // the dev settings (how to start the compiler here), minus the studio-only "custom emulator" run: this run uses cpcbuild-emu
  const dev = JSON.parse(
    fs.readFileSync(path.join(extRoot, 'test', 'fixtures', 'dev-settings.json'), 'utf8').replace(/\$\{repo\}/g, repo).replace(/\$\{zxbasic\}/g, zxbasic),
  ) as Record<string, unknown>;
  delete dev['cpcbuild.run.emulator'];
  delete dev['cpcbuild.run.customCommand'];
  // org &4000: no firmware ROM code runs at the program's addresses, so a breakpoint at a routine is only ever hit by the program
  dev['cpcbuild.build.org'] = '0x4000';
  fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.vscode', 'settings.json'), JSON.stringify(dev, null, 2));
  return ws;
}

async function main(): Promise<void> {
  delete process.env.ELECTRON_RUN_AS_NODE;
  const studio = path.resolve(__dirname, '../..');
  const emu = path.resolve(studio, '..', 'cpcbuild-emu');
  if (!fs.existsSync(path.join(emu, 'dist', 'extension.js'))) {
    console.error(`cpcbuild-emu is not built (no ${path.join(emu, 'dist', 'extension.js')}). Run "npm run build" in ${emu} first.`);
    process.exit(2);
  }
  const ws = makeWorkspace(studio);
  process.env.CPCBUILD_TEST_WORKSPACE = ws;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcud-'));
  try {
    await runTests({
      extensionDevelopmentPath: [studio, emu],
      extensionTestsPath: path.resolve(__dirname, './integration/index'),
      launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`],
    });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
