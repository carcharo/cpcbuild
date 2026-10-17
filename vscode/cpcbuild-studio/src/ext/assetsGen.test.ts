/**
 * Regenerating recipes: both engines write the committed generated files byte for byte, the stale
 * check, header modes and the failure texts. The recipes are made from the headers of the committed
 * .bas files (examples/assets, tests/conformance/assets, games/shooter/assets) in a scratch project
 * that mirrors the repo layout, so the "Source:" and command-line header lines match.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { argvToRecipe, newRecipe, serialiseRecipe, type Recipe } from '../core/cpcimp';
import { committed } from '../core/testcorpus';
import { REPO, scratchDir } from '../core/testutil';
import { findRecipes, generate, generateFile, isStale, regenerateAll, type GenSettings } from './assetsGen';

const GLOBS = ['assets/**/*.cpcimp'];
const settings = (over: Partial<GenSettings> = {}): GenSettings => ({ engine: 'builtin', header: 'img2cpc', pythonPath: 'python3', library: REPO, ...over });

let root = '';
const recipes: { file: string; rel: string; committed: string }[] = [];

function copyRepo(rel: string): void {
  const dst = path.join(root, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(REPO, rel), dst);
}

beforeAll(() => {
  root = scratchDir('assetsgen-');
  committed().forEach(([file, argv], n) => {
    const r: Recipe = argvToRecipe(argv).recipe;
    for (const f of [r.source, r.palette?.file, r.plus?.palette?.file]) if (f) copyRepo(f);
    const rel = `assets/${n}_${path.basename(file, '.bas')}.cpcimp`;
    fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(root, rel), serialiseRecipe(r));
    recipes.push({ file, rel, committed: fs.readFileSync(path.join(REPO, file), 'utf8') });
  });
});

describe('finding recipes', () => {
  it('uses the assets globs and only .cpcimp', () => {
    expect(findRecipes(root, GLOBS)).toEqual(recipes.map((r) => r.rel).sort());
    expect(findRecipes(root, ['assets/**/*.cpcspr'])).toEqual([]);
    expect(findRecipes(root, ['assets/0_*.cpcimp', 'assets/**/*.cpcspr']).length).toBeGreaterThan(0);
    expect(findRecipes(root, ['nothing/**/*.cpcimp'])).toEqual([]);
  });
});

for (const engine of ['builtin', 'python'] as const) {
  describe(`engine ${engine}`, () => {
    it('Regenerate assets: every recipe writes the committed file, byte for byte', async () => {
      for (const r of recipes) fs.rmSync(path.join(root, r.file), { force: true });
      const out = await regenerateAll(root, GLOBS, settings({ engine }));
      expect(out.filter((x) => !x.ok).map((x) => `${x.recipe}: ${x.error}`)).toEqual([]);
      expect(out.length).toBe(recipes.length);
      for (const r of recipes) expect(fs.readFileSync(path.join(root, r.file), 'utf8'), r.file).toBe(r.committed);
    }, 120000);
  });
}

