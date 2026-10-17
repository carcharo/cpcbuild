/**
 * webviewHtml.ts -- the HTML shell of every Studio webview: strict CSP (no inline script, a nonce on
 * the one script tag, images only from the webview's own resources and data:), the shared
 * stylesheets, and the bundle dist/webview/<name>.js. The pure part (buildHtml) has no vscode
 * import so vitest can check the policy.
 */
import { randomBytes } from 'node:crypto';
import type * as vscode from 'vscode';

export interface HtmlParts {
  cspSource: string;
  nonce: string;
  title: string;
  scriptUri: string;
  styleUris: string[];
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export function buildCsp(cspSource: string, nonce: string): string {
  return [
    "default-src 'none'",
    `img-src ${cspSource} data:`,
    `style-src ${cspSource}`,
    `font-src ${cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
}

export function buildHtml(p: HtmlParts): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${esc(buildCsp(p.cspSource, p.nonce))}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.title)}</title>
${p.styleUris.map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join('\n')}
</head>
<body>
<div id="root"></div>
<script nonce="${p.nonce}" src="${esc(p.scriptUri)}"></script>
</body>
</html>
`;
}

export const newNonce = (): string => randomBytes(16).toString('base64url');

/** Resources a webview may load: dist/webview. Set as localResourceRoots. */
export function webviewRoot(vs: typeof vscode, extensionUri: vscode.Uri): vscode.Uri {
  return vs.Uri.joinPath(extensionUri, 'dist', 'webview');
}

/** The page for bundle dist/webview/<bundle>.js (plus cb.css and the codicon font stylesheet). */
export function webviewHtml(vs: typeof vscode, webview: vscode.Webview, extensionUri: vscode.Uri, bundle: string, title: string): string {
  const root = webviewRoot(vs, extensionUri);
  const uri = (f: string): string => webview.asWebviewUri(vs.Uri.joinPath(root, f)).toString();
  return buildHtml({ cspSource: webview.cspSource, nonce: newNonce(), title, scriptUri: uri(`${bundle}.js`), styleUris: [uri('codicon.css'), uri('cb.css'), uri(`${bundle}.css`)] });
}
