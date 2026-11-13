// gen-grammar.mjs -- writes syntaxes/cpcbasic.tmLanguage.json from cpcbas's keyword table
// (vendor/cpcbas/dist/src/lang/keywords.js, linked by scripts/link-cpcbas.mjs from the pinned checkout).
// The word lists are the table's; only the classification into scopes lives here. src/core/grammar.test.ts
// regenerates the grammar in memory and fails when the committed file differs: run `npm run gen:grammar`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = join(dirname(fileURLToPath(import.meta.url)), '..');
export const GRAMMAR_FILE = join(here, 'syntaxes', 'cpcbasic.tmLanguage.json');
export const KEYWORDS_MODULE = join(here, 'vendor', 'cpcbas', 'dist', 'src', 'lang', 'keywords.js');

/** Words that steer the flow of a program: keyword.control. Names not in the table are ignored, so a rename cannot leave a hole. */
const CONTROL = new Set([
  'IF', 'THEN', 'ELSE', 'ELSEIF', 'FOR', 'NEXT', 'TO', 'STEP', 'WHILE', 'WEND', 'DO', 'LOOP', 'UNTIL', 'EXIT', 'CONTINUE', 'GOTO',
  'GOSUB', 'RETURN', 'SELECT', 'CASE', 'IS', 'END', 'STOP', 'ON', 'ON ERROR GOTO', 'ON BREAK', 'RESUME', 'CALL',
]);
/** Declarations and modifiers: storage.type (the type names come from the table's `type` entries) and storage.modifier. */
const STORAGE = new Set(['DIM', 'CONST', 'DECLARE', 'SUB', 'FUNCTION', 'DEF', 'DEF FN', 'FN', 'AS']);
const MODIFIER = new Set(['BYVAL', 'BYREF', 'FASTCALL', 'STDCALL']);

const esc = (w) => w.replace(/[$]/g, '\\$').replace(/ /g, '\\s+');
/** One alternation of table names, longest first (`GRAPHICS PEN` before `PEN`), as a case-insensitive whole-word match. */
function words(names) {
  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const plain = sorted.filter((n) => !n.endsWith('$')).map(esc);
  const dollar = sorted.filter((n) => n.endsWith('$')).map(esc);
  const parts = [];
  if (dollar.length) parts.push(`(?<![A-Za-z0-9_$%!.])(?:${dollar.join('|')})(?![A-Za-z0-9_])`);
  if (plain.length) parts.push(`(?<![A-Za-z0-9_$%!.])(?:${plain.join('|')})(?![A-Za-z0-9_$%!])`);
  return `(?i:${parts.join('|')})`;
}

