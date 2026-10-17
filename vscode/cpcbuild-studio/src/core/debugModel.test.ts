import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EmuState } from '../emuApi';
import { breakpointText, flagsText, reasonText, registerRows, reresolve, statusText, toggleBreakpoint } from './debugModel';
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
