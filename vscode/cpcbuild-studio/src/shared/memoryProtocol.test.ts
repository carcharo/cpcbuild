import { describe, expect, it } from 'vitest';
import { cpuModel } from '../core/debugModel';
import { parseMemWebMsg, type MemHostMsg } from './memoryProtocol';

describe('parseMemWebMsg (the webview is untrusted)', () => {
  it('accepts exactly the control commands of the list', () => {
    for (const cmd of ['pause', 'resume', 'step', 'stepOver', 'stepOut']) expect(parseMemWebMsg({ type: 'control', cmd })).toEqual({ type: 'control', cmd });
    for (const cmd of ['toggleBreakpoint', 'removeBreakpoint', 'showRegisters', '../x', '', 5, undefined, null, { toString: () => 'pause' }]) {
      expect(parseMemWebMsg({ type: 'control', cmd }), String(cmd)).toBeUndefined();
    }
  });
  it('validates pages, text and shapes', () => {
    expect(parseMemWebMsg({ type: 'page', pages: -3 })).toEqual({ type: 'page', pages: -3 });
    for (const pages of [1.5, NaN, Infinity, '2', 1e9, null]) expect(parseMemWebMsg({ type: 'page', pages })).toBeUndefined();
    expect(parseMemWebMsg({ type: 'goto', text: 'Main+3' })).toEqual({ type: 'goto', text: 'Main+3' });
    expect(parseMemWebMsg({ type: 'goto', text: 42 })).toBeUndefined();
    expect(parseMemWebMsg({ type: 'goto', text: 'x'.repeat(201) })).toBeUndefined();
    expect(parseMemWebMsg({ type: 'copy', text: {} })).toBeUndefined();
    expect(parseMemWebMsg({ type: 'command', command: 5 })).toBeUndefined();
    expect(parseMemWebMsg({ type: 'nope' })).toBeUndefined();
    expect(parseMemWebMsg(null)).toBeUndefined();
    expect(parseMemWebMsg('ready')).toBeUndefined();
    expect(parseMemWebMsg({ type: 'ready' })).toEqual({ type: 'ready' });
  });
});

describe('snapshot with the CPU panel', () => {
  it('is plain JSON and the registers\' "goto" is an ordinary goto message', () => {
    const st = { running: false, paused: true, pc: 0x4f2a, sp: 0xbff2, af: 0x44, bc: 0, de: 0, hl: 0, ix: 0, iy: 0, af2: 0, bc2: 0, de2: 0, hl2: 0, i: 0, r: 0, im: 1, iff1: 1, frame: 1, model: '6128' as const };
    const msg: MemHostMsg = {
      type: 'snapshot',
      snap: {
        base: 0x4f20, bytes: '', changed: [], rowNames: {}, target: '&4F20', recent: [{ addr: 0x4f20, text: '&4F20' }],
        cpu: { model: cpuModel(st, undefined, undefined, false), stack: [{ addr: 0xbff2, word: 0x17c0 }], sp: 0xbff2, running: false },
      },
      status: { live: true, paused: true, text: 'Paused' },
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
    expect(parseMemWebMsg({ type: 'goto', text: '&BFF2' })).toEqual({ type: 'goto', text: '&BFF2' });
  });
});
