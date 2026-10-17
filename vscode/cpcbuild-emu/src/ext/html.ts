import * as vscode from 'vscode';
import type { WebviewBoot } from '../shared/protocol';
import { nonce } from './nonce';

export const ROMS = ['cpc464.rom', 'cpc664.rom', 'cpc6128.rom', 'cpcplus.rom', 'cpcados.rom'];

/** The page: strict CSP (wasm needs 'wasm-unsafe-eval'), codicons, toolbar, the canvas. */
export function pageHtml(webview: vscode.Webview, ext: vscode.Uri, runHidden: boolean): string {
  const u = (...p: string[]): string => webview.asWebviewUri(vscode.Uri.joinPath(ext, ...p)).toString();
  const boot: WebviewBoot = {
    cpcecJs: u('wasm', 'cpcec.js'),
    cpcecWasm: u('wasm', 'cpcec.wasm'),
    worklet: u('dist', 'worklet.js'),
    roms: Object.fromEntries(ROMS.map((r) => [r, u('media', 'roms', r)])),
    runHidden,
  };
  const n = nonce(), c = webview.cspSource;
  const csp = [
    `default-src 'none'`,
    `img-src ${c} data: blob:`,
    `style-src ${c}`,
    `font-src ${c}`,
    `script-src 'nonce-${n}' ${c} 'wasm-unsafe-eval'`,
    `connect-src ${c}`,
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CPC Emulator</title>
<link rel="stylesheet" href="${u('media', 'codicons', 'codicon.css')}">
<link rel="stylesheet" href="${u('dist', 'webview.css')}">
</head>
<body>
<div id="bar" role="toolbar" aria-label="Emulator controls">
  <button id="reset" type="button" title="Reset" aria-label="Reset"><span class="codicon codicon-debug-restart" aria-hidden="true"></span></button>
  <button id="pause" type="button" title="Pause" aria-label="Pause"><span class="codicon codicon-debug-pause" aria-hidden="true"></span></button>
  <span id="model">CPC</span>
  <span id="status" role="status">No program loaded</span>
  <span class="grow"></span>
  <span id="hint">Ctrl+Shift+Esc leaves the keyboard</span>
  <button id="sound" type="button" title="Browsers allow sound only after a click" aria-label="Click for sound"><span class="codicon codicon-unmute" aria-hidden="true"></span>Click for sound</button>
</div>
<div id="stage"><canvas id="screen" width="768" height="536" tabindex="0" role="application" aria-label="Amstrad CPC screen. Click to focus; your keys go to the CPC. Ctrl+Shift+Escape returns to the toolbar."></canvas></div>
<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script nonce="${n}" src="${u('dist', 'webview.js')}"></script>
</body>
</html>`;
}
