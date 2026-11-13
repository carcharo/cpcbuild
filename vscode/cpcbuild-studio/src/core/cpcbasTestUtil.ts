/** Test-only (uses node): the pinned cpcbas (vendor/cpcbas, see scripts/link-cpcbas.mjs) as the tests use it. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compile, diagnosticToJson, type CompileResult, type FileTree } from '@cpcbuild/cpcbas';
import { loadRuntime } from '@cpcbuild/cpcbas/node';

/** vendor/cpcbas: `lib/` is the library, `dist/` the compiler. */
export const VENDOR = path.resolve(__dirname, '..', '..', 'vendor', 'cpcbas');
export const LIB_DIR = path.join(VENDOR, 'lib');

export const runtime = (): FileTree => loadRuntime(LIB_DIR);

/** Compiles `main` of a folder tree given as a map of path to text (a full build, no parse-only), with the bundled library. */
export function compileFiles(files: Map<string, string | Uint8Array>, main: string, defines: Record<string, string> = {}, format: 'bin' | 'dsk' | 'cpr' | 'none' = 'bin'): CompileResult {
  return compile({ files, main, defines, runtime: runtime(), options: { format, dskName: 'MAIN.BIN', buildDate: '2026-01-01' } });
}

/** The error diagnostics of a result as `file:line:col CODE message`, for readable failures. */
export function errorsOf(r: CompileResult): string[] {
  return r.diagnostics.filter((d) => d.severity === 'error').map((d) => diagnosticToJson(d, r.sources)).map((j) => `${j.file}:${j.line}:${j.col} ${j.code} ${j.message}`);
}

/**
 * Copies a fixture folder of this package (src/core/fixtures/<name>) to a new temporary folder and returns it. The
 * fixture files carry a `.txt` suffix (so that the repository's tooling does not mistake Boriel BASIC samples for
 * programs); the copy has the real names.
 */
export function copyFixture(name: string): string {
  const src = path.resolve(__dirname, 'fixtures', name);
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-fx-'));
  const walk = (rel: string): void => {
    for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else {
        const out = path.join(dst, r.replace(/\.txt$/, ''));
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.copyFileSync(path.join(src, r), out);
      }
    }
  };
  walk('');
  return dst;
}
