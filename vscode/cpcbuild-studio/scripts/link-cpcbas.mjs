// link-cpcbas.mjs -- copies the pinned cpcbas (the compiler library the Studio runs in-process) into
// vendor/cpcbas/ (git-ignored), after checking that the checkout is at the commit cpcbas.json names.
//   vendor/cpcbas/dist/src/   the compiled library: `@cpcbuild/cpcbas` and `@cpcbuild/cpcbas/node`
//   vendor/cpcbas/lib/        cpcbas's runtime and BASIC library
//   vendor/cpcbas/LICENSE, NOTICE, version.json
// The checkout is $CPCBAS, else <cpcbuild>/../cpcbas. A different commit is a warning (an error when CI is set).
// tsconfig `paths`, the esbuild alias and the vitest alias map the package names into vendor/cpcbas/dist.
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(here, '..', '..');
const checkout = resolve(process.env.CPCBAS || join(repo, '..', 'cpcbas'));
const out = join(here, 'vendor', 'cpcbas');
const strict = !!process.env.CI && process.env.CI !== 'false';

const die = (msg) => {
  console.error(`link-cpcbas: ${msg}`);
  process.exit(1);
};
const pkgDir = join(checkout, 'packages', 'cpcbas');
if (!existsSync(join(pkgDir, 'dist', 'src', 'index.js'))) {
  die(`${pkgDir}/dist/src/index.js not found: set CPCBAS to a cpcbas checkout that is built (npm ci && npm run build there)`);
}
if (!existsSync(join(checkout, 'lib', 'runtime'))) die(`${checkout}/lib/runtime not found: CPCBAS is not a cpcbas checkout`);

const pin = JSON.parse(readFileSync(join(repo, 'cpcbas.json'), 'utf8'));
let head = '';
try {
  head = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  /* not a git checkout */
}
if (head !== pin.commit) {
  const msg = `${checkout} is at ${head || '(no git)'}, cpcbas.json pins ${pin.commit}`;
  if (strict) die(msg);
  console.warn(`link-cpcbas: warning: ${msg}`);
}
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;
if (version !== pin.version) {
  const msg = `the checkout's version is ${version}, cpcbas.json says ${pin.version}`;
  if (strict) die(msg);
  console.warn(`link-cpcbas: warning: ${msg}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'dist'), { recursive: true });
cpSync(join(pkgDir, 'dist', 'src'), join(out, 'dist', 'src'), { recursive: true, filter: (f) => !f.endsWith('.map') });
// the source maps are not copied: their comment goes too (it would point tools at files that are not here)
const strip = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) strip(f);
    else if (f.endsWith('.js')) writeFileSync(f, readFileSync(f, 'utf8').replace(/\n\/\/# sourceMappingURL=.*\s*$/, '\n'));
  }
};
strip(join(out, 'dist', 'src'));
cpSync(join(checkout, 'lib'), join(out, 'lib'), { recursive: true });
// the compiled files are ES modules (vitest reads them from here)
writeFileSync(join(out, 'dist', 'package.json'), '{ "type": "module" }\n');
for (const f of ['LICENSE', 'NOTICE']) if (existsSync(join(checkout, f))) copyFileSync(join(checkout, f), join(out, f));
writeFileSync(join(out, 'version.json'), JSON.stringify({ commit: head, version }) + '\n');
console.log(`vendor/cpcbas  ${version} (${head.slice(0, 7)})`);
