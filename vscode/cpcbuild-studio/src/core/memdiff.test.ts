import { describe, expect, it } from 'vitest';
import { diffBytes, formatRows, fromBase64, MemoryModel, pageBase, toBase64, windowBase, WINDOW_BYTES } from './memdiff';

describe('window placement', () => {
  it('aligns to a row, keeps the window inside 64 KB (wrap at &FFFF is a clamp)', () => {
    expect(windowBase(0x17bd)).toBe(0x17b0);
    expect(windowBase(0)).toBe(0);
    expect(windowBase(0xffff)).toBe(0x10000 - WINDOW_BYTES);
    expect(windowBase(0xfff0)).toBe(0x10000 - WINDOW_BYTES);
    expect(windowBase(-5)).toBe(0);
    expect(windowBase(99999)).toBe(0x10000 - WINDOW_BYTES);
  });
  it('pages by whole windows and clamps at both ends', () => {
    expect(pageBase(0x1000, 1)).toBe(0x1000 + WINDOW_BYTES);
    expect(pageBase(0x1000, -1)).toBe(0x1000 - WINDOW_BYTES);
    expect(pageBase(0, -1)).toBe(0);
    expect(pageBase(0xfe00, 3)).toBe(0x10000 - WINDOW_BYTES);
  });
});

describe('diffBytes', () => {
  it('lists the offsets that changed, nothing without a baseline or when the window moved', () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 9, 3, 7]);
    expect(diffBytes(a, 0x100, b, 0x100)).toEqual([1, 3]);
    expect(diffBytes(undefined, 0, b, 0)).toEqual([]);
    expect(diffBytes(a, 0x100, b, 0x110)).toEqual([]);
    expect(diffBytes(a, 0x100, Uint8Array.from([1, 2, 3]), 0x100)).toEqual([]);
    expect(diffBytes(a, 0, a, 0)).toEqual([]);
  });
});

describe('MemoryModel', () => {
  const win = (f: (i: number) => number): Uint8Array => Uint8Array.from({ length: WINDOW_BYTES }, (_, i) => f(i));
  it('marks bytes changed since the last refresh of the same window', () => {
    const m = new MemoryModel();
    m.moveTo(0x7000);
    expect(m.update(win(() => 0)).changed).toEqual([]); // first read: no baseline
    const u = m.update(win((i) => (i === 5 || i === 300 ? 1 : 0)));
    expect(u.changed).toEqual([5, 300]);
    expect(u.base).toBe(0x7000);
    expect(m.update(win((i) => (i === 5 || i === 300 ? 1 : 0))).changed).toEqual([]); // marks last one refresh only
  });
  it('drops the baseline when the window moves, and on reset', () => {
    const m = new MemoryModel();
    m.moveTo(0x100);
    m.update(win(() => 1));
    m.moveTo(0x2000);
    expect(m.update(win(() => 2)).changed).toEqual([]);
    m.moveTo(0x2005); // same window (aligned to 0x2000): baseline kept
    expect(m.base).toBe(0x2000);
    expect(m.update(win(() => 3)).changed.length).toBe(WINDOW_BYTES);
    m.reset();
    expect(m.update(win(() => 4)).changed).toEqual([]);
  });
  it('does not alias the caller\'s buffer', () => {
    const m = new MemoryModel();
    const buf = win(() => 0);
    m.update(buf);
    buf[3] = 9; // the caller reuses its buffer
    expect(m.update(buf).changed).toEqual([3]);
  });
});

describe('formatRows', () => {
  it('hex, ASCII and changed offsets per row; a short last row is allowed', () => {
    const bytes = Uint8Array.from([0x48, 0x49, 0x00, 0x7f, ...Array(12).fill(0x20), 0x41, 0x42]);
    const rows = formatRows(0x4f20, bytes, [1, 16]);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ addr: '&4F20', start: 0x4f20, ascii: 'HI.' + '.' + ' '.repeat(12), changed: [1] });
    expect(rows[0].hex.slice(0, 4)).toEqual(['48', '49', '00', '7F']);
    expect(rows[1]).toMatchObject({ addr: '&4F30', ascii: 'AB', hex: ['41', '42'], changed: [0] });
  });
});

describe('base64', () => {
  it('round-trips bytes', () => {
    const b = Uint8Array.from([0, 1, 254, 255, 128]);
    expect([...fromBase64(toBase64(b))]).toEqual([...b]);
  });
});
