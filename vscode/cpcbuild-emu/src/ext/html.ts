import * as vscode from 'vscode';
import type { WebviewBoot } from '../shared/protocol';
import { leaveKeyText, leaveKeys } from '../shared/chrome';
import { nonce } from './nonce';

export const ROMS = ['cpc464.rom', 'cpc664.rom', 'cpc6128.rom', 'cpcplus.rom', 'cpcados.rom'];

/** The page: strict CSP (wasm needs 'wasm-unsafe-eval'), codicons, toolbar, the canvas. */
/** The keys that leave the keyboard trap (both work everywhere): Windows keeps Ctrl+Shift+Esc for Task Manager. */
export const LEAVE_KEY = leaveKeyText(process.platform);

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
<link rel="stylesheet" href="${u('dist', 'pod.css')}">
<link rel="stylesheet" href="${u('dist', 'webview.css')}">
</head>
<body>
<div id="top">
  <span id="model" class="cb-stat">CPC 6128</span>
  <span id="status" class="cb-stat" role="status"><span id="dot" aria-hidden="true">\u25cf</span><span id="statusText">No program loaded</span></span>
</div>
<div id="stage"><div id="frame"><canvas id="screen" width="768" height="536" tabindex="0" role="application" aria-label="Amstrad CPC screen. Click to focus; your keys go to the CPC. ${LEAVE_KEY} returns to the controls."></canvas></div></div>
<div id="foot">
  <div id="bar" class="cb-pod" role="toolbar" aria-label="Emulator controls">
    <button id="pause" class="cb-pod-main" type="button" title="Pause" aria-label="Pause"><span class="codicon codicon-debug-pause" aria-hidden="true"></span></button>
    <button id="reset" class="cb-pod-btn" type="button" title="Reset" aria-label="Reset"><span class="codicon codicon-debug-restart" aria-hidden="true"></span></button>
    <span id="soundSep" class="cb-pod-sep" aria-hidden="true"></span>
    <button id="sound" class="cb-pill" type="button" title="Browsers allow sound only after a click" aria-label="Click for sound"><span class="codicon codicon-unmute" aria-hidden="true"></span><span class="lbl">Click for sound</span></button>
  </div>
  <span id="hint" role="img" aria-label="${LEAVE_KEY} leaves the keyboard"><span class="cb-kbd-group">${leaveKeys(process.platform).map((k) => `<kbd class="cb-kbd">${k}</kbd>`).join('')}</span> leaves the keyboard</span>
</div>
<script type="application/json" id="boot">${JSON.stringify(boot).replace(/</g, '\\u003c')}</script>
<script nonce="${n}" src="${u('dist', 'webview.js')}"></script>
</body>
</html>`;
}
