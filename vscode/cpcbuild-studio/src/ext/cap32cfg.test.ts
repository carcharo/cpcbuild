import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { scratchDir } from '../core/testutil';
import { cap32Config } from './cap32cfg';

const base = scratchDir('cap32cfg-');
afterAll(() => fs.rmSync(base, { recursive: true, force: true }));
const emu = path.join(base, 'emu');
fs.mkdirSync(emu);
fs.writeFileSync(path.join(emu, 'cap32.cfg.tmpl'), 'rom_path=__SHARE_PATH__/rom\n');
const bin = path.join(emu, 'cap32');

describe('cap32Config', () => {
  it('prefers a cap32.cfg beside the binary', () => {
    const d = path.join(base, 'with'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'cap32.cfg'), 'x');
    expect(cap32Config(path.join(d, 'cap32'))).toBe(path.join(d, 'cap32.cfg'));
    expect(cap32Config(path.join(base, 'none', 'cap32'))).toBeUndefined();
  });
  it('fills the template into the storage folder when given', () => {
    const store = path.join(base, 'storage', 'deep');
    const out = cap32Config(bin, store)!;
    expect(out).toBe(path.join(store, 'cap32.cfg'));
    expect(fs.readFileSync(out, 'utf8')).toBe(`rom_path=${emu}/rom\n`);
  });
  it('without a storage folder uses a fresh private mkdtemp folder, never a fixed name in the temp dir', () => {
    const a = cap32Config(bin)!, b = cap32Config(bin)!;
    expect(a).not.toBe(b);
    expect(path.dirname(a).startsWith(path.join(os.tmpdir(), 'cpcbuild-studio-'))).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(path.dirname(a)).mode & 0o077).toBe(0);
    fs.rmSync(path.dirname(a), { recursive: true }); fs.rmSync(path.dirname(b), { recursive: true });
  });
  it('does not write through a planted symlink', () => {
    const store = path.join(base, 'planted'); fs.mkdirSync(store);
    const victim = path.join(base, 'victim.txt'); fs.writeFileSync(victim, 'keep');
    fs.symlinkSync(victim, path.join(store, 'cap32.cfg'));
    const out = cap32Config(bin, store)!;
    expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
    expect(fs.lstatSync(out).isSymbolicLink()).toBe(false);
  });
});
