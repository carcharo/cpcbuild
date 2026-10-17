// Bundles the extension host (node, cjs), the webview page and the audio worklet (browser, iife) into dist/.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const common = { bundle: true, sourcemap: false, logLevel: 'warning' };
await build({ ...common, entryPoints: [path.join(root, 'src/ext/extension.ts')], platform: 'node', format: 'cjs', external: ['vscode'], outfile: path.join(dist, 'extension.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/webview/main.ts')], platform: 'browser', format: 'iife', target: 'es2022', outfile: path.join(dist, 'webview.js') });
await build({ ...common, entryPoints: [path.join(root, 'src/webview/worklet.ts')], platform: 'browser', format: 'iife', target: 'es2022', outfile: path.join(dist, 'worklet.js') });
fs.copyFileSync(path.join(root, 'src/webview/webview.css'), path.join(dist, 'webview.css'));
console.log('built dist/');