export function generateGrammar(keywords) {
  const reserved = keywords.filter((k) => k.reserved && k.kind !== 'preprocessor');
  const pick = (f) => reserved.filter(f).map((k) => k.name);
  const types = pick((k) => k.kind === 'type');
  const later = pick((k) => k.status === 'later');
  const taken = new Set([...later]);
  const take = (names) => names.filter((n) => !taken.has(n) && taken.add(n));
  const control = take(pick((k) => CONTROL.has(k.name)));
  const storage = take([...types, ...pick((k) => STORAGE.has(k.name))]);
  const modifiers = take(pick((k) => MODIFIER.has(k.name)));
  const operators = take(pick((k) => k.kind === 'operator'));
  const functions = take(pick((k) => k.kind === 'function'));
  const other = take(pick((k) => k.kind === 'statement' || k.kind === 'clause'));
  const directives = keywords.filter((k) => k.kind === 'preprocessor').map((k) => k.name.slice(1));
  const rule = (name, names) => ({ name, match: words(names) });

  return {
    $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
    name: 'CPC BASIC',
    scopeName: 'source.cpcbasic',
    patterns: [
      { include: '#blockComment' },
      { include: '#comment' },
      { include: '#asm' },
      { include: '#string' },
      { include: '#directive' },
      { include: '#declaration' },
      { include: '#label' },
      { include: '#lineNumber' },
      { include: '#number' },
      { include: '#keywords' },
      { include: '#constant' },
      { include: '#rsx' },
      { include: '#operator' },
    ],
    repository: {
      blockComment: { name: 'comment.block.cpcbasic', begin: "/'", end: "'/" },
      comment: {
        patterns: [
          { name: 'comment.line.apostrophe.cpcbasic', match: "'.*$" },
          { name: 'comment.line.rem.cpcbasic', match: '(?i)(?<![A-Za-z0-9_$%!.])rem(?![A-Za-z0-9_$%!]).*$' },
        ],
      },
      asm: {
        name: 'meta.embedded.block.asm.cpcbasic',
        begin: '(?i)(?<![A-Za-z0-9_$%!.])(asm)(?![A-Za-z0-9_$%!])',
        beginCaptures: { 1: { name: 'keyword.other.cpcbasic' } },
        end: '(?i)(?<![A-Za-z0-9_$%!.])(end\\s+asm)(?![A-Za-z0-9_$%!])',
        endCaptures: { 1: { name: 'keyword.other.cpcbasic' } },
        patterns: [{ match: ';.*$', name: 'comment.line.semicolon.asm.cpcbasic' }, { match: "'.*$", name: 'comment.line.apostrophe.cpcbasic' }],
      },
      string: { name: 'string.quoted.double.cpcbasic', begin: '"', end: '"|$', patterns: [{ name: 'constant.character.escape.cpcbasic', match: '""' }] },
      directive: {
        name: 'meta.preprocessor.cpcbasic',
        match: `(?i)^\\s*(#\\s*(?:${directives.sort((a, b) => b.length - a.length).join('|')}))(?![A-Za-z0-9_])(?:\\s+(once)(?![A-Za-z0-9_]))?(?:\\s*(<[^>]*>))?`,
        captures: { 1: { name: 'keyword.control.directive.cpcbasic' }, 2: { name: 'keyword.control.directive.cpcbasic' }, 3: { name: 'string.quoted.other.lt-gt.cpcbasic' } },
      },
      declaration: {
        match: '(?i)(?<![A-Za-z0-9_$%!.])(sub|function)\\s+(?:(fastcall|stdcall)\\s+)?([A-Za-z_][A-Za-z0-9_]*[$%!]?)',
        captures: { 1: { name: 'storage.type.function.cpcbasic' }, 2: { name: 'storage.modifier.cpcbasic' }, 3: { name: 'entity.name.function.cpcbasic' } },
      },
      label: { match: '^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*:(?!=)', captures: { 1: { name: 'entity.name.label.cpcbasic' } } },
      lineNumber: { match: '^\\s*(\\d+)\\b', captures: { 1: { name: 'entity.name.label.cpcbasic' } } },
      number: {
        patterns: [
          { name: 'constant.numeric.hex.cpcbasic', match: '(?i)&h?[0-9a-f]+\\b|\\b0x[0-9a-f]+\\b' },
          { name: 'constant.numeric.binary.cpcbasic', match: '(?i)&x[01]+\\b|\\b0b[01]+\\b' },
          { name: 'constant.numeric.decimal.cpcbasic', match: '(?i)(?<![A-Za-z_$%!])(?:\\d+\\.?\\d*|\\.\\d+)(?:e[+-]?\\d+)?[%!]?' },
        ],
      },
      keywords: {
        patterns: [
          rule('invalid.deprecated.cpcbasic', later),
          rule('keyword.control.cpcbasic', control),
          rule('storage.type.cpcbasic', storage),
          rule('storage.modifier.cpcbasic', modifiers),
          rule('keyword.operator.word.cpcbasic', operators),
          rule('support.function.builtin.cpcbasic', functions),
          rule('keyword.other.cpcbasic', other),
        ],
      },
      constant: { name: 'constant.language.cpcbasic', match: '\\b__[A-Z0-9_]+__\\b' },
      rsx: { name: 'support.function.rsx.cpcbasic', match: '\\|[A-Za-z@][A-Za-z0-9_.]*' },
      operator: {
        patterns: [
          { name: 'keyword.operator.address.cpcbasic', match: '@' },
          { name: 'keyword.operator.cpcbasic', match: '<>|<=|>=|<<|>>|=>|[-+*/\\\\^<>=]' },
        ],
      },
    },
  };
}

/** The text the committed file must hold. */
export const grammarText = (keywords) => JSON.stringify(generateGrammar(keywords), null, 2) + '\n';

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { KEYWORDS } = await import(pathToFileURL(KEYWORDS_MODULE).href);
  mkdirSync(dirname(GRAMMAR_FILE), { recursive: true });
  writeFileSync(GRAMMAR_FILE, grammarText(KEYWORDS));
  console.log(`syntaxes/cpcbasic.tmLanguage.json  ${KEYWORDS.length} table entries`);
}
