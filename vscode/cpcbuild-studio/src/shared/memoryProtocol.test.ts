import { describe, expect, it } from 'vitest';
import { parseMemWebMsg } from './memoryProtocol';

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
