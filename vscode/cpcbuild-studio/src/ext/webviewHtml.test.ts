import { describe, expect, it } from 'vitest';
import { buildCsp, buildHtml, newNonce } from './webviewHtml';

describe('webview html', () => {
  const nonce = newNonce();
  const html = buildHtml({ cspSource: 'vscode-webview://abc', nonce, title: 'A <b> title', scriptUri: 'vscode-webview://abc/palette.js', styleUris: ['vscode-webview://abc/cb.css'] });
  it('has a strict CSP: no inline script, no remote origins, nonce only on the script', () => {
    const csp = buildCsp('vscode-webview://abc', nonce);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:/);
    expect(csp).toContain('img-src vscode-webview://abc data:');
    expect(html).toContain(`<script nonce="${nonce}" src="vscode-webview://abc/palette.js"></script>`);
    expect(html.match(/<script/g)).toHaveLength(1);
    expect(html).not.toMatch(/\son[a-z]+=/);
  });
  it('escapes the title and links the stylesheets', () => {
    expect(html).toContain('<title>A &lt;b&gt; title</title>');
    expect(html).toContain('<link rel="stylesheet" href="vscode-webview://abc/cb.css">');
  });
  it('nonces differ', () => {
    expect(newNonce()).not.toBe(newNonce());
  });
});
