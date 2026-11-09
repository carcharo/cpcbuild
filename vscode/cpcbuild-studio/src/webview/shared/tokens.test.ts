/** cb.css identity palette: 12 colours per theme kind, each >= 3:1 against its theme background; no other literal colours. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'cb.css'), 'utf8');

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
function ids(block: string): string[] {
  return [...block.matchAll(/--cb-id-(\d+):\s*(#[0-9a-f]{6});/gi)].sort((a, b) => Number(a[1]) - Number(b[1])).map((m) => m[2]);
}
const dark = ids(css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root'))));
const lightStart = css.indexOf('body.vscode-light, body.vscode-high-contrast-light {');
const light = ids(css.slice(lightStart, css.indexOf('}', lightStart)));

describe('identity palette', () => {
  it('has 12 dark and 12 light values', () => {
    expect(dark).toHaveLength(12);
    expect(light).toHaveLength(12);
  });
  it.each(dark.map((c, i) => [i + 1, c]))('dark %i %s has 3:1 on #1f1f1f', (_i, c) => expect(contrast(c as string, '#1f1f1f')).toBeGreaterThanOrEqual(3));
  it.each(light.map((c, i) => [i + 1, c]))('light %i %s has 3:1 on #ffffff', (_i, c) => expect(contrast(c as string, '#ffffff')).toBeGreaterThanOrEqual(3));
});

describe('literal colours', () => {
  it('appear only as identity values or var() fallbacks', () => {
    const stripped = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--cb-id-\d+:\s*#[0-9a-f]{6};/gi, '')
      .replace(/var\(--[\w-]+,\s*#[0-9a-f]{3,8}\)/gi, '');
    expect(stripped.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(stripped.match(/\b(?:rgba?|hsla?)\(/gi) ?? []).toEqual([]);
  });
});
