/**
 * The aks2bas port's post-processing against tools/aks2bas.py: the Arkos tools' raw exports were captured once
 * with the real tools (aks2bas.gen.py) and the expected includes made by the Python functions, so these tests
 * need neither Arkos nor Python.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Aks2basError, bankInclude, hex06, PSG_HZ, pyInt0, sanitizeName, setPsgClock, toBoriel } from './aks2bas';

const FX = path.join(__dirname, 'fixtures', 'aks2bas');
const txt = (n: string): string => fs.readFileSync(path.join(FX, n), 'utf8');
const bin = (n: string): Buffer => fs.readFileSync(path.join(FX, n));

describe('toBoriel on captured Arkos exports', () => {
  for (const c of ['title', 'game', 'sfx']) {
    it(`${c}: the include is the Python tool's`, () => {
      const [name, kind] = txt(`${c}.name.txt`).trim().split(' ');
      expect(toBoriel(txt(`${c}.asm`), name, '', kind as 'song' | 'sfx')).toBe(txt(`${c}.expected.bas`));
    });
  }
  it('a hand-made source: strings, semicolons, directives, label forms, a prefix', () => {
    expect(toBoriel(txt('edge.asm'), 'edge', '', 'song')).toBe(txt('edge.expected.bas'));
    expect(toBoriel(txt('edge.asm'), 'edge', 'p_', 'sfx')).toBe(txt('edge_prefix.expected.bas'));
  });
  it('CRLF input gives the same include', () => {
    expect(toBoriel(txt('edge.asm').replace(/\n/g, '\r\n'), 'edge', '', 'song')).toBe(txt('edge.expected.bas'));
  });
  it('a source without labels is refused', () => {
    expect(() => toBoriel('  ld a,1\n', 'x')).toThrow(Aks2basError);
    expect(() => toBoriel('  ld a,1\n', 'x')).toThrow('no labels found: not an Arkos source export?');
  });
});

describe('bankInclude', () => {
  it('the binary export for 0x4000 as `db` lines', () => {
    expect(bankInclude(bin('title.akg.bin'), 'sf_title', 0x4000)).toBe(txt('title.bank.expected.bas'));
  });
  it('formats the address as Python\'s {:#06x}', () => {
    expect(hex06(0x4000)).toBe('0x4000');
    expect(hex06(0x7fff)).toBe('0x7fff');
  });
});

describe('setPsgClock', () => {
  for (const n of ['plain', 'zip', 'stored']) {
    it(`${n}: both clocks, byte for byte`, () => {
      const d = bin(`psg_${n}.aks`);
      expect(Buffer.from(setPsgClock(d, PSG_HZ.cpc)).equals(bin(`psg_${n}.cpc.expected`))).toBe(true);
      expect(Buffer.from(setPsgClock(d, PSG_HZ.spectrum)).equals(bin(`psg_${n}.spectrum.expected`))).toBe(true);
    });
  }
  it('says so when the song has no clock', () => {
    expect(() => setPsgClock(new TextEncoder().encode('<aks/>'), 1)).toThrow('no <frequencyHz> in the song: not an Arkos .aks?');
  });
});

describe('small helpers', () => {
  it('sanitizeName', () => {
    expect(sanitizeName('my tune-1')).toBe('my_tune_1');
    expect(sanitizeName('1up')).toBe('_1up');
    expect(sanitizeName('')).toBe('_');
  });
  it("pyInt0 is Python's int(s, 0)", () => {
    expect(pyInt0('0x4000')).toBe(0x4000);
    expect(pyInt0('16384')).toBe(16384);
    expect(pyInt0('0b100')).toBe(4);
    for (const bad of ['&4000', '$4000', '0400', 'zzz', '']) expect(pyInt0(bad), bad).toBeNaN();
  });
});
