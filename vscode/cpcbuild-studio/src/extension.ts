import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('cpcbuild.hello', () => 'CPCBuild Studio'),
  );
}

export function deactivate(): void {}
