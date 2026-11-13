// bundle.mjs -- copies the compiler's library and the Python tools into bundled/ so the packaged
// extension works without a checkout. The output folder is gitignored and listed in .vscodeignore.
// The library must be the one that matches the compiler in dist/extension.js, so it comes from the
// same pinned cpcbas checkout (scripts/link-cpcbas.mjs copies it into vendor/cpcbas first).
//   bundled/lib/                 cpcbas's lib/ (BASIC and asm sources, music/LICENSE.arkos)
//   bundled/tools/*.py           the converters Studio runs: img2cpc, tmx2bas, aks2bas, mkcpr
//   bundled/docs/library.md      the library reference (hover and docs)
//   bundled/NOTICE               cpcbas's notices
import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(here, '..', '..');
const vendor = join(here, 'vendor', 'cpcbas');
const out = join(here, 'bundled');
const TOOLS = ['img2cpc.py', 'tmx2bas.py', 'aks2bas.py', 'mkcpr.py'];

if (!existsSync(join(vendor, 'lib', 'runtime'))) {
  console.error(`bundle: ${vendor}/lib not found: run scripts/link-cpcbas.mjs first (it copies the pinned cpcbas)`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'tools'), { recursive: true });
mkdirSync(join(out, 'docs'), { recursive: true });
cpSync(join(vendor, 'lib'), join(out, 'lib'), { recursive: true });
for (const t of TOOLS) copyFileSync(join(repo, 'tools', t), join(out, 'tools', t));
copyFileSync(join(repo, 'docs', 'library.md'), join(out, 'docs', 'library.md'));
if (existsSync(join(vendor, 'NOTICE'))) copyFileSync(join(vendor, 'NOTICE'), join(out, 'NOTICE'));

const count = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0);
console.log(`bundled/  ${count(out)} files (lib, ${TOOLS.length} tools, docs/library.md, NOTICE)`);
