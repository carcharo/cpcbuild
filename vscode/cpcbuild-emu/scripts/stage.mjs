// Stages the git-ignored files the extension needs at run time: the CPC ROMs that come with CPCEC
// (media/roms/, copied from tools/cpcec/work, made by `make cpcec`) and the codicon font (media/codicons/).
// Run by `npm run build`; fails with a clear message when something is missing.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(root, '..', '..');
const ROMS = ['cpc464.rom', 'cpc664.rom', 'cpc6128.rom', 'cpcplus.rom', 'cpcados.rom'];

function findWork() {
  const cands = [];
  if (process.env.CPCEC_WORK) cands.push(process.env.CPCEC_WORK);
  cands.push(path.join(repo, 'tools', 'cpcec', 'work'));
  try { // a git worktree: the main checkout holds the (git-ignored) work directory
    const common = execFileSync('git', ['-C', repo, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' }).trim();
    cands.push(path.join(path.resolve(repo, common, '..'), 'tools', 'cpcec', 'work'));
  } catch { /* not a git checkout */ }
  for (const c of cands) if (fs.existsSync(path.join(c, 'cpc6128.rom'))) return c;
  throw new Error('CPCEC ROMs not found (run make cpcec, or set CPCEC_WORK): tried ' + cands.join(', '));
}

const work = findWork();
const roms = path.join(root, 'media', 'roms');
fs.mkdirSync(roms, { recursive: true });
for (const r of ROMS) fs.copyFileSync(path.join(work, r), path.join(roms, r));
for (const f of ['LICENSE.cpcec-gpl3', 'gpl.txt']) {
  const src = path.join(work, f);
  if (fs.existsSync(src) && !fs.existsSync(path.join(root, 'LICENSE'))) fs.copyFileSync(src, path.join(root, 'LICENSE'));
}
if (!fs.existsSync(path.join(root, 'wasm', 'cpcec.wasm'))) {
  throw new Error('wasm/cpcec.wasm is missing: run EMSDK=... sh tools/cpcec/wasm/build-host.sh from the repo root');
}

const cod = path.join(root, 'media', 'codicons');
fs.mkdirSync(cod, { recursive: true });
const pkg = path.join(root, 'node_modules', '@vscode', 'codicons', 'dist');
for (const f of ['codicon.css', 'codicon.ttf']) fs.copyFileSync(path.join(pkg, f), path.join(cod, f));
console.log('staged ROMs, LICENSE and codicons');
