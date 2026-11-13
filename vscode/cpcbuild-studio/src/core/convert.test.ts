import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTree } from '@cpcbuild/cpcbas/node';
import { compileFiles, copyFixture, errorsOf, runtime } from './cpcbasTestUtil';
import { type CheckConfig, convertSources, formatReport, hasSpectrumTargets, mustFix, removeSpectrumTargets, targetChecks } from './convert';

/** Converts the project in `dir` the way the command does (without the questions) and writes the changed files. */
function convertDir(dir: string, from: 'auto' | 'boriel') {
  const files = readTree(dir);
  const pj = fs.existsSync(path.join(dir, 'cpcbuild.json')) ? fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8') : undefined;
  const r = convertSources(files, { from, runtime: runtime(), checks: targetChecks(pj) });
  for (const [f, t] of r.changed) fs.writeFileSync(path.join(dir, f), t);
  return { r, pj };
}

/** Compiles every CPC target of the project in `dir` (the way a build does) and returns the errors. */
function buildTargets(dir: string): string[] {
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'cpcbuild.json'), 'utf8')) as { targets: { id: string; main: string; defines?: string[]; bare?: boolean; ownFont?: boolean; package: 'dsk' | 'cpr' }[] };
  const tree = new Map<string, Uint8Array>(readTree(dir));
  const errs: string[] = [];
  for (const c of targetChecks(JSON.stringify(pj))) {
    const t = pj.targets.find((x) => c.targets.includes(x.id))!;
    errs.push(...errorsOf(compileFiles(tree, c.mains[0], c.defines, t.package)).map((e) => `${c.targets[0]}: ${e}`));
  }
  return errs;
}

describe('Convert Project: the 0.1.2 template projects', () => {
  it.each(['firmware', 'baremetal', 'plus'])('%s: converts to a project that builds, and converting again changes nothing', (id) => {
    const dir = copyFixture(`convert/template-012-${id}`);
    // before: the 0.1.2 sources are not CPC BASIC
    expect(buildTargets(dir).length).toBeGreaterThan(0);
    const { r } = convertDir(dir, 'boriel');
    expect(r.dialect).toBe('boriel');
    expect(r.changed.size).toBeGreaterThan(0);
    expect(mustFix(r.report)).toEqual([]);
    expect(buildTargets(dir)).toEqual([]);
    // a second run, as the command runs it after the first conversion (auto): nothing to write
    const again = convertDir(dir, 'auto');
    expect(again.r.dialect).toBe('cpcbas');
    expect([...again.r.changed.keys()]).toEqual([]);
    expect(buildTargets(dir)).toEqual([]);
  });

  it('the report lists the findings and ends with a summary', () => {
    const dir = copyFixture('convert/template-012-firmware');
    const { r } = convertDir(dir, 'boriel');
    const t = formatReport(r.report);
    expect(t).toMatch(/\d+ file\(s\) read, \d+ changed\. Read as Boriel BASIC\./);
    expect(t).toMatch(/W700 x\d+/);
    expect(formatReport(r.report, { notes: true })).toMatch(/note W700/);
  });
});

describe('Convert Project: Starfall as 0.1.x wrote it', () => {
  // main.bas builds Starfall for every model; the platform files pick the machine by -D PLUS
  const checks: CheckConfig[] = [
    { mains: ['main.bas'], defines: { CPC6128: '' }, targets: ['cpc6128'] },
    { mains: ['main.bas'], defines: { PLUS: '' }, targets: ['plus'] },
  ];
  it('the compile check, given the main file and the target defines, finds no W725', () => {
    const dir = copyFixture('convert/starfall-01x');
    const files = readTree(dir);
    expect([...files.keys()]).toContain('platform_cpc.bas');
    const r = convertSources(files, { from: 'boriel', runtime: runtime(), checks });
    const w725 = r.report.files.flatMap((f) => f.diagnostics.filter((d) => d.code === 'W725').map((d) => `${f.path}:${d.line} ${d.message}`));
    expect(w725).toEqual([]);
    expect(r.changed.size).toBeGreaterThan(5);
    expect(r.dialect).toBe('boriel');
    // the converted program builds for both
    for (const c of checks) {
      for (const [f, t] of r.changed) fs.writeFileSync(path.join(dir, f), t);
      const tree = new Map<string, Uint8Array>(readTree(dir));
      expect(errorsOf(compileFiles(tree, 'main.bas', c.defines)), c.targets[0]).toEqual([]);
    }
  });
});

describe('Convert Project: cpcbuild.json', () => {
  const shared = JSON.stringify(
    {
      version: 1,
      name: 'g',
      targets: [
        { id: 'cpc6128', arch: 'cpc', main: 'src/main.bas', model: '6128', defines: ['CPC6128'], package: 'dsk', disc: 'G' },
        { id: 'plus', arch: 'cpc', main: 'src/main.bas', model: 'plus', defines: ['PLUS'], bare: true, ownFont: true, package: 'cpr' },
        { id: 'zx128', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX128'], org: 31744, heap: 256, package: 'tap' },
        { id: 'zx48', arch: 'zx48k', main: 'src/main.bas', defines: ['ZX48'], package: 'tap' },
      ],
      assets: ['assets/**/*.cpcimp'],
    },
    null,
    2,
  ) + '\n';
  it('knows the Spectrum targets and removes only them', () => {
    expect(hasSpectrumTargets(shared)).toBe(true);
    const r = removeSpectrumTargets(shared)!;
    expect(r.removed).toEqual(['zx128', 'zx48']);
    const was = JSON.parse(shared);
    const now = JSON.parse(r.text);
    expect(now.targets).toEqual(was.targets.slice(0, 2));
    expect({ ...now, targets: 0 }).toEqual({ ...was, targets: 0 });
    expect(r.text.endsWith('}\n')).toBe(true);
    expect(removeSpectrumTargets(r.text)).toBeUndefined();
  });
  it('keeps tabs and CRLF, and does nothing for a project with no CPC target left or not JSON', () => {
    const tabbed = shared.replace(/ {2}/g, '\t').replace(/\n/g, '\r\n');
    const r = removeSpectrumTargets(tabbed)!;
    expect(r.text).toContain('\r\n\t"name"');
    expect(r.text.includes('zx48k')).toBe(false);
    const onlyZx = JSON.stringify({ version: 1, targets: [{ id: 'z', arch: 'zx48k', main: 'a.bas', package: 'tap' }] });
    expect(removeSpectrumTargets(onlyZx)).toBeUndefined();
    expect(removeSpectrumTargets('{ nope')).toBeUndefined();
  });
  it('one compile check per distinct main and defines, the target defines with bare and ownFont, no check for a Spectrum target', () => {
    const cs = targetChecks(shared);
    expect(cs).toEqual([
      { mains: ['src/main.bas'], defines: { CPC6128: '' }, targets: ['cpc6128'] },
      { mains: ['src/main.bas'], defines: { PLUS: '', CPC_BAREMETAL: '', CPC_OWNFONT: '' }, targets: ['plus'] },
    ]);
    // the same main and defines (in another order) are one check
    expect(targetChecks(JSON.stringify({ targets: [{ id: 'a', main: './m.bas', defines: ['X=2', 'Y'] }, { id: 'b', main: 'm.bas', defines: ['Y', 'X=2'] }] })).map((c) => [c.mains, c.defines, c.targets])).toEqual([
      [['m.bas'], { X: '2', Y: '' }, ['a', 'b']],
    ]);
    expect(targetChecks(undefined)).toEqual([]);
  });
});
