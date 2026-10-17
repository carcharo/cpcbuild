import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Set when launched from inside VS Code (e.g. its terminal); it makes the
  // test VS Code start as plain Node and reject its own options.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcemu-ws-'));
  process.env.CPCEMU_MEDIA = path.join(extensionDevelopmentPath, 'test', '.media');
  process.env.CPCEMU_TEST_HOOKS = '1'; // registers cpcbuild.emu._probeAudio (never in a packaged run)
  process.env.CPCEMU_LOG ??= path.join(os.tmpdir(), 'cpcemu-test.log');
  fs.rmSync(process.env.CPCEMU_LOG, { force: true });
  // a short user-data dir: the default under .vscode-test is too long for the IPC socket in a deep checkout
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcud-'));
  await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: [ws, '--disable-extensions', `--user-data-dir=${userData}`] });
}

main().catch((err) => { console.error(err); process.exit(1); });
