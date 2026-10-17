/** The convert command's engines against tools/tmx2bas.py, on the repo's maps, with every option. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { py, REPO, scratchDir } from '../core/testutil';
import { defaultOutput, generateTmx, tmxArgv } from './tmxGen';

const dir = scratchDir('tmxgen-');
const MAPS = ['examples/assets/level.tmx', 'tests/conformance/assets/level.tmx'];
const PY = { engine: 'python' as const, pythonPath: 'python3', library: REPO };
const TS = { engine: 'builtin' as const, pythonPath: 'python3', library: REPO };

/** What the tool writes for these options, run exactly as the extension runs it (from the repo root). */
function reference(tmxRel: string, extra: string[], out: string): string {
  const r = py('tmx2bas.py', [tmxRel, ...extra, '-o', out]);
  expect(r.ok, r.stderr).toBe(true);
  return fs.readFileSync(out, 'utf8');
}

describe('argument construction', () => {
  it('is the tool\'s command line', () => {
    expect(tmxArgv('a/b.tmx', {}, 'a/b.bas')).toEqual(['a/b.tmx', '-o', 'a/b.bas']);
    expect(tmxArgv('a/b.tmx', { layer: 'Ground', name: 'lvl', empty: 3, firstgid: 5 }, 'o.bas')).toEqual(['a/b.tmx', '--layer', 'Ground', '--name', 'lvl', '--empty', '3', '--firstgid', '5', '-o', 'o.bas']);
    expect(defaultOutput('x/level.tmx')).toBe('x/level.bas');
  });
});

describe('generateTmx equals tools/tmx2bas.py', () => {
  const cases: [string, Parameters<typeof tmxArgv>[1], string[]][] = [
    ['defaults', {}, []],
    ['named', { name: 'lvl' }, ['--name', 'lvl']],
    ['empty and firstgid', { empty: 9, firstgid: 1 }, ['--empty', '9', '--firstgid', '1']],
  ];
  for (const f of MAPS) {
    for (const [what, opts, extra] of cases) {
      for (const eng of [TS, PY]) {
        it(`${f}: ${what} (${eng.engine} engine)`, async () => {
          const out = path.join(dir, `${eng.engine}-${what.replace(/\W/g, '_')}-${path.basename(path.dirname(path.dirname(f)))}.bas`);
          const r = await generateTmx(REPO, f, { ...opts, output: out }, eng);
          expect(r.ok, r.error).toBe(true);
          expect(fs.readFileSync(out, 'utf8')).toBe(reference(f, extra, path.join(dir, 'ref.bas')).replace(path.join(dir, 'ref.bas'), out));
          expect(r.text).toBe(fs.readFileSync(out, 'utf8'));
        });
      }
    }
  }
  it('writes the committed include when given the same flags (examples/assets/level.bas)', async () => {
    const out = path.join(dir, 'level-committed.bas');
    const r = await generateTmx(REPO, 'examples/assets/level.tmx', { name: 'level', output: out }, TS);
    expect(r.ok).toBe(true);
    // the committed file was made with `-o examples/assets/level.bas`: only the header's -o argument differs
    const committed = fs.readFileSync(path.join(REPO, 'examples/assets/level.bas'), 'utf8').split('\n').slice(1).join('\n');
    expect(fs.readFileSync(out, 'utf8').split('\n').slice(1).join('\n')).toBe(committed);
  });
  it('a layer by name, and the tool\'s text for a missing layer', async () => {
    const ok = await generateTmx(REPO, MAPS[0], { layer: 'background', output: path.join(dir, 'l1.bas') }, TS);
    expect(ok.ok).toBe(true);
    const bad = await generateTmx(REPO, MAPS[0], { layer: 'nope', output: path.join(dir, 'l2.bas') }, TS);
    const ref = py('tmx2bas.py', [MAPS[0], '--layer', 'nope']);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe(ref.stderr.trim());
    expect((await generateTmx(REPO, MAPS[0], { layer: 'nope', output: path.join(dir, 'l3.bas') }, PY)).error).toBe(ref.stderr.trim());
  });
  it('gives the tool\'s message for a number above 255 and a gid below firstgid, on both engines', async () => {
    const f = path.join(dir, 'e.tmx');
    fs.writeFileSync(f, '<map width="2" height="1" tilewidth="8" tileheight="8"><tileset firstgid="1" tilewidth="8" tileheight="8"/><layer name="L" width="2" height="1"><data encoding="csv">1,300</data></layer></map>');
    for (const opts of [{}, { firstgid: 2 }]) {
      const ref = py('tmx2bas.py', [f, ...(opts.firstgid ? ['--firstgid', '2'] : [])]);
      for (const eng of [TS, PY]) {
        const r = await generateTmx('/', f.slice(1), { ...opts, output: path.join(dir, 'x.bas') }, eng);
        expect(r.ok).toBe(false);
        expect(r.error).toBe(ref.stderr.trim().replace(f, f.slice(1)));
      }
    }
  });
  it('refuses a missing file and a bad --empty without running anything', async () => {
    expect((await generateTmx(REPO, 'nope.tmx', {}, TS)).error).toBe('tmx2bas.py: error: nope.tmx: not found');
    expect((await generateTmx(REPO, MAPS[0], { empty: 300, output: path.join(dir, 'z.bas') }, TS)).error).toBe('tmx2bas.py: error: --empty must be 0-255');
  });
  it('the python engine says what is missing', async () => {
    const r = await generateTmx(REPO, MAPS[0], { output: path.join(dir, 'p.bas') }, { engine: 'python', pythonPath: 'python3' });
    expect(r.error).toMatch(/tmx2bas\.py was not found/);
  });
});
