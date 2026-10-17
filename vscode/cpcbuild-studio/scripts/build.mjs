// build.mjs -- builds the host bundle and one bundle per webview (src/webview/<name>/main.tsx).
//   dist/extension.js            the extension host (node, cjs, vscode external)
//   dist/webview/<name>.js/.css  one per editor (browser, iife; preact bundled in)
//   dist/webview/cb.css          the shared stylesheet
//   dist/webview/codicon.css/.ttf  the icon font (webviews have a CSP: no CDN)
// Prints the sizes. Pass --watch to rebuild on change.
import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const out = join(root, 'dist', 'webview');
mkdirSync(out, { recursive: true });

const names = readdirSync(join(root, 'src', 'webview'))
  .filter((d) => existsSync(join(root, 'src', 'webview', d, 'main.tsx')));

const host = {
  entryPoints: [join(root, 'src/extension.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: join(root, 'dist/extension.js'),
  logLevel: 'warning',
  sourcemap: watch,
};
const web = {
  entryPoints: Object.fromEntries(names.map((n) => [n, join(root, 'src/webview', n, 'main.tsx')])),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  jsx: 'automatic',
  jsxImportSource: 'preact',
  outdir: out,
  minify: !watch,
  sourcemap: watch,
  metafile: true,
  logLevel: 'warning',
};

function copyStatic() {
  copyFileSync(join(root, 'src/webview/shared/cb.css'), join(out, 'cb.css'));
  const cod = join(root, 'node_modules/@vscode/codicons/dist');
  copyFileSync(join(cod, 'codicon.css'), join(out, 'codicon.css'));
  copyFileSync(join(cod, 'codicon.ttf'), join(out, 'codicon.ttf'));
}

const kb = (f) => (statSync(f).size / 1024).toFixed(1) + ' KiB';
if (watch) {
  copyStatic();
  const a = await esbuild.context(host), b = await esbuild.context(web);
  await Promise.all([a.watch(), b.watch()]);
  console.log('watching...');
} else {
  await esbuild.build(host);
  const r = await esbuild.build(web);
  copyStatic();
  console.log(`dist/extension.js  ${kb(join(root, 'dist/extension.js'))}`);
  for (const f of Object.keys(r.metafile.outputs).sort()) console.log(`${f.replace(root + '/', '')}  ${kb(join(root, f))}`);
  for (const f of ['cb.css', 'codicon.css', 'codicon.ttf']) console.log(`dist/webview/${f}  ${kb(join(out, f))}`);
}
