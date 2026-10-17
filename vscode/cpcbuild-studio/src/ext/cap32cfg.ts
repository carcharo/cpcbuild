/**
 * cap32cfg.ts -- the cap32.cfg handed to Caprice32 with -c. The patched build ships only cap32.cfg.tmpl
 * (ROM paths to fill in), so the filled copy has to be written somewhere. Never to a predictable file in a
 * shared temp folder (another user could plant a symlink there): into Studio's own storage folder when
 * VS Code gave one, else a fresh private mkdtemp folder. No vscode import.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** The cfg to pass: the one beside the binary, or one made from cap32.cfg.tmpl; undefined when neither exists. */
export function cap32Config(bin: string, storageDir?: string): string | undefined {
  const dir = path.dirname(bin);
  const cfg = path.join(dir, 'cap32.cfg');
  if (fs.existsSync(cfg)) return cfg;
  const tmpl = path.join(dir, 'cap32.cfg.tmpl');
  if (!fs.existsSync(tmpl)) return undefined;
  const base = storageDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-studio-')); // mkdtemp: 0700, unpredictable
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  const out = path.join(base, 'cap32.cfg');
  fs.rmSync(out, { force: true }); // never write through a symlink or into someone else's file
  fs.writeFileSync(out, fs.readFileSync(tmpl, 'utf8').replace(/__SHARE_PATH__/g, dir), { flag: 'wx', mode: 0o600 });
  return out;
}
