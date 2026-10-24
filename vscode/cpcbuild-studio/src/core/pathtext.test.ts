import { describe, expect, it } from 'vitest';
import { baseName, posixSlashes } from './pathtext';

describe('pathtext (the tools print forward slashes; Windows hands over backslashes)', () => {
  it('turns "\\" into "/" only where it separates', () => {
    expect(posixSlashes('C:\\Users\\me\\hero.png', true)).toBe('C:/Users/me/hero.png');
    expect(posixSlashes('art/hero.png', true)).toBe('art/hero.png');
    expect(posixSlashes('a\\b.png', false)).toBe('a\\b.png');
  });
  it('baseName of either separator', () => {
    expect(baseName('C:\\x\\y\\m-csv.tmx', true)).toBe('m-csv.tmx');
    expect(baseName('x/y/z.png', true)).toBe('z.png');
    expect(baseName('x/y/z.png', false)).toBe('z.png');
    expect(baseName('x\\y.png', false)).toBe('x\\y.png');
    expect(baseName('plain.png')).toBe('plain.png');
  });
});
