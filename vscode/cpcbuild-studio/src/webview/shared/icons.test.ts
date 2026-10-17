/** Every codicon name used by a webview (literal `icon: 'x'`, `icon="x"`, `<Icon name="x">`) exists in the bundled codicon CSS. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : [];
  });
}

describe('codicon names', () => {
  const css = readFileSync(join(__dirname, '../../../node_modules/@vscode/codicons/dist/codicon.css'), 'utf8');
  const known = new Set([...css.matchAll(/\.codicon-([a-z0-9-]+)::?before/g)].map((m) => m[1]));
  const used = new Map<string, string>();
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:\bicon\s*[:=]\s*['"]|<Icon name=")([a-z0-9-]+)['"]/g)) used.set(m[1], file);
  }
  it('finds the icons in use', () => expect(used.size).toBeGreaterThan(20));
  it('has the codicon list', () => expect(known.size).toBeGreaterThan(300));
  it('every icon exists, and undo is not one of them', () => {
    const missing = [...used].filter(([n]) => !known.has(n)).map(([n, f]) => `${n} (${f})`);
    expect(missing).toEqual([]);
  });
});
