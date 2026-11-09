import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmuState } from '../emuApi';
import { breakpointText, cpuModel, flagBits, flagsText, pushRecent, reasonText, registerRows, reresolve, sameRegs, stackRange, stackRows, statusText, toggleBreakpoint } from './debugModel';
import { parseMap } from './map';
import { buildSymbols, findByName } from './symbols';

const table = (n: string) => buildSymbols(parseMap(fs.readFileSync(path.join(__dirname, 'fixtures', n + '.map'), 'utf8')));
const state = (over: Partial<EmuState> = {}): EmuState => ({
  running: false, paused: true, reason: 'breakpoint', pc: 0x17bd, sp: 0xbf40, af: 0x0244, bc: 0x0a12, de: 0x1000, hl: 0x4f2a, ix: 0, iy: 0,
  af2: 0, bc2: 0, de2: 0, hl2: 0, i: 0, r: 0x2a, im: 1, iff1: 1, frame: 100, model: '6128', ...over,
});

describe('breakpoint list', () => {
  it('toggles: adds sorted, removes the same address', () => {
    let r = toggleBreakpoint([], { addr: 0x2000 });
    expect(r.added).toBe(true);
    r = toggleBreakpoint(r.list, { addr: 0x1000, symbol: 'X' });
    expect(r.list.map((b) => b.addr)).toEqual([0x1000, 0x2000]);
    r = toggleBreakpoint(r.list, { addr: 0x2000 });
    expect(r.added).toBe(false);
    expect(r.list.map((b) => b.addr)).toEqual([0x1000]);
  });
  it('a breakpoint set on a symbol follows it to the new address after a rebuild', () => {
    const old = [{ addr: 0x1000, symbol: 'MoveSprites', offset: 3 }, { addr: 0x2222 }, { addr: 0x3000, symbol: 'Gone' }];
    const t = table('plusdemo'); // MoveSprites is at 0x17BD there
    const out = reresolve(old, t, (tt, n) => findByName(tt, n)?.addr);
    expect(out.map((b) => b.addr)).toEqual([0x17c0, 0x2222, 0x3000]); // moved; raw address kept; vanished symbol keeps its address
    expect(reresolve(old, undefined, () => undefined)).toEqual(old);
  });
  it('two breakpoints landing on one address collapse', () => {
    const t = table('plusdemo');
    const out = reresolve([{ addr: 1, symbol: 'MoveSprites' }, { addr: 2, symbol: 'MoveSprites' }], t, (tt, n) => findByName(tt, n)?.addr);
    expect(out.length).toBe(1);
  });
  it('text', () => {
    expect(breakpointText({ addr: 0x17bd, symbol: 'MoveSprites' })).toBe('MoveSprites');
    expect(breakpointText({ addr: 0x17c0, symbol: 'MoveSprites', offset: 3 })).toBe('MoveSprites+3');
    expect(breakpointText({ addr: 0x4f2a })).toBe('&4F2A');
  });
});

describe('status and registers', () => {
  const t = table('plusdemo');
  it('status text names the symbol and offset', () => {
    expect(statusText(state(), t)).toBe('CPC paused at MoveSprites');
    expect(statusText(state({ pc: 0x17c0 }), t)).toBe('CPC paused at MoveSprites+3');
    expect(statusText(state({ pc: 0xc123 }), t)).toBe('CPC paused at &C123');
    expect(statusText(state({ pc: 0x17bd }), undefined)).toBe('CPC paused at &17BD');
    expect(statusText(state({ paused: false, running: true }), t)).toBe('CPC running');
    expect(statusText(undefined, t)).toBe('');
  });
  it('flags', () => {
    expect(flagsText(0x44)).toBe('-Z---P--');
    expect(flagsText(0xff)).toBe('SZYHXPNC');
    expect(flagsText(0)).toBe('--------');
  });
  it('register rows: PC with its symbol, words in hex, flags, IFF', () => {
    const rows = registerRows(state({ pc: 0x17c0 }), t);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.PC).toEqual({ name: 'PC', value: '&17C0', note: 'MoveSprites+3' });
    expect(by.SP.value).toBe('&BF40');
    expect(by.AF).toMatchObject({ value: '&0244', note: '-Z---P--' });
    expect(by.R.value).toBe('&2A');
    expect(by.IFF1.value).toBe('on');
    expect(rows.length).toBe(16);
  });
  it('reasons read as sentences', () => {
    expect(reasonText('breakpoint')).toMatch(/breakpoint/);
    expect(reasonText(undefined)).toBe('paused');
  });
});

