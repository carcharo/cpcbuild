import { describe, expect, it } from 'vitest';
import { chooseRunnable, DskFile, readDskCatalogue } from './dsk';
import { mkDsk } from './dskFixture';

const names = (f: DskFile[] | undefined): string[] => (f ?? []).map((x) => `${x.name}.${x.ext}`);

describe('readDskCatalogue', () => {
  it('reads a Data-format disc (directory on track 0, sectors &C1..)', () => {
    const f = readDskCatalogue(mkDsk({ base: 0xc1, dirTrack: 0, files: ['LAMPLIGH.BIN'], erased: ['OLD.BAS'] }));
    expect(names(f)).toEqual(['LAMPLIGH.BIN']);
  });
  it('reads a System-format disc (directory on track 2, sectors &41..)', () => {
    expect(names(readDskCatalogue(mkDsk({ base: 0x41, dirTrack: 2, files: ['GAME.BAS', 'DATA.DAT'] })))).toEqual(['GAME.BAS', 'DATA.DAT']);
  });
  it('reads an IBM-format disc (directory on track 1, sectors 1..)', () => {
    expect(names(readDskCatalogue(mkDsk({ base: 1, dirTrack: 1, files: ['PROG.BIN'] })))).toEqual(['PROG.BIN']);
  });
  it('reads the extended format', () => {
    expect(names(readDskCatalogue(mkDsk({ extended: true, base: 0xc1, dirTrack: 0, files: ['A.BIN', 'B.BAS'] })))).toEqual(['A.BIN', 'B.BAS']);
  });
  it('lists a file with several extents once', () => {
    expect(names(readDskCatalogue(mkDsk({ base: 0xc1, dirTrack: 0, files: ['BIG.BIN', 'BIG.BIN'] })))).toEqual(['BIG.BIN']);
  });
  it('rejects things that are not a disc image', () => {
    expect(readDskCatalogue(new Uint8Array(1000))).toBeUndefined();
  });
});

describe('chooseRunnable', () => {
  const f = (...n: string[]): DskFile[] => n.map((x) => ({ name: x.split('.')[0], ext: x.split('.')[1] ?? '', user: 0 }));
  it('runs the only .BIN or .BAS', () => {
    expect(chooseRunnable(f('LAMPLIGH.BIN', 'LEVEL1.DAT'))).toEqual({ kind: 'one', name: 'LAMPLIGH' });
  });
  it('offers a choice when there are several', () => {
    expect(chooseRunnable(f('A.BAS', 'B.BIN'))).toEqual({ kind: 'many', candidates: ['A.BAS', 'B.BIN'] });
  });
  it('has nothing to run without a program', () => {
    expect(chooseRunnable(f('DATA.DAT'))).toEqual({ kind: 'none' });
  });
});
