// Headless check of the CPCEC WebAssembly build: serve
// tools/cpcec/work/wasm/out, load it in Chrome, let it run, save a
// screenshot of the canvas and report the frame rate CPCEC prints.
//   node test/wasm-smoke.mjs [seconds] [out.png]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../tools/cpcec/work/wasm/out');
const seconds = Number(process.argv[2] ?? 6);
const shot = process.argv[3] ?? path.join(here, '../out/wasm-smoke.png');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.data': 'application/octet-stream' };

const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const logs = [];
try {
  const page = await browser.newPage();
  page.on('console', (m) => logs.push(m.text()));
  page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
  await page.goto(url);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  const canvas = await page.$('canvas');
  await (canvas ?? page).screenshot({ path: shot });
} finally {
  await browser.close();
  server.close();
}
const fps = logs.filter((l) => /fps/i.test(l));
console.log('console lines:', logs.length, '| last fps lines:', fps.slice(-3).join(' / ') || 'none');
const errs = logs.filter((l) => /pageerror|abort|exception/i.test(l));
if (errs.length) { console.log('errors:', errs.join('\n')); process.exit(1); }
console.log('screenshot:', shot);