describe('the stale check', () => {
  it('skips up-to-date outputs, regenerates when the source or the recipe is newer or the output is gone', async () => {
    await regenerateAll(root, GLOBS, settings());
    const first = recipes[0];
    const stale = async (): Promise<string[]> => (await regenerateAll(root, GLOBS, settings(), { onlyStale: true })).filter((x) => !x.skipped).map((x) => x.recipe);
    // inputs (images, palettes, recipes) 60 s old, outputs 30 s old: nothing is stale until a change
    const old = new Date(Date.now() - 60000), mid = new Date(Date.now() - 30000);
    const all = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? all(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const outputs = new Set(recipes.map((r) => path.join(root, r.file)).concat([path.join(root, 'tests/conformance/assets/pens16.pal')]));
    for (const f of all(root)) fs.utimesSync(f, outputs.has(f) ? mid : old, outputs.has(f) ? mid : old);
    expect(await stale()).toEqual([]);
    // a newer recipe
    fs.utimesSync(path.join(root, first.rel), new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    expect(await stale()).toEqual([first.rel]);
    // regenerated (outputs are now newer); reset the times
    fs.utimesSync(path.join(root, first.rel), old, old);
    fs.utimesSync(path.join(root, first.file), mid, mid);
    expect(await stale()).toEqual([]);
    // output removed
    fs.rmSync(path.join(root, first.file));
    expect(await stale()).toEqual([first.rel]);
    expect(fs.existsSync(path.join(root, first.file))).toBe(true);
    fs.utimesSync(path.join(root, first.file), mid, mid);
    // the source image newer than the output
    const r0 = argvToRecipe((await import('../core/testcorpus')).committed()[0][1]).recipe;
    fs.utimesSync(path.join(root, r0.source), new Date(Date.now() + 8000), new Date(Date.now() + 8000));
    expect((await stale()).length).toBeGreaterThan(0);
  }, 120000);

  it('isStale is true for a recipe whose output does not exist', () => {
    fs.writeFileSync(path.join(root, 'assets/zz.cpcimp'), '{}');
    expect(isStale(root, 'assets/zz.cpcimp', newRecipe('nothing.png', { output: 'assets/zz.bas' }))).toBe(true);
    fs.rmSync(path.join(root, 'assets/zz.cpcimp'));
  });
});

describe('header modes and failures', () => {
  const r = (): Recipe => argvToRecipe(committed().find(([f]) => f.endsWith('spr1.bas'))![1]).recipe;
  it('none drops the header, studio names the recipe, for both engines', async () => {
    for (const engine of ['builtin', 'python'] as const) {
      const none = await generate(root, 'assets/x.cpcimp', { ...r(), output: 'out/none.bas' }, settings({ engine, header: 'none' }));
      expect(none.ok, none.error).toBe(true);
      expect(fs.readFileSync(path.join(root, 'out/none.bas'), 'utf8').startsWith('DIM a_spr1')).toBe(true);
      const st = await generate(root, 'assets/x.cpcimp', { ...r(), output: 'out/studio.bas' }, settings({ engine, header: 'studio' }));
      expect(st.ok, st.error).toBe(true);
      expect(fs.readFileSync(path.join(root, 'out/studio.bas'), 'utf8').split('\n')[0]).toBe("' Generated by CPCBuild Studio from assets/x.cpcimp");
    }
  });
  it('a converter error is the tool\'s text on both engines', async () => {
    const bad = { ...r(), mode: 2 as const, palette: undefined, output: 'out/bad.bas' };
    const a = await generate(root, 'assets/x.cpcimp', bad, settings());
    const b = await generate(root, 'assets/x.cpcimp', bad, settings({ engine: 'python' }));
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/^img2cpc: the image needs 4 colours/);
    expect(b.error).toBe(a.error);
    expect(fs.existsSync(path.join(root, 'out/bad.bas'))).toBe(false);
  });
  it('a missing source, an empty recipe and bad JSON say what to do', async () => {
    const m = await generate(root, 'assets/x.cpcimp', newRecipe('nope/none.png', { name: 'n', output: 'out/m.bas' }), settings());
    expect(m.error).toBe('img2cpc.py: error: nope/none.png: not found');
    const py = await generate(root, 'assets/x.cpcimp', newRecipe('nope/none.png', { name: 'n', output: 'out/m.bas' }), settings({ engine: 'python' }));
    expect(py.error).toBe(m.error);
    expect((await generate(root, 'assets/x.cpcimp', newRecipe(''), settings())).error).toMatch(/no source image/);
    fs.writeFileSync(path.join(root, 'assets/bad.cpcimp'), '{"format":');
    expect((await generateFile(root, 'assets/bad.cpcimp', settings())).error).toMatch(/assets\/bad\.cpcimp: not valid JSON/);
    fs.rmSync(path.join(root, 'assets/bad.cpcimp'));
  });
  it('the python engine without the tool says how to fix it', async () => {
    const x = await generate(root, 'assets/x.cpcimp', r(), settings({ engine: 'python', library: path.join(root, 'nowhere') }));
    expect(x.error).toMatch(/tools\/img2cpc\.py was not found.*cpcbuild\.library\.path/);
  });
  it('a grid works on both engines and they agree', async () => {
    const base = argvToRecipe(committed().find(([f]) => f.endsWith('/assets/sprites.bas') && f.includes('shooter'))![1]).recipe;
    const g = { ...base, frame: undefined, output: 'out/grid.bas', grid: { cellW: 8, cellH: 8, marginX: 0, marginY: 0, spacingX: 0, spacingY: 0, columns: 5, exclude: [1, 5] } };
    const a = await generate(root, 'assets/g.cpcimp', g, settings());
    const b = await generate(root, 'assets/g.cpcimp', g, settings({ engine: 'python' }));
    expect(a.ok, a.error).toBe(true);
    expect(b.ok, b.error).toBe(true);
    const text = fs.readFileSync(path.join(root, 'out/grid.bas'), 'utf8');
    expect(text.split('\n')[1]).toBe(`' Source: ${base.source}, 40x16 pixels, mode 0`);
    expect(text).toContain('10 frame(s)');
  });
});
