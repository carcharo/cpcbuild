import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProgram, groupsOf } from './editorCheck';
import { runtime } from './cpcbasTestUtil';

function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpcbuild-ec-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

describe('editor check: the compiler\'s diagnostics for a program', () => {
  it('finds a syntax error with its line, column and code', () => {
    const dir = project({ 'main.bas': 'DIM a AS UBYTE\nb = (\nPRINT a\n' });
    const ds = checkProgram({ root: dir, main: 'main.bas', runtime: runtime() }).diags.get(path.join(dir, 'main.bas'))!;
    expect(ds.length).toBeGreaterThan(0);
    expect(ds[0]).toMatchObject({ line: 2, severity: 'error', code: expect.stringMatching(/^E\d+$/) });
    expect(ds[0].col).toBeGreaterThan(0);
    expect(ds[0].endLine > ds[0].line || ds[0].endCol >= ds[0].col).toBe(true);
  });

  it('finds an undeclared name and a type error, which parseOnly does not (it stops before the binder)', () => {
    const dir = project({ 'main.bas': 'DIM a AS UBYTE\nPRINT Twice(2)\na = "x"\n' });
    const ds = checkProgram({ root: dir, main: 'main.bas', runtime: runtime() }).diags.get(path.join(dir, 'main.bas'))!;
    expect(ds.map((d) => [d.line, d.code, d.severity])).toEqual([[2, 'E204', 'error'], [3, 'E230', 'error']]);
  });

  it('follows the include graph and the target\'s defines; an error in an included file is reported on that file', () => {
    const dir = project({
      'src/main.bas': '#ifdef WITH_EXTRA\n#include "extra.bas"\n#endif\nPRINT Twice(2)\n',
      'src/extra.bas': 'FUNCTION Twice(n AS UBYTE) AS UBYTE\n  RETURN n *\nEND FUNCTION\n',
    });
    const without = checkProgram({ root: dir, main: 'src/main.bas', runtime: runtime() });
    expect([...without.files].map((f) => path.basename(f))).toEqual(['main.bas']);
    expect(without.diags.get(path.join(dir, 'src', 'main.bas'))!.map((d) => d.code)).toContain('E204');
    const withExtra = checkProgram({ root: dir, main: 'src/main.bas', defines: { WITH_EXTRA: '' }, runtime: runtime() });
    expect([...withExtra.files].map((f) => path.basename(f)).sort()).toEqual(['extra.bas', 'main.bas']);
    const extra = withExtra.diags.get(path.join(dir, 'src', 'extra.bas'))!;
    expect(extra[0]).toMatchObject({ line: 2, severity: 'error' });
    expect(withExtra.diags.has(path.join(dir, 'src', 'main.bas'))).toBe(false);
  });

  it('syntaxOnly (a file no program includes): syntax errors, but not the names another file declares', () => {
    const dir = project({ 'inc.bas': 'PRINT Declared(1)\nx = (\n' });
    const full = checkProgram({ root: dir, main: 'inc.bas', runtime: runtime() }).diags.get(path.join(dir, 'inc.bas'))!;
    const syntax = checkProgram({ root: dir, main: 'inc.bas', runtime: runtime(), syntaxOnly: true }).diags.get(path.join(dir, 'inc.bas'))!;
    expect(syntax.map((d) => d.line)).toEqual([2]);
    expect(full.length).toBeGreaterThanOrEqual(syntax.length);
    const ok = project({ 'inc.bas': 'PRINT Declared(1)\n' });
    expect(checkProgram({ root: ok, main: 'inc.bas', runtime: runtime(), syntaxOnly: true }).diags.size).toBe(0);
  });

  it('reads the open buffers instead of the disk', () => {
    const dir = project({ 'main.bas': 'PRINT 1\n', 'inc.bas': 'x = 1\n' });
    const inc = path.join(dir, 'inc.bas');
    const main = path.join(dir, 'main.bas');
    const clean = checkProgram({ root: dir, main: 'main.bas', runtime: runtime(), overlay: new Map([[main, '#include "inc.bas"\nPRINT x\n']]) });
    expect(clean.diags.size).toBe(0);
    const broken = checkProgram({ root: dir, main: 'main.bas', runtime: runtime(), overlay: new Map([[main, '#include "inc.bas"\n'], [inc, 'x = (\n']]) });
    expect([...broken.diags.keys()]).toEqual([inc]);
  });

  it('library files are not the user\'s: their diagnostics do not land on a user file', () => {
    const dir = project({ 'main.bas': '#include <cpc.bas>\n#include <cpcbuild.bas>\nMODE 1\nScreenInit()\nFillRect(0, 0, 4, 4, 1)\n' });
    const r = checkProgram({ root: dir, main: 'main.bas', runtime: runtime() });
    expect(r.diags.size).toBe(0);
    expect(r.files.size).toBe(1);
  });

  it('is fast enough for the editor: Lamplighter in under 300 ms (warm, median of seven)', () => {
    const root = path.resolve(__dirname, '..', '..', '..', '..', 'games', 'lamplighter');
    const rt = runtime();
    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = checkProgram({ root, main: 'main.bas', defines: { CPC6128: '' }, runtime: rt });
      expect([...r.diags.values()].flat().filter((d) => d.severity === 'error')).toEqual([]);
      if (i > 2) times.push(r.timeMs);
    }
    times.sort((a, b) => a - b);
    console.log(`editor check of Lamplighter: median ${times[3].toFixed(0)} ms`);
    expect(times[3]).toBeLessThan(300);
  });
});

describe('editor check: the programs of a project', () => {
  it('one program per distinct main and defines of the CPC targets', () => {
    const gs = groupsOf([
      { id: 'a', main: 'src/main.bas', defines: ['CPC6128'] },
      { id: 'b', main: 'src/main.bas', defines: ['CPC464'] },
      { id: 'c', main: 'src/main.bas', defines: ['CPC464'], arch: 'cpc' },
      { id: 'z', main: 'src/main.bas', arch: 'zx48k' },
    ]);
    expect(gs.map((g) => [g.main, g.defines, g.targets])).toEqual([
      ['src/main.bas', { CPC6128: '' }, ['a']],
      ['src/main.bas', { CPC464: '' }, ['b', 'c']],
    ]);
  });
});
