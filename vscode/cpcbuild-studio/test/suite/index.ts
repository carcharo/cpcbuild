import * as assert from 'assert';
import * as vscode from 'vscode';

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension('cpcbuild.cpcbuild-studio');
  assert.ok(ext, 'extension not found');
  await ext!.activate();
  const r = await vscode.commands.executeCommand('cpcbuild.hello');
  assert.strictEqual(r, 'CPCBuild Studio');
  console.log('smoke: ok');
}
