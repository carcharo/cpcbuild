import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Set when launched from inside VS Code (e.g. its terminal); it makes the
  // test VS Code start as plain Node and reject its own options.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  await runTests({ extensionDevelopmentPath, extensionTestsPath, launchArgs: ['--disable-extensions'] });
}

main().catch((err) => { console.error(err); process.exit(1); });
