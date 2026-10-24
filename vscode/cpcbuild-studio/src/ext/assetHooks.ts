/**
 * assetHooks.ts -- "CPC Game Studio: Generate Asset File" is one command for every document type that has an
 * output file (sprites, tile sets, importer recipes). Each owner registers a generator that returns
 * undefined for files it does not handle; the command asks them in turn.
 */
import * as vscode from 'vscode';

export type AssetGenerator = (uri: vscode.Uri | undefined) => Promise<unknown | undefined>;

const generators: AssetGenerator[] = [];

/** Adds a generator; returns a disposable that removes it. */
export function registerAssetGenerator(g: AssetGenerator): vscode.Disposable {
  generators.push(g);
  return new vscode.Disposable(() => {
    const i = generators.indexOf(g);
    if (i >= 0) generators.splice(i, 1);
  });
}

export async function generateAssetFileCommand(uri?: vscode.Uri): Promise<unknown> {
  for (const g of [...generators]) {
    const r = await g(uri);
    if (r !== undefined) return r;
  }
  void vscode.window.showInformationMessage('CPC Game Studio: open a sprite, tile set or import recipe to generate its file.');
  return { unsupported: true };
}
