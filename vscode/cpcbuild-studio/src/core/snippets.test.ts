import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compileFiles, errorsOf } from './cpcbasTestUtil';

interface Snippet {
  prefix: string;
  description: string;
  body: string | string[];
}
const snippets = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../snippets/cpcbasic.json'), 'utf8')) as Record<string, Snippet>;

/** A snippet as it reads once inserted and every placeholder is left at its default (the first choice of a choice). */
export function expand(body: string | string[]): string {
  const text = Array.isArray(body) ? body.join('\n') : body;
  const first = new Map<string, string>();
  // ${n:default} (a later ${n:...} or $n repeats the first default), ${n|a,b|}, ${n}, $n
  return (
    text
      .replace(/\$\{(\d+):([^}]*)\}/g, (_m, n: string, d: string) => {
        if (!first.has(n)) first.set(n, d);
        return first.get(n)!;
      })
      .replace(/\$\{(\d+)\|([^,|}]*)[^}]*\|\}/g, (_m, n: string, d: string) => {
        first.set(n, d);
        return d;
      })
      .replace(/\$\{(\d+)\}|\$(\d+)/g, (_m, a?: string, b?: string) => first.get((a ?? b)!) ?? '')
  );
}

const PRELUDE = '#include <cpc.bas>\n#include <cpcbuild.bas>\nDIM a, b, i, x, y AS INTEGER\nDIM n AS UBYTE\nDIM ball(15) AS UBYTE\nCONST ball_W AS UBYTE = 2\nCONST ball_H AS UBYTE = 8\n';

/** Where a snippet goes: declarations and directives at the top, a whole program on its own, anything else among the statements. */
function program(code: string): string {
  if (/^'.*\n#include <cpc\.bas>/.test(code)) return code;
  if (/^(SUB|FUNCTION)\b/.test(code)) return `${PRELUDE}${code}\nEND\n`;
  if (/^#include/.test(code)) return `${code}\nEND\n`;
  return `${PRELUDE}${code}\nEND\n`;
}

describe('snippets', () => {
  const entries = Object.entries(snippets);
  it('are in a valid file, each with a prefix and a description, prefixes unique', () => {
    expect(entries.length).toBeGreaterThan(15);
    for (const [name, s] of entries) {
      expect(s.prefix, name).toMatch(/^[a-z]+$/);
      expect(s.description.length, name).toBeGreaterThanOrEqual(5);
    }
    expect(new Set(entries.map(([, s]) => s.prefix)).size).toBe(entries.length);
  });
  it('use no Boriel spellings', () => {
    for (const [name, s] of entries) {
      const code = expand(s.body);
      expect(code, name).not.toMatch(/\$[0-9A-Fa-f]{2}|\bENDIF\b|\bWaitVsync\b|\bbAND\b|zxbc|Spectrum/);
    }
  });
  it.each(entries.map(([name, s]) => [name, s] as const))('%s compiles', (_name, s) => {
    const src = program(expand(s.body));
    const r = compileFiles(new Map([['src/main.bas', src], ['assets/file.bas', "' a generated file\n"]]), 'src/main.bas');
    expect(errorsOf(r), src).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it('the Plus include compiles under PLUS', () => {
    const src = `#include <cpc.bas>\n#include <cpcbuild.bas>\n#include <cpcplus/cpcplus.bas>\nEND\n`;
    expect(errorsOf(compileFiles(new Map([['main.bas', src]]), 'main.bas', { PLUS: '' }))).toEqual([]);
  });
});
