// link-cpcbas.mjs -- copies the pinned cpcbas build into vendor/cpcbas/ (git-ignored), so the extension, its
// tests and its generators import the compiler from one place:
//   vendor/cpcbas/dist/   packages/cpcbas/dist of the checkout $CPCBAS (the library and its Node helpers)
//   vendor/cpcbas/lib/    its lib/ (the BASIC library and the runtime)
// The checkout's HEAD is compared with cpcbas.json at the repository root: a different commit is a warning
// (an error when CI is set). CPCBAS defaults to <repository>/../cpcbas.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(here, '..', '..');
const cpcbas = resolve(process.env.CPCBAS || join(repo, '..', 'cpcbas'));
const dist = join(cpcbas, 'packages', 'cpcbas', 'dist');
const lib = join(cpcbas, 'lib');
if (!existsSync(join(dist, 'src', 'index.js')) || !existsSync(join(lib, 'cpcbuild.bas'))) {
  console.error(`link-cpcbas: no built cpcbas at ${cpcbas} (set CPCBAS to a checkout where \`npm ci && npm run build\` has run)`);
  process.exit(1);
}
try {
  const pin = JSON.parse(readFileSync(join(repo, 'cpcbas.json'), 'utf8')).commit;
  const head = execFileSync('git', ['-C', cpcbas, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (head !== pin) {
    const msg = `link-cpcbas: ${cpcbas} is at ${head.slice(0, 7)}, cpcbas.json pins ${pin.slice(0, 7)}`;
    if (process.env.CI) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(`warning: ${msg}`);
  }
} catch (e) {
  if (process.env.CI) throw e;
}
const out = join(here, 'vendor', 'cpcbas');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(dist, join(out, 'dist'), { recursive: true, filter: (s) => !/[\\/]dist[\\/]lib([\\/]|$)/.test(s) && !s.endsWith('.map') });
cpSync(lib, join(out, 'lib'), { recursive: true });
// the copy is ES modules, like the package it comes from
writeFileSync(join(out, 'package.json'), '{ "type": "module" }\n');
console.log(`vendor/cpcbas  from ${cpcbas}`);
