/**
 * A 0.1.x project that still has Spectrum targets, converted the way "Convert Project to CPC BASIC" does it (the
 * Spectrum targets removed, the files only they used deleted), then built the way the Studio builds a target: the
 * asset step (regenerateAll + assetFailure), then the compiler. The command itself runs in the extension-host tests.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from '@cpcbuild/cpcbas';
import { diskTree, readTree } from '@cpcbuild/cpcbas/node';
import { copyFixture, errorsOf, runtime } from '../core/cpcbasTestUtil';
import { convertSources, formatReport, mustFix, removeSpectrumTargets, targetChecks } from '../core/convert';
import { compileInput, parseProject } from '../core/project';
import { scratchDir } from '../core/testutil';
import { assetFailure, findRecipes, regenerateAll, type GenSettings } from './assetsGen';

const gen = { engine: 'builtin', header: 'img2cpc', pythonPath: 'python3', library: undefined } as unknown as GenSettings;

/** The Studio's asset step, then its compile, for one target; returns what stopped it (or '') and the compiler's errors. */
async function buildLikeStudio(dir: string, targetId: string): Promise<{ stopped: string; warnings: string[]; errors: string[] }> {
  const { project } = parseProject(fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8'));
  if (!project) throw new Error('cpcbuild.json does not parse');
  const warnings: string[] = [];
  for (const g of (await regenerateAll(dir, project.assets, gen, { onlyStale: true })).filter((x) => !x.ok)) {
    const f = assetFailure(g);
    if (f.fatal) return { stopped: f.message, warnings, errors: [] };
    warnings.push(f.message);
  }
  const t = project.targets.find((x) => x.id === targetId)!;
  const input = compileInput(t, project, {});
  const r = compile({ files: diskTree(dir), main: input.main, includePaths: input.includePaths, defines: input.defines, runtime: runtime(), options: input.options });
  return { stopped: '', warnings, errors: errorsOf(r) };
}

/** Converts `dir` as the command does, accepts the removal of the Spectrum targets (and the deletion offer, unless `deleteUnused` is false), and writes. */
function convertAndClean(dir: string, deleteUnused = true): { unused: string[]; zxRecipes: string[]; fix: number; fixAll: number; report: string } {
  const text = fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8');
  const r = convertSources(readTree(dir), { from: 'boriel', runtime: runtime(), checks: targetChecks(text) });
  for (const [f, t] of r.changed) fs.writeFileSync(path.join(dir, f), t);
  const zx = removeSpectrumTargets(text)!;
  fs.writeFileSync(path.join(dir, 'cpcbuild.json'), zx.text);
  const globs = (JSON.parse(text) as { assets: string[] }).assets;
  const zxRecipes = findRecipes(dir, globs).filter((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).target === 'spectrum');
  if (deleteUnused) for (const f of [...r.unused!, ...zxRecipes]) fs.rmSync(path.join(dir, f));
  return { unused: r.unused!, zxRecipes, fix: mustFix(r.report, r.built).length, fixAll: mustFix(r.report).length, report: formatReport(r.report) };
}

describe('a converted 0.1.x project with Spectrum targets builds', () => {
  it('the small fixture: the build skips a Spectrum recipe with a warning, and after Convert there is none', async () => {
    const dir = copyFixture('convert/spectrum-01x');
    // Convert with the deletion offer declined: the project loads, the Spectrum recipe is still there, and the build goes on after a warning
    const kept = convertAndClean(dir, false);
    expect(fs.existsSync(path.join(dir, 'assets/zx/zx_sprites.cpcimp'))).toBe(true);
    fs.rmSync(path.join(dir, 'assets/sprites.bas'), { force: true });
    const before = await buildLikeStudio(dir, 'cpc6128');
    expect(before.stopped).toBe('');
    expect(before.errors).toEqual([]);
    expect(before.warnings).toHaveLength(1);
    expect(before.warnings[0]).toMatch(/^asset assets\/zx\/zx_sprites\.cpcimp: skipped: it converts for the ZX Spectrum/);
    expect(fs.existsSync(path.join(dir, 'assets/sprites.bas'))).toBe(true); // the CPC recipe was regenerated
    expect(kept.unused).toEqual(['assets/zx/zx_sprites.bas', 'platform_zx.bas']);

    // a fresh copy, the offer accepted
    const dir2 = copyFixture('convert/spectrum-01x');
    const c = convertAndClean(dir2);
    expect(c.unused).toEqual(['assets/zx/zx_sprites.bas', 'platform_zx.bas']);
    expect(c.zxRecipes).toEqual(['assets/zx/zx_sprites.cpcimp']);
    expect(c.fixAll).toBeGreaterThan(0); // platform_zx.bas has W720 findings
    expect(c.fix).toBe(0); // but no CPC target compiles it
    fs.rmSync(path.join(dir2, 'assets/sprites.bas'));
    const after = await buildLikeStudio(dir2, 'cpc6128');
    expect(after).toEqual({ stopped: '', warnings: [], errors: [] });
  });

  // The 0.1.2 Lamplighter: needs the v0.1.2 tag in the checkout (a shallow clone without tags skips this)
  const lamp = (): string | undefined => {
    const dir = scratchDir('lamp012-');
    try {
      const repo = path.resolve(__dirname, '..', '..', '..', '..');
      const tar = path.join(dir, 'l.tar');
      execFileSync('git', ['-C', repo, 'archive', 'v0.1.2', 'games/lamplighter', '-o', tar], { stdio: 'ignore' });
      execFileSync('tar', ['-x', '-C', dir, '-f', tar]);
      return path.join(dir, 'games', 'lamplighter');
    } catch {
      return undefined;
    }
  };
  const lampDir = lamp();
  (lampDir ? it : it.skip)('0.1.2 Lamplighter: Convert with the Spectrum targets removed and the unused files deleted builds all three CPC targets', async () => {
    const dir = lampDir!;
    const c = convertAndClean(dir);
    expect(c.fix).toBe(0);
    expect(c.fixAll).toBe(5); // all in platform_zx.bas, which no CPC target compiles
    // only the Spectrum build's files: not the test programs' platform, not the CPC build's silent song
    expect(c.unused).toEqual(['assets/zx/sfx_zx.bas', 'assets/zx/zx_sprites.bas', 'assets/zx/zx_tiles.bas', 'platform_zx.bas']);
    expect(c.zxRecipes).toEqual(['assets/zx/zx_sprites.cpcimp', 'assets/zx/zx_tiles.cpcimp']);
    expect(fs.existsSync(path.join(dir, 'platform_zx.bas'))).toBe(false);
    for (const f of ['tests/platform_null.bas', 'tests/say.bas', 'tests/playseq.bas', 'assets/quiet.bas']) expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    // make every picture newer than its output, so the asset step really regenerates the recipes
    const now = new Date();
    for (const f of fs.readdirSync(path.join(dir, 'assets'), { recursive: true }) as string[]) if (f.endsWith('.png')) fs.utimesSync(path.join(dir, 'assets', f), now, now);
    for (const id of ['lamp464', 'lamp6128', 'lampplus']) {
      const b = await buildLikeStudio(dir, id);
      expect(b.stopped, id).toBe('');
      expect(b.errors, id).toEqual([]);
      expect(b.warnings, id).toEqual([]);
    }
  }, 120_000);
});
