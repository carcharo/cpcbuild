import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { generateTemplate } from '../src/core/templates';
import { findZxbasic, PYTHON_ABS } from '../src/core/testutil';

/** `s` as it goes inside a JSON string (a Windows path has backslashes). */
const jsonText = (s: string): string => JSON.stringify(s).slice(1, -1);

/** The temp workspace the tests open: a firmware-template project plus a deliberately broken one and an invalid one. */
function makeWorkspace(extRoot: string): string {
  const repo = path.resolve(extRoot, '..', '..');
  const zxbasic = findZxbasic(extRoot);
  if (!zxbasic) throw new Error('the zxbasic checkout was not found: set ZXBASIC, or put it next to the cpcbuild checkout (../zxbasic)');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-ws-'));
  const put = (rel: string, text: string): void => {
    const f = path.join(ws, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  };
  for (const [rel, text] of Object.entries(generateTemplate('firmware', { name: 'tplfw' }).files)) put(rel, text);
  // the dev settings: how to start the compiler on this machine (a test settings file, never hardcoded in the extension)
  const settings = fs
    .readFileSync(path.join(extRoot, 'test', 'fixtures', 'dev-settings.json'), 'utf8')
    .replace(/\$\{repo\}/g, () => jsonText(repo))
    .replace(/\$\{zxbasic\}/g, () => jsonText(zxbasic))
    .replace(/\$\{python\}/g, () => jsonText(PYTHON_ABS))
    .replace(/\$\{node\}/g, () => jsonText(process.execPath))
    .replace(/\$\{touch\}/g, () => jsonText(path.join(extRoot, 'test', 'fixtures', 'touch.js')));
  put('.vscode/settings.json', settings);
  put('broken/cpcbuild.json', JSON.stringify({ version: 1, name: 'broken', targets: [{ id: 'bad', main: 'src/main.bas', package: 'dsk' }] }));
  put('broken/src/main.bas', 'DIM a AS UBYTE\nb = 3\nPRINT a +\nPRINT "x"\n');
  put('invalid/cpcbuild.json', JSON.stringify({ version: 1, name: 'invalid', targets: [{ id: 'cart', main: 'src/main.bas', package: 'cpr' }] }, null, 2));
  return ws;
}

async function main(): Promise<void> {
  // Set when launched from inside VS Code (e.g. its terminal); it makes the
  // test VS Code start as plain Node and reject its own options.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const ws = makeWorkspace(extensionDevelopmentPath);
  process.env.CPCBUILD_TEST_WORKSPACE = ws;
  // the Python (with Pillow) the tests call directly; the host's PATH may find another one first (a login shell's)
  process.env.CPCBUILD_TEST_PYTHON = PYTHON_ABS;
  // a short user-data dir: the default under .vscode-test is too long for the IPC socket in a deep checkout
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcud-'));
  try {
    await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [ws, '--disable-extensions', '--disable-workspace-trust', `--user-data-dir=${userData}`] });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
