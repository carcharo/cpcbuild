import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRAMMAR_FILE, generateGrammar, grammarText } from '../../scripts/gen-grammar.mjs';
import { KEYWORDS, RESERVED_WORDS } from '../../vendor/cpcbas/dist/src/lang/keywords';

const ROOT = path.resolve(__dirname, '..', '..');
const readJson = (f: string): any => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));

describe('the CPC BASIC grammar', () => {
  it('is up to date with the compiler keyword table (run `npm run gen:grammar` when this fails)', () => {
    expect(fs.readFileSync(GRAMMAR_FILE, 'utf8')).toBe(grammarText(KEYWORDS));
  });

  const g = generateGrammar(KEYWORDS) as any;
  const keywordRules: { name: string; match: string }[] = g.repository.keywords.patterns;
  // every rule as a JavaScript regular expression: `(?i)` and `(?i: )` become the `i` flag
  const js = (m: string): RegExp => new RegExp(m.replace(/^\(\?i\)/, '').replace(/\(\?i:/g, '(?:'), 'i');
  const scopeOf = (word: string): string | undefined => keywordRules.find((r) => js(r.match).test(` ${word} `))?.name;

  it('every rule is a valid regular expression', () => {
    const all: string[] = [];
    const walk = (o: any): void => {
      if (Array.isArray(o)) return o.forEach(walk);
      if (o && typeof o === 'object') {
        for (const [k, v] of Object.entries(o)) {
          if ((k === 'match' || k === 'begin' || k === 'end') && typeof v === 'string') all.push(v);
          else walk(v);
        }
      }
    };
    walk(g.repository);
    expect(all.length).toBeGreaterThan(15);
    for (const m of all) expect(() => js(m), m).not.toThrow();
  });

  it('scopes every reserved word of the table, and no soft word', () => {
    for (const k of KEYWORDS) {
      if (k.kind === 'preprocessor') continue;
      const hit = scopeOf(k.name);
      if (RESERVED_WORDS.has(k.name.split(' ')[0]) && k.reserved) expect(hit, k.name).toBeTruthy();
      else if (!k.reserved && !k.name.includes(' ')) expect(hit, `${k.name} is a soft word: it can be a name`).toBeUndefined();
    }
  });

  it('classifies a few words', () => {
    expect(scopeOf('PRINT')).toBe('keyword.other.cpcbasic');
    expect(scopeOf('IF')).toBe('keyword.control.cpcbasic');
    expect(scopeOf('UBYTE')).toBe('storage.type.cpcbasic');
    expect(scopeOf('LEFT$')).toBe('support.function.builtin.cpcbasic');
    expect(scopeOf('MOD')).toBe('keyword.operator.word.cpcbasic');
    expect(scopeOf('GRAPHICS PEN')).toBe('keyword.other.cpcbasic');
    expect(scopeOf('FASTCALL')).toBe('storage.modifier.cpcbasic');
    // a variable that begins with a keyword, or a name with a suffix, is not one
    expect(scopeOf('printer')).toBeUndefined();
    expect(scopeOf('a$')).toBeUndefined();
    expect(scopeOf('over')).toBeUndefined();
  });

  it('takes & hex, &X binary, REM, apostrophe and block comments, and ASM blocks', () => {
    const rules = g.repository;
    expect(js(rules.number.patterns[0].match).test('&HFF')).toBe(true);
    expect(js(rules.number.patterns[0].match).test('&1F')).toBe(true);
    expect(js(rules.number.patterns[1].match).test('&X1010')).toBe(true);
    expect(rules.blockComment.begin).toBe("/'");
    expect(js(rules.comment.patterns[1].match).test('  REM hello')).toBe(true);
    expect(js(rules.comment.patterns[1].match).test('remain = 1')).toBe(false);
    expect(js(rules.asm.begin).test('ASM')).toBe(true);
    expect(js(rules.asm.end).test('  END ASM')).toBe(true);
  });
});

describe('the language contribution', () => {
  const pkg = readJson('package.json');
  const c = pkg.contributes;
  it('claims .bas as cpcbasic, with the grammar, the language configuration and the snippets', () => {
    const lang = c.languages.find((l: any) => l.id === 'cpcbasic');
    expect(lang.extensions).toContain('.bas');
    expect(fs.existsSync(path.join(ROOT, lang.configuration))).toBe(true);
    const gr = c.grammars.find((x: any) => x.language === 'cpcbasic');
    expect(gr.scopeName).toBe(readJson(gr.path).scopeName);
    expect(fs.existsSync(path.join(ROOT, c.snippets.find((x: any) => x.language === 'cpcbasic').path))).toBe(true);
    expect(pkg.activationEvents).toContain('onLanguage:cpcbasic');
  });
  it('the language configuration comments out with an apostrophe and has block comments', () => {
    const cfg = readJson('language-configuration.json');
    expect(cfg.comments.lineComment).toBe("'");
    expect(cfg.comments.blockComment).toEqual(["/'", "'/"]);
  });
  it('is packaged (the .vscodeignore lets the files through)', () => {
    const ign = fs.readFileSync(path.join(ROOT, '.vscodeignore'), 'utf8');
    for (const f of ['language-configuration.json', 'syntaxes/**', 'snippets/**']) expect(ign).toContain(`!${f}`);
  });
  it('has the Convert command in the palette and on cpcbuild.json', () => {
    expect(c.commands.some((x: any) => x.command === 'cpcbuild.convertProject' && x.title === 'Convert Project to CPC BASIC')).toBe(true);
    expect(c.menus['explorer/context'].some((x: any) => x.command === 'cpcbuild.convertProject' && /cpcbuild\.json/.test(x.when))).toBe(true);
  });
});
