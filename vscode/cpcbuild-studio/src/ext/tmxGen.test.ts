/** The convert command's engines against tools/tmx2bas.py, on the repo's maps, with every option. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { posixSlashes } from '../core/pathtext';
import { py, PYTHON_SETTING, REPO, scratchDir } from '../core/testutil';
import { defaultOutput, generateTmx, tmxArgv } from './tmxGen';

const dir = scratchDir('tmxgen-');
const MAPS = ['examples/assets/level.tmx', 'tests/conformance/assets/level.tmx'];
// the project root of the conversions: the maps mirrored from the repo; outputs go under out/ (paths stay inside the root)
for (const m of MAPS) {
  fs.mkdirSync(path.join(dir, path.dirname(m)), { recursive: true });
  fs.copyFileSync(path.join(REPO, m), path.join(dir, m));
}
fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
const PY = { engine: 'python' as const, pythonPath: PYTHON_SETTING, library: REPO };
const TS = { engine: 'builtin' as const, pythonPath: PYTHON_SETTING, library: REPO };

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
          const rel = `out/${eng.engine}-${what.replace(/\W/g, '_')}-${path.basename(path.dirname(path.dirname(f)))}.bas`;
          const out = path.join(dir, rel);
          const r = await generateTmx(dir, f, { ...opts, output: rel }, eng);
          expect(r.ok, r.error).toBe(true);
          // the tool quotes a path it finds odd (a Windows path has backslashes): take it out either way
          const refOut = path.join(dir, 'ref.bas');
          const want = reference(f, extra, refOut).replace(`'${refOut}'`, rel).replace(refOut, rel);
          expect(fs.readFileSync(out, 'utf8')).toBe(want);
          expect(r.text).toBe(fs.readFileSync(out, 'utf8'));
        });
      }
    }
  }
  it('writes the committed include when given the same flags (examples/assets/level.bas)', async () => {
    const out = path.join(dir, 'out', 'level-committed.bas');
    const r = await generateTmx(dir, 'examples/assets/level.tmx', { name: 'level', output: 'out/level-committed.bas' }, TS);
    expect(r.ok).toBe(true);
    // the committed file was made with `-o examples/assets/level.bas`: only the header's -o argument differs
    const committed = fs.readFileSync(path.join(REPO, 'examples/assets/level.bas'), 'utf8').split('\n').slice(1).join('\n');
    expect(fs.readFileSync(out, 'utf8').split('\n').slice(1).join('\n')).toBe(committed);
  });
  it('a layer by name, and the tool\'s text for a missing layer', async () => {
    const ok = await generateTmx(dir, MAPS[0], { layer: 'background', output: 'out/l1.bas' }, TS);
    expect(ok.ok).toBe(true);
    const bad = await generateTmx(dir, MAPS[0], { layer: 'nope', output: 'out/l2.bas' }, TS);
    const ref = py('tmx2bas.py', [MAPS[0], '--layer', 'nope']);
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe(ref.stderr.trim());
    expect((await generateTmx(dir, MAPS[0], { layer: 'nope', output: 'out/l3.bas' }, PY)).error).toBe(ref.stderr.trim());
  });
  it('gives the tool\'s message for a number above 255 and a gid below firstgid, on both engines', async () => {
    const f = path.join(dir, 'e.tmx');
    fs.writeFileSync(f, '<map width="2" height="1" tilewidth="8" tileheight="8"><tileset firstgid="1" tilewidth="8" tileheight="8"/><layer name="L" width="2" height="1"><data encoding="csv">1,300</data></layer></map>');
    for (const opts of [{}, { firstgid: 2 }]) {
      const ref = py('tmx2bas.py', [f, ...(opts.firstgid ? ['--firstgid', '2'] : [])]);
      for (const eng of [TS, PY]) {
        const r = await generateTmx(dir, 'e.tmx', { ...opts, output: 'out/x.bas' }, eng);
        expect(r.ok).toBe(false);
        expect(r.error).toBe(ref.stderr.trim().replace(posixSlashes(f), 'e.tmx'));
      }
    }
  });
  it('refuses a missing file and a bad --empty without running anything', async () => {
    expect((await generateTmx(dir, 'nope.tmx', {}, TS)).error).toBe('tmx2bas.py: error: nope.tmx: not found');
    expect((await generateTmx(dir, MAPS[0], { empty: 300, output: 'out/z.bas' }, TS)).error).toBe('tmx2bas.py: error: --empty must be 0-255');
  });
  it('the python engine says what is missing', async () => {
    const r = await generateTmx(dir, MAPS[0], { output: 'out/p.bas' }, { engine: 'python', pythonPath: PYTHON_SETTING });
    expect(r.error).toMatch(/tmx2bas\.py was not found/);
  });
  it('refuses ../, absolute and symlink-escaping map and output paths on both engines', async () => {
    const outside = scratchDir('tmxgen-outside-');
    fs.symlinkSync(outside, path.join(dir, 'escape'), 'junction');
    for (const eng of [TS, PY]) {
      for (const [tmx, output] of [[MAPS[0], '../evil.bas'], [MAPS[0], path.join(outside, 'abs.bas')], [MAPS[0], 'escape/evil.bas'], ['../level.tmx', 'out/a.bas'], [path.join(REPO, MAPS[0]), 'out/a.bas']]) {
        const r = await generateTmx(dir, tmx, { output }, eng);
        expect(r.ok, `${eng.engine} ${tmx} ${output}`).toBe(false);
        expect(r.error).toMatch(/outside the project folder|absolute path|symbolic link/);
      }
    }
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.rmSync(path.join(dir, 'escape'));
  });
});
