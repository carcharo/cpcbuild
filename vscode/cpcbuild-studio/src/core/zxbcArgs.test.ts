import { describe, expect, it } from 'vitest';
import { translateZxbcArgs, zxbcMigrationMessage } from './zxbcArgs';

describe('translateZxbcArgs', () => {
  it('maps the options that exist in cpcbas', () => {
    expect(translateZxbcArgs(['-O', '2', '-H', '4096', '--heap-address', '0x9000', '-S', '0x8000', '-D', 'FOO=1', '-I', 'inc']).args).toEqual([
      '-O', '2', '--heap', '4096', '--heap-address', '0x9000', '--org', '0x8000', '-D', 'FOO=1', '-I', 'inc',
    ]);
  });
  it('knows the joined and long spellings; -O above 3 is 3', () => {
    expect(translateZxbcArgs(['-O4', '-H100', '--heap-size=200', '--org=0x4000', '-DX', '-Isrc', '-S31744']).args).toEqual([
      '-O', '3', '--heap', '100', '--heap', '200', '--org', '0x4000', '-D', 'X', '-I', 'src', '--org', '31744',
    ]);
  });
  it('drops what the Studio sets, silently, with the values of those that take one', () => {
    const t = translateZxbcArgs(['--arch', 'cpc', '-f', 'bin', '-o', 'x.bin', '-M', 'x.map', '-B', '-a', '--autorun', '--BASIC', '-O', '1']);
    expect(t).toEqual({ args: ['-O', '1'], advice: [], notTranslated: [] });
  });
  it('--enable-break is dropped with the advice', () => {
    const t = translateZxbcArgs(['--enable-break']);
    expect(t.args).toEqual([]);
    expect(zxbcMigrationMessage(t)).toContain('write ON BREAK STOP in the program');
  });
  it('names what has no equivalent', () => {
    const t = translateZxbcArgs(['--explicit', '--strict', '-W', '100', '--array-base', '1', '--string-base=1', '--sinclair', '-O', '2']);
    expect(t.notTranslated).toEqual(['--explicit', '--strict', '-W 100', '--array-base 1', '--string-base=1', '--sinclair']);
    expect(t.args).toEqual(['-O', '2']);
    const m = zxbcMigrationMessage(t);
    expect(m).toContain('"cpcbuild.compiler.args"');
    expect(m).toContain('Not translated (no equivalent): --explicit --strict -W 100');
  });
  it('an empty list translates to nothing, and the message says so', () => {
    expect(zxbcMigrationMessage(translateZxbcArgs([]))).toContain('None of the options carries over');
  });
});