describe('flagBits', () => {
  it('splits F into S Z H P/V N C', () => {
    expect(flagBits(0x44)).toEqual({ s: false, z: true, h: false, pv: true, n: false, c: false });
    expect(flagBits(0xff)).toEqual({ s: true, z: true, h: true, pv: true, n: true, c: true });
    expect(flagBits(0x28)).toEqual({ s: false, z: false, h: false, pv: false, n: false, c: false }); // Y and X are not in the panel
    expect(flagBits(0x93)).toEqual({ s: true, z: false, h: true, pv: false, n: true, c: true });
  });
});

describe('cpuModel', () => {
  const t = table('plusdemo'); // MoveSprites &17BD; nothing above about &3E7A is inside the program
  const reg = (m: ReturnType<typeof cpuModel>, n: string) => [...m.main, ...m.cpu, ...m.alt].find((r) => r.name === n)!;
  it('lists the registers with raw values and which rows can go to memory', () => {
    const m = cpuModel(state({ pc: 0x17c0 }), undefined, t, false);
    expect(m.main.map((r) => r.name)).toEqual(['PC', 'SP', 'AF', 'BC', 'DE', 'HL', 'IX', 'IY']);
    expect(m.main.filter((r) => r.goto).map((r) => r.name)).toEqual(['PC', 'SP', 'BC', 'DE', 'HL', 'IX', 'IY']);
    expect(reg(m, 'PC')).toEqual({ name: 'PC', value: 0x17c0, text: '&17C0', note: 'MoveSprites+3', changed: false, goto: true });
    expect(m.cpu.map((r) => [r.name, r.text])).toEqual([['I', '&00'], ['R', '&2A'], ['IM', '1'], ['IFF1', 'on']]);
    expect(m.alt.map((r) => r.name)).toEqual(["AF'", "BC'", "DE'", "HL'"]);
  });
  it('a note only where a mapped symbol range holds the value', () => {
    const m = cpuModel(state({ pc: 0x17bd, sp: 0xbf40, hl: 0x4f2a, bc: 0x17c1 }), undefined, t, false);
    expect(reg(m, 'PC').note).toBe('MoveSprites');
    expect(reg(m, 'SP')).not.toHaveProperty('note'); // &BF40 is past the program
    expect(reg(m, 'BC').note).toBe('MoveSprites+4');
    expect(reg(m, 'AF')).not.toHaveProperty('note'); // flags are not an address
    expect(cpuModel(state(), undefined, undefined, false).main.every((r) => !('note' in r))).toBe(true);
  });
  it('flags carry a name, a spoken title and the set bit', () => {
    const m = cpuModel(state({ af: 0x0244 }), undefined, t, false);
    expect(m.flags.map((f) => f.name)).toEqual(['S', 'Z', 'H', 'P/V', 'N', 'C']);
    expect(m.flags.filter((f) => f.set).map((f) => f.name)).toEqual(['Z', 'P/V']);
    expect(m.flags.find((f) => f.name === 'Z')!.title).toBe('Zero');
  });
  it('changed marks appear only after a step', () => {
    const prev = state({ pc: 0x17bd, hl: 0x1000, af: 0x0244, af2: 1, bc2: 2, r: 5 });
    const now = state({ pc: 0x17c0, hl: 0x1001, af: 0x0245, af2: 9, bc2: 8, r: 6 });
    const after = cpuModel(now, prev, t, true);
    expect(after.stepped).toBe(true);
    expect(after.main.filter((r) => r.changed).map((r) => r.name)).toEqual(['PC', 'AF', 'HL']);
    expect(after.flags.filter((f) => f.changed).map((f) => f.name)).toEqual(['C']);
    expect(reg(after, 'R').changed).toBe(true);
    expect(reg(after, 'IM').changed).toBe(false);
    expect(after.altChanged).toBe(2);
    expect(after.alt.filter((r) => r.changed).map((r) => r.name)).toEqual(["AF'", "BC'"]);
    const plain = cpuModel(now, prev, t, false); // pause / resume: nothing is marked
    expect(plain.stepped).toBe(false);
    expect(plain.main.some((r) => r.changed) || plain.cpu.some((r) => r.changed) || plain.flags.some((f) => f.changed) || plain.altChanged > 0).toBe(false);
    const noBase = cpuModel(now, undefined, t, true); // no previous snapshot: nothing to compare
    expect(noBase.stepped).toBe(false);
    expect(noBase.main.some((r) => r.changed)).toBe(false);
  });
  it('is plain JSON (it travels in the snapshot)', () => {
    const m = cpuModel(state(), state({ pc: 1 }), t, true);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
  it('sameRegs ignores frame and reason', () => {
    expect(sameRegs(state(), state({ frame: 999, reason: 'step' }))).toBe(true);
    expect(sameRegs(state(), state({ r: 0x2b }))).toBe(false);
  });
});

describe('stackRows', () => {
  const t = table('plusdemo');
  const words = (...w: number[]) => Uint8Array.from(w.flatMap((x) => [x & 0xff, x >> 8]));
  it('reads little-endian words from SP, 8 at most', () => {
    const rows = stackRows(0xbff2, words(0x17c0, 0x1234, 1, 2, 3, 4, 5, 6, 7, 8), t);
    expect(rows.length).toBe(8);
    expect(rows[0]).toEqual({ addr: 0xbff2, word: 0x17c0, note: 'return address? MoveSprites+3' });
    expect(rows[1]).toEqual({ addr: 0xbff4, word: 0x1234, note: expect.stringContaining('return address? ') }); // &1234 is inside the program too
    expect(rows[7].addr).toBe(0xc000);
  });
  it('no note for a word outside the mapped symbols, or with no table', () => {
    const rows = stackRows(0xbf00, words(0xc123, 0x17bd), t);
    expect(rows[0]).toEqual({ addr: 0xbf00, word: 0xc123 });
    expect(rows[1].note).toBe('return address? MoveSprites');
    expect(stackRows(0xbf00, words(0x17bd), undefined)[0]).not.toHaveProperty('note');
  });
  it('the read is clamped to the address space, and fewer words are shown near &FFFF', () => {
    expect(stackRange(0xbff2)).toEqual({ addr: 0xbff2, length: 16, skip: 0 });
    expect(stackRange(0xfff0)).toEqual({ addr: 0xfff0, length: 16, skip: 0 });
    expect(stackRange(0xfff8)).toEqual({ addr: 0xfff0, length: 16, skip: 8 });
    expect(stackRange(0xfffe)).toEqual({ addr: 0xfff0, length: 16, skip: 14 });
    for (const sp of [0, 0x8000, 0xfff0, 0xfff7, 0xfff8, 0xfffc, 0xffff]) {
      const r = stackRange(sp);
      expect(r.addr + r.length).toBeLessThanOrEqual(0x10000);
      expect(r.addr + r.skip).toBe(sp);
    }
    // host: bytes = read.subarray(skip)
    const read = new Uint8Array(16).map((_, i) => i + 1); // addr &FFF0..&FFFF
    const rows = stackRows(0xfff8, read.subarray(8), t);
    expect(rows.map((r) => r.addr)).toEqual([0xfff8, 0xfffa, 0xfffc, 0xfffe]);
    expect(rows[0].word).toBe(0x0a09);
    expect(stackRows(0xffff, read.subarray(15), t)).toEqual([]); // one byte left: no whole word
  });
});

describe('pushRecent', () => {
  it('newest first, distinct by address, five at most', () => {
    let l = pushRecent([], { addr: 1, text: '&0001' });
    for (const a of [2, 3, 4, 5, 6]) l = pushRecent(l, { addr: a, text: `&000${a}` });
    expect(l.map((r) => r.addr)).toEqual([6, 5, 4, 3, 2]);
    l = pushRecent(l, { addr: 4, text: 'Main' });
    expect(l.map((r) => r.addr)).toEqual([4, 6, 5, 3, 2]);
    expect(l[0].text).toBe('Main');
  });
});
