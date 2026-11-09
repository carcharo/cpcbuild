/** The tracker's markup and styles keep the redesign rules: no literal colours, no style="" strings, no remote fonts. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = __dirname;
const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf8');

describe('tracker rules', () => {
  it('tracker.css has no literal colour', () => {
    const css = read('tracker.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\b(rgb|rgba|hsl|hsla)\(/);
    expect(css).not.toMatch(/@import|url\(/);
  });
  it('no component writes a style="..." string', () => {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.tsx'))) expect(read(f), f).not.toMatch(/style=["']/);
  });
});
