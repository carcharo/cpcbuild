/** The tracker's markup and styles keep the redesign rules: no literal colours, no style="" strings, no remote fonts. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const dirs = [__dirname, path.join(__dirname, '../shared/lanes')];
const files = (ext: string): string[] => dirs.flatMap((d) => fs.readdirSync(d).filter((x) => x.endsWith(ext)).map((x) => path.join(d, x)));
const read = (f: string): string => fs.readFileSync(f, 'utf8');

describe('tracker rules', () => {
  it('there are style sheets to check (tracker, instrument, lanes)', () => {
    expect(files('.css').map((f) => path.basename(f)).sort()).toEqual(['instrument.css', 'lanes.css', 'tracker.css']);
  });
  it.each(files('.css').map((f) => [path.basename(f), f]))('%s has no literal colour', (_n, f) => {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/@import|url\(/);
  });
  it('no component writes a style="..." string', () => {
    for (const f of files('.tsx')) expect(read(f), f).not.toMatch(/style=["']/);
  });
});
