// bundle.mjs -- copies the cpcbuild library and the Python tools into bundled/ so the packaged
// extension works without a checkout (spec 9). The output folder is gitignored and listed in
// .vscodeignore. The compiler's mkdsk.py is AGPL (the zxbasic repo) and is deliberately not copied.
//   bundled/lib/              the whole of lib/ (BASIC and asm sources, music/LICENSE.arkos)
//   bundled/tools/*.py        the converters Studio runs: img2cpc, tmx2bas, aks2bas, mkcpr
//   bundled/docs/library.md   the library reference (hover and docs)
//   bundled/LICENSE           the MIT licence of those files
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(here, '..', '..');
const out = join(here, 'bundled');
const TOOLS = ['img2cpc.py', 'tmx2bas.py', 'aks2bas.py', 'mkcpr.py'];

if (!existsSync(join(repo, 'lib', 'cpcbuild.bas'))) {
  console.error(`bundle: ${join(repo, 'lib')} not found: build from the cpcbuild repository`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'tools'), { recursive: true });
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(repo, 'lib'), join(out, 'lib'), { recursive: true });
for (const t of TOOLS) copyFileSync(join(repo, 'tools', t), join(out, 'tools', t));
copyFileSync(join(repo, 'docs', 'library.md'), join(out, 'docs', 'library.md'));
copyFileSync(join(repo, 'LICENSE'), join(out, 'LICENSE'));

const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`bundled/  ${count(out)} files (lib, ${TOOLS.length} tools, docs/library.md)`);
