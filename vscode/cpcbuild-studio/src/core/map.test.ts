import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findLabel, formatReport, hex4, memoryReport, parseMap, programStart } from './map';

// real zxbc -M output, copied from the main checkout's build/ directory
const fx = (n: string): string => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

describe('parseMap', () => {
  it('reads address and label like the awk in build_cpc.sh', () => {
    const e = parseMap('0040: .core.__START_PROGRAM\n0059: ._barIdx\n\n');
    expect(e).toEqual([
      { addr: 0x40, label: '.core.__START_PROGRAM' },
      { addr: 0x59, label: '._barIdx' },
    ]);
  });
  it('parses the real maps completely', () => {
    for (const n of ['plusdemo.map', 'bounce.map', 'mode1text.map']) {
      const text = fx(n);
      const lines = text.split('\n').filter((l) => l.trim()).length;
      const e = parseMap(text);
      expect(e.length).toBe(lines);
      expect(programStart(e)).toBe(0x40);
    }
  });
  it('finds a label', () => {
    const e = parseMap(fx('plusdemo.map'));
    expect(findLabel(e, '._dsprite')).toBe(0x6f);
    expect(findLabel(e, '._nope')).toBeUndefined();
  });
});

describe('memoryReport', () => {
  it('plusdemo (bare cartridge): 15679 bytes from &0040', () => {
    const r = memoryReport(parseMap(fx('plusdemo.map')), 15679, { bare: true, pkg: 'cpr' });
    expect(r.start).toBe(0x40);
    expect(r.end).toBe(0x40 + 15679);
    expect(r.lowEnd).toBe(r.end);
    expect(r.highData).toBeUndefined();
    const by = Object.fromEntries(r.lines.map((l) => [l.limit, l.headroom]));
    expect(by[0x4000]).toBe(0x4000 - (0x40 + 15679)); // negative: over the double-buffer line
    expect(by[0xb800]).toBe(0xb800 - (0x40 + 15679));
    expect(by[0xa67b]).toBeUndefined(); // not loaded by RUN"
  });
  it('bounce (firmware): heap line, no bare lines', () => {
    const r = memoryReport(parseMap(fx('bounce.map')), 10946, { bare: false, pkg: 'dsk' });
    expect(r.lines.map((l) => l.limit)).toEqual([0x4000, 0x8b60]);
    expect(r.lines[1].headroom).toBe(0x8b60 - (0x40 + 10946));
  });
  it('bare disc adds the RUN" line', () => {
    const r = memoryReport(parseMap(fx('mode1text.map')), 2722, { bare: true, pkg: 'dsk' });
    expect(r.lines.map((l) => l.limit)).toEqual([0x4000, 0xa67b, 0xb800]);
    expect(r.lines[0].headroom).toBe(0x4000 - (0x40 + 2722));
  });
  it('splits the low segment at __HIDATA_BACK_0', () => {
    const e = parseMap('0040: .core.__START_PROGRAM\n2F00: .__HIDATA_BACK_0\n');
    const r = memoryReport(e, 0x8100 - 0x40, { bare: false, pkg: 'dsk' });
    expect(r.lowEnd).toBe(0x2f00);
    expect(r.end).toBe(0x8100);
    expect(r.highData).toEqual({ end: 0x8100, bytes: 0x8100 - 0x2f00 });
    expect(r.lines[0].headroom).toBe(0x4000 - 0x2f00); // &4000 from the low end, as build_cpc.sh
    expect(r.lines[1].headroom).toBe(0x8b60 - 0x8100); // heap from the end of the high data
  });
  it('user limits are added', () => {
    const r = memoryReport(parseMap(fx('mode1text.map')), 2722, { bare: false, pkg: 'dsk', extraLimits: { 'my line': 0x2000 } });
    expect(r.lines.at(-1)).toMatchObject({ name: 'my line', limit: 0x2000, headroom: 0x2000 - (0x40 + 2722) });
  });
  it('refuses a map without the start label', () => {
    expect(() => memoryReport(parseMap('0059: ._x\n'), 10, { bare: false, pkg: 'dsk' })).toThrow(/START_PROGRAM/);
  });
  it('formats', () => {
    const r = memoryReport(parseMap(fx('mode1text.map')), 2722, { bare: false, pkg: 'dsk' });
    const t = formatReport(r);
    expect(t[0]).toBe('2722 bytes, &0040-&0AE2');
    expect(t.join('\n')).toContain('headroom below &8B60');
    expect(hex4(0x40)).toBe('&0040');
  });
});
